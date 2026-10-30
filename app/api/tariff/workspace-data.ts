import { createRequestClient } from "@/lib/supabase/server";
import { recordClassification } from "@/lib/catalogue/classifications";
import { importProductsCsv } from "@/lib/catalogue/products";
import { parseCsv } from "@/lib/catalogue/csv";
import { normalizeCountryCode, normalizeHtsCode } from "@/lib/tariff/bulk";
import { parseLiveProducts, type LiveProduct } from "./live-check/check";

type Db = Awaited<ReturnType<typeof createRequestClient>>;
const quote = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
const facts = {
  standard_commercial: "standardCommercial",
  us_metal_qualification: "usMetalQualification",
  uk_metal_qualification: "ukMetalQualification",
  special_232_claim: "special232Claim",
  equipment_use: "equipmentUse",
  motorcycle_use: "motorcycleUse",
  metal_weight_percent: "metalWeightPercent",
  other_232_heading: "other232Heading",
} as const;
const columns = [
  "sku",
  "hts_code",
  "origin_country",
  "annual_customs_value_usd",
  "quantity",
  "quantity_unit",
  "input_basis",
  "value_basis",
  "dataset_label",
  ...Object.keys(facts),
  "usmca_verified",
  "usmca_decision",
  "usmca_details",
];
export function workspaceCsv(products: LiveProduct[]) {
  return [
    columns.join(","),
    ...products.map((p) =>
      [
        p.sku,
        p.hts,
        p.origin,
        p.customsValue,
        p.quantity,
        p.unit,
        "catalogue",
        p.valueBasis ??
          (p.history ? "historical" : p.inputBasis ? "" : "annual"),
        p.fictional ? "fictional" : "",
        ...Object.values(facts).map((k) => p.remedyFacts?.[k]),
        p.usmcaQualification?.verified,
        p.usmcaQualification?.decision,
        p.usmcaQualification?.details,
      ]
        .map(quote)
        .join(","),
    ),
  ].join("\n");
}

/** Catalogue intake permits missing facts without inventing customs values. */
export function parseWorkspaceUpload(csv: string): LiveProduct[] {
  const table = parseCsv(
    csv,
    { columns: 30, rawRows: 6002, cellCharacters: 500 },
    true,
  );
  if (
    table.headers.some((h) =>
      [
        "entry_id",
        "annual_customs_value_usd",
        "unit_customs_value_usd",
        "input_basis",
      ].includes(h),
    )
  )
    return parseLiveProducts(csv);
  const alias = (r: Record<string, string>, names: string[]) =>
    names.map((n) => r[n]?.trim()).find(Boolean) ?? "";
  const canonical = [
    [...table.headers, "input_basis"].join(","),
    ...table.rows.map((r) =>
      [...table.headers.map((h) => r[h]), "catalogue"].map(quote).join(","),
    ),
  ].join("\n");
  // Explicit aliases used by the existing catalogue importer; no inferred mapping.
  const normalized = parseCsv(
    canonical,
    { columns: 31, rawRows: 6002, cellCharacters: 500 },
    true,
  );
  return parseLiveProducts(
    [
      columns.join(","),
      ...normalized.rows.map((r) =>
        [
          alias(r, ["sku", "product_code", "item_code", "part_number"]),
          alias(r, ["hts_code", "hts", "htsus"]),
          alias(r, ["origin_country", "country_of_origin", "origin", "coo"]),
          "",
          alias(r, ["quantity", "annual_quantity"]),
          alias(r, ["quantity_unit", "unit_of_measure", "unit"]),
          "catalogue",
          "",
          r.dataset_label,
          ...Object.keys(facts).map((k) => r[k]),
          r.usmca_verified,
          r.usmca_decision,
          r.usmca_details,
        ]
          .map(quote)
          .join(","),
      ),
    ].join("\n"),
  );
}

/** Same catalogue for chat, dashboard and later checks. Original upload remains
 * in its immutable check archive; these are user inputs, never trusted results. */
export async function importWorkspaceProducts(
  db: Db,
  customerId: string,
  csv: string,
  sourceCheckId?: string,
) {
  const products = parseWorkspaceUpload(csv);
  if (new Set(products.map((p) => p.sku)).size !== products.length)
    throw Error(
      "This file has multiple origins or codes for one SKU. Give each variant its own SKU before saving it to the catalogue.",
    );
  const source = parseCsv(
    csv,
    { columns: 30, rawRows: 6002, cellCharacters: 500 },
    true,
  );
  const names = new Map(
    source.rows.map((r) => [
      r.sku,
      r.name || r.product_name || r.description || r.sku,
    ]),
  );
  const catalogue = [
    "sku,name,hts_code,origin_country",
    ...products.map((p) =>
      [p.sku, names.get(p.sku) || p.sku, p.hts, p.origin].map(quote).join(","),
    ),
  ].join("\n");
  // Preserve existing descriptive fields: merge rows through existing importer
  // only for new products; updating tariff facts must not wipe names or prices.
  const { data: existing, error } = await db
    .from("products")
    .select("id,sku,origin_country,tariff_inputs")
    .eq("customer_id", customerId)
    .in(
      "sku",
      products.map((p) => p.sku),
    );
  if (error)
    throw Error("Could not read saved products. No product data was replaced.");
  const current = new Map((existing ?? []).map((p) => [p.sku, p]));
  for (const p of products) {
    const old = current.get(p.sku);
    if (
      old &&
      normalizeCountryCode(old.origin_country ?? "") &&
      normalizeCountryCode(old.origin_country ?? "") !== p.origin
    )
      throw Error(
        `SKU ${p.sku}: saved origin differs. Edit the product or use a separate SKU for the origin variant. No product facts were replaced.`,
      );
  }
  const fresh = products.filter((p) => !current.has(p.sku));
  let summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    caveats: [] as string[],
    rows: [] as { line: number; sku: string; outcome: string }[],
  };
  if (fresh.length)
    summary = await importProductsCsv(
      customerId,
      [
        catalogue.split("\n")[0],
        ...fresh.map((p) =>
          [p.sku, names.get(p.sku) || p.sku, p.hts, p.origin]
            .map(quote)
            .join(","),
        ),
      ].join("\n"),
    );
  if (summary.rejected)
    throw Error(
      "Some products were rejected. Review the upload before checking again.",
    );
  for (const p of products) {
    const old = current.get(p.sku);
    if (old && p.hts)
      await recordClassification({
        productId: old.id,
        system: "hts",
        code: p.hts,
        tier: "lead",
        basis:
          "Supplied in a workspace upload; classification requires confirmation.",
      });
    const { history, ...inputs } = p;
    const prior = old?.tariff_inputs as
      | (LiveProduct & { sourceCheckId?: string })
      | null;
    const same = prior?.hts === p.hts && prior?.origin === p.origin;
    const hasValue = source.headers.some((h) =>
      [
        "annual_customs_value_usd",
        "unit_customs_value_usd",
        "customs_value_usd",
      ].includes(h),
    );
    const combinedFacts: Record<string, unknown> = {
      ...(same ? prior?.remedyFacts : {}),
      ...p.remedyFacts,
    };
    for (const [header, key] of Object.entries(facts))
      if (source.headers.includes(header) && p.remedyFacts?.[key] === undefined)
        delete combinedFacts[key];
    const stored = {
      ...inputs,
      customsValue:
        !hasValue && same ? (prior?.customsValue ?? null) : p.customsValue,
      quantity:
        !source.headers.some((h) =>
          ["quantity", "annual_quantity", "entry_id"].includes(h),
        ) && same
          ? (prior?.quantity ?? null)
          : p.quantity,
      unit:
        !source.headers.some((h) =>
          ["unit", "quantity_unit", "entry_id"].includes(h),
        ) && same
          ? (prior?.unit ?? null)
          : p.unit,
      valueBasis:
        !hasValue && same
          ? prior?.valueBasis
          : history
            ? "historical"
            : (p.valueBasis ?? (p.inputBasis ? undefined : "annual")),
      remedyFacts: Object.keys(combinedFacts).length
        ? combinedFacts
        : undefined,
      usmcaQualification: source.headers.some((h) => h.startsWith("usmca_"))
        ? p.usmcaQualification
        : same
          ? prior?.usmcaQualification
          : p.usmcaQualification,
      fictional:
        p.fictional || (!hasValue && same && prior?.fictional === true),
      sourceCheckId: sourceCheckId ?? null,
      ...(same && prior?.sourceCheckId
        ? { previousInputCheckId: prior.sourceCheckId }
        : {}),
    };
    const { error: saveError } = await db
      .from("products")
      .update({
        tariff_inputs: stored,
        ...(p.origin ? { origin_country: p.origin } : {}),
      })
      .eq("customer_id", customerId)
      .eq("sku", p.sku);
    if (saveError)
      throw Error(
        "Products were saved, but their tariff facts could not be saved. The original file is retained; no completed check is claimed.",
      );
  }
  return {
    ...summary,
    updated: summary.updated + products.length - fresh.length,
    products,
  };
}

export async function loadWorkspaceSnapshot(db: Db, customerId: string) {
  const { data, error } = await db
    .from("products")
    .select("id,sku,name,origin_country,tariff_inputs")
    .eq("customer_id", customerId)
    .eq("active", true)
    .order("sku")
    .limit(101);
  if (error)
    throw Error(
      "Could not load saved products. Check that the workspace data migration is installed.",
    );
  if (!data?.length)
    return { csv: "", products: [] as LiveProduct[], count: 0 };
  if (data.length > 100)
    throw Error(
      "This workspace has more than 100 active products. The check limit must be raised before a complete catalogue check can run; no subset was checked.",
    );
  const { data: codes, error: ce } = await db
    .from("product_classifications")
    .select("product_id,code,status")
    .eq("system", "hts")
    .is("superseded_at", null)
    .in(
      "product_id",
      data.map((p) => p.id),
    );
  if (ce) throw Error("Could not load saved HTS classifications.");
  const products: LiveProduct[] = data.map((p) => {
    const hts = [
      ...new Set(
        (codes ?? [])
          .filter((c) => c.product_id === p.id && c.status !== "rejected")
          .map((c) => normalizeHtsCode(c.code)),
      ),
    ];
    const origin = normalizeCountryCode(p.origin_country ?? "");
    const code = hts.length === 1 ? hts[0] : "";
    const input = p.tariff_inputs as LiveProduct | null;
    const matching =
      input &&
      input.sku === p.sku &&
      input.hts === code &&
      input.origin === origin;
    return {
      sku: p.sku,
      hts: code,
      origin,
      customsValue: matching ? input.customsValue : null,
      quantity: matching ? input.quantity : null,
      unit: matching ? input.unit : null,
      fictional: matching ? input.fictional : false,
      inputBasis: "catalogue",
      ...(matching
        ? {
            valueBasis: input.valueBasis,
            remedyFacts: input.remedyFacts,
            usmcaQualification: input.usmcaQualification,
          }
        : {}),
    };
  });
  const csv = workspaceCsv(products);
  return { csv, products: parseLiveProducts(csv), count: data.length };
}
