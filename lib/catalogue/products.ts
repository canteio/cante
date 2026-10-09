import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type Product } from "@/lib/db/schema";
import { parseCsv } from "@/lib/catalogue/csv";

/**
 * The product catalogue — item 2, and the keystone for lanes, impact, document
 * audit and supplier evidence.
 *
 * The one rule that shapes this file: an import must never quietly change the
 * catalogue. Every row is reported as created, updated, unchanged, or rejected
 * with a reason, because a customer who uploads 400 SKUs and is told "imported"
 * has learned nothing about the 12 that were dropped.
 */

const PRODUCT_CLASSES = new Set(["consumer", "industrial", "component", "unknown"]);

export interface ProductInput {
  sku: string;
  name: string;
  description?: string | null;
  materials?: string[];
  originCountry?: string | null;
  unitOfMeasure?: string | null;
  unitValue?: number | null;
  currency?: string | null;
  productClass?: string | null;
  notes?: string | null;
}

export interface ImportRowOutcome {
  line: number;
  sku: string;
  /** created | updated | unchanged | rejected — four different facts. */
  outcome: "created" | "updated" | "unchanged" | "rejected";
  reason?: string;
  /** Codes found in the row and filed as unapproved leads. */
  codesRecorded?: string[];
}

export interface ImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rows: ImportRowOutcome[];
  /** Code columns present in the file, so the caller can say what was mapped. */
  recognisedColumns: string[];
  ignoredColumns: string[];
  caveats: string[];
}

export async function listProducts(customerId: string): Promise<Product[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.products.$inferSelect>>(
    await supabase
      .from("products")
      .select("*")
      .eq("customer_id", customerId)
      .order("sku", { ascending: true }),
  );
}

export async function getProductBySku(customerId: string, sku: string): Promise<Product | undefined> {
  const supabase = await createClient();
  return (cloudResult<typeof Schema.products.$inferSelect | null>(
    await supabase
      .from("products")
      .select("*")
      .eq("customer_id", customerId)
      .eq("sku", sku)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
}

function normaliseMaterials(value: string | string[] | undefined | null): string[] {
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  // Strip thousands separators and currency symbols, keep the decimal point.
  const cleaned = value.replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseProduct(input: ProductInput) {
  const sku = input.sku.trim();
  const productClass =
    input.productClass && PRODUCT_CLASSES.has(input.productClass) ? input.productClass : "unknown";

  return {
    sku,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    materials: normaliseMaterials(input.materials),
    originCountry: input.originCountry?.trim() || null,
    unitOfMeasure: input.unitOfMeasure?.trim() || null,
    unitValue: input.unitValue ?? null,
    currency: (input.currency || "USD").trim().toUpperCase(),
    productClass,
    notes: input.notes?.trim() || null,
  };
}

export async function upsertProduct(
  customerId: string,
  input: ProductInput,
): Promise<{ product: Product; outcome: "created" | "updated" | "unchanged"; }> {
  const supabase = await createClient();
  const sku = input.sku.trim();
  const existing = await getProductBySku(customerId, sku);
  const now = new Date().toISOString();
  const next = normaliseProduct(input);

  if (!existing) {
    const created = { id: randomUUID(), customerId, ...next, active: true, createdAt: now, updatedAt: now };
    cloudResult(
      await supabase
        .from("products")
        .insert(snakeRow(created)),
    );
    return { product: created as Product, outcome: "created" };
  }

  const changed =
    existing.name !== next.name ||
    existing.description !== next.description ||
    JSON.stringify(existing.materials) !== JSON.stringify(next.materials) ||
    existing.originCountry !== next.originCountry ||
    existing.unitOfMeasure !== next.unitOfMeasure ||
    existing.unitValue !== next.unitValue ||
    existing.currency !== next.currency ||
    existing.productClass !== next.productClass ||
    existing.notes !== next.notes;

  if (!changed) return { product: existing, outcome: "unchanged" };

  cloudResult(
    await supabase
      .from("products")
      .update(snakeRow({ ...next, updatedAt: now }))
      .eq("id", existing.id),
  );
  return { product: { ...existing, ...next, updatedAt: now }, outcome: "updated" };
}

/** Column aliases customers actually use, mapped to the fields we store. */
const COLUMN_ALIASES: Record<string, string> = {
  sku: "sku",
  product_code: "sku",
  item_code: "sku",
  item: "sku",
  part_number: "sku",
  part_no: "sku",
  part_num: "sku",
  part: "sku",
  model: "sku",
  model_number: "sku",
  catalog_number: "sku",
  catalog_no: "sku",
  material_number: "sku",
  material_no: "sku",
  item_no: "sku",
  article_number: "sku",
  product_id: "sku",
  code: "sku",
  id: "sku",
  name: "name",
  product_name: "name",
  title: "name",
  product: "name",
  item_name: "name",
  description: "description",
  product_description: "description",
  item_description: "description",
  materials: "materials",
  material: "materials",
  composition: "materials",
  origin: "origin_country",
  origin_country: "origin_country",
  country_of_origin: "origin_country",
  coo: "origin_country",
  source_country: "origin_country",
  uom: "unit_of_measure",
  unit: "unit_of_measure",
  unit_of_measure: "unit_of_measure",
  unit_value: "unit_value",
  price: "unit_value",
  unit_price: "unit_value",
  value: "unit_value",
  cost: "unit_value",
  unit_cost: "unit_value",
  currency: "currency",
  product_class: "product_class",
  class: "product_class",
  notes: "notes",
};

/** Code columns become classification leads, never approved codes. */
const CODE_COLUMNS: Record<string, string> = {
  hs_code: "hs",
  hs: "hs",
  hscode: "hs",
  hts: "hts",
  hts_code: "hts",
  htsus: "hts",
  schedule_b: "schedule_b",
  schedule_b_code: "schedule_b",
  kbli: "kbli",
  kbli_code: "kbli",
  eccn: "eccn",
};

/**
 * Import a CSV into the catalogue.
 *
 * Codes in the file are filed as `lead`/`proposed` classifications — a
 * spreadsheet is not an export document, and letting a CSV column write a
 * `document`-tier code would destroy the only tier distinction that matters.
 */
export async function importProductsCsv(customerId: string, csv: string): Promise<ImportSummary> {
  const supabase = await createClient();
  const pending: Array<{ line: number; product: ReturnType<typeof normaliseProduct>; codes: Array<{ system: string; code: string; basis: string; }>; }> = [];
  const table = parseCsv(csv);
  const rows: ImportRowOutcome[] = [];
  const caveats: string[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;

  const recognisedColumns: string[] = [];
  const ignoredColumns: string[] = [];
  for (const header of table.headers) {
    if (COLUMN_ALIASES[header] || CODE_COLUMNS[header]) recognisedColumns.push(header);
    else if (header) ignoredColumns.push(header);
  }

  if (table.rows.length === 0) {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      rows: [],
      recognisedColumns,
      ignoredColumns,
      caveats: ["The file contained no data rows."],
    };
  }

  const hasSkuColumn = table.headers.some((h) => COLUMN_ALIASES[h] === "sku");
  if (!hasSkuColumn) {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
      rejected: table.rows.length,
      rows: table.rows.map((_, index) => ({
        line: index + 2,
        sku: "",
        outcome: "rejected" as const,
        reason: "The file has no SKU column, so rows cannot be matched to products.",
      })),
      recognisedColumns,
      ignoredColumns,
      caveats: [
        "No SKU column was found. Accepted headers include sku, product_code, item_code, part_number.",
      ],
    };
  }

  const value = (row: Record<string, string>, field: string): string => {
    for (const [header, mapped] of Object.entries(COLUMN_ALIASES)) {
      if (mapped === field && row[header]) return row[header];
    }
    return "";
  };

  const seenInFile = new Set<string>();

  for (const [index, row] of table.rows.entries()) {
    const line = index + 2;
    const sku = value(row, "sku");
    if (!sku) {
      rejected += 1;
      rows.push({ line, sku: "", outcome: "rejected", reason: "Missing SKU." });
      continue;
    }
    if (seenInFile.has(sku)) {
      rejected += 1;
      rows.push({
        line,
        sku,
        outcome: "rejected",
        reason: "Duplicate SKU within the same file; the earlier row was kept.",
      });
      continue;
    }
    seenInFile.add(sku);

    const name = value(row, "name") || sku;
    const product = normaliseProduct({
      sku,
      name,
      description: value(row, "description"),
      materials: normaliseMaterials(value(row, "materials")),
      originCountry: value(row, "origin_country"),
      unitOfMeasure: value(row, "unit_of_measure"),
      unitValue: parseNumber(value(row, "unit_value")),
      currency: value(row, "currency"),
      productClass: value(row, "product_class").toLowerCase(),
      notes: value(row, "notes"),
    });

    const codes: Array<{ system: string; code: string; basis: string; }> = [];
    for (const [header, system] of Object.entries(CODE_COLUMNS)) {
      const code = row[header]?.trim();
      if (!code) continue;
      codes.push({
        system,
        code,
        basis: `Imported from catalogue CSV column "${header}" on ${new Date()
          .toISOString()
          .slice(0, 10)}. A spreadsheet is not an export document.`,
      });
    }

    pending.push({ line, product, codes });
  }
  if (pending.length) {
    const outcomes = cloudResult<Array<{ line: number; sku: string; outcome: "created" | "updated" | "unchanged"; }>>(

      await supabase
        .rpc("import_cante_products", {
          target_customer_id: customerId,
          entries: pending.map((item) => ({ ...item, product: snakeRow(item.product) })),
        }),
    );
    for (const outcome of outcomes) {
      const codes = pending.find((item) => item.line === outcome.line)!.codes;
      rows.push({ ...outcome, ...(codes.length ? { codesRecorded: codes.map((code) => `${code.system}:${code.code}`) } : {}) });
      if (outcome.outcome === "created") created += 1;
      else if (outcome.outcome === "updated") updated += 1;
      else unchanged += 1;
    }
    rows.sort((a, b) => a.line - b.line);
  }

  if (ignoredColumns.length) {
    caveats.push(
      `${ignoredColumns.length} column(s) were not recognised and were ignored: ${ignoredColumns.join(", ")}.`,
    );
  }
  const codeColumnsPresent = table.headers.filter((h) => CODE_COLUMNS[h]);
  if (codeColumnsPresent.length) {
    caveats.push(
      `Codes from ${codeColumnsPresent.join(", ")} were filed as unapproved leads. A CSV is not an export document, so none of them count as verified.`,
    );
  }

  return { created, updated, unchanged, rejected, rows, recognisedColumns, ignoredColumns, caveats };
}

/** Delete a product and its classification history. Used by tests and manual cleanup. */
export async function deleteProduct(customerId: string, productId: string): Promise<boolean> {
  const supabase = await createClient();
  const existing = (cloudResult<typeof Schema.products.$inferSelect | null>(
    await supabase
      .from("products")
      .select("*")
      .eq("customer_id", customerId)
      .eq("id", productId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!existing) return false;
  cloudResult(
    await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("customer_id", customerId),
  );
  return true;
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
