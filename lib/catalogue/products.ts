import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { productClassifications, products, type Product } from "@/lib/db/schema";
import { parseCsv } from "@/lib/catalogue/csv";
import { recordClassification } from "@/lib/catalogue/classifications";

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

export function listProducts(customerId: string): Product[] {
  return db
    .select()
    .from(products)
    .where(eq(products.customerId, customerId))
    .orderBy(asc(products.sku))
    .all();
}

export function getProductBySku(customerId: string, sku: string): Product | undefined {
  return db
    .select()
    .from(products)
    .where(and(eq(products.customerId, customerId), eq(products.sku, sku)))
    .get();
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

export function upsertProduct(
  customerId: string,
  input: ProductInput,
): { product: Product; outcome: "created" | "updated" | "unchanged" } {
  const sku = input.sku.trim();
  const existing = getProductBySku(customerId, sku);
  const now = new Date().toISOString();
  const productClass =
    input.productClass && PRODUCT_CLASSES.has(input.productClass) ? input.productClass : "unknown";

  const next = {
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

  if (!existing) {
    const created = { id: randomUUID(), customerId, ...next, active: true, createdAt: now, updatedAt: now };
    db.insert(products).values(created).run();
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

  db.update(products).set({ ...next, updatedAt: now }).where(eq(products.id, existing.id)).run();
  return { product: { ...existing, ...next, updatedAt: now }, outcome: "updated" };
}

/** Column aliases customers actually use, mapped to the fields we store. */
const COLUMN_ALIASES: Record<string, string> = {
  sku: "sku",
  product_code: "sku",
  item_code: "sku",
  item: "sku",
  part_number: "sku",
  name: "name",
  product_name: "name",
  title: "name",
  description: "description",
  product_description: "description",
  materials: "materials",
  material: "materials",
  composition: "materials",
  origin: "origin_country",
  origin_country: "origin_country",
  country_of_origin: "origin_country",
  uom: "unit_of_measure",
  unit: "unit_of_measure",
  unit_of_measure: "unit_of_measure",
  unit_value: "unit_value",
  price: "unit_value",
  unit_price: "unit_value",
  value: "unit_value",
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
export function importProductsCsv(customerId: string, csv: string): ImportSummary {
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

  db.transaction(() => {
    table.rows.forEach((row, index) => {
      const line = index + 2;
      const sku = value(row, "sku");
      if (!sku) {
        rejected += 1;
        rows.push({ line, sku: "", outcome: "rejected", reason: "Missing SKU." });
        return;
      }
      if (seenInFile.has(sku)) {
        rejected += 1;
        rows.push({
          line,
          sku,
          outcome: "rejected",
          reason: "Duplicate SKU within the same file; the earlier row was kept.",
        });
        return;
      }
      seenInFile.add(sku);

      const name = value(row, "name") || sku;
      const result = upsertProduct(customerId, {
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

      const codesRecorded: string[] = [];
      for (const [header, system] of Object.entries(CODE_COLUMNS)) {
        const code = row[header]?.trim();
        if (!code) continue;
        recordClassification({
          productId: result.product.id,
          system,
          code,
          tier: "lead",
          basis: `Imported from catalogue CSV column "${header}" on ${new Date()
            .toISOString()
            .slice(0, 10)}. A spreadsheet is not an export document.`,
        });
        codesRecorded.push(`${system}:${code}`);
      }

      if (result.outcome === "created") created += 1;
      else if (result.outcome === "updated") updated += 1;
      else unchanged += 1;

      rows.push({
        line,
        sku,
        outcome: result.outcome,
        ...(codesRecorded.length ? { codesRecorded } : {}),
      });
    });
  });

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
export function deleteProduct(customerId: string, productId: string): boolean {
  const existing = db
    .select()
    .from(products)
    .where(and(eq(products.customerId, customerId), eq(products.id, productId)))
    .get();
  if (!existing) return false;
  db.transaction(() => {
    db.delete(productClassifications).where(eq(productClassifications.productId, productId)).run();
    db.delete(products).where(eq(products.id, productId)).run();
  });
  return true;
}
