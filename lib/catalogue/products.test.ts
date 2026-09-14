// Tests for lib/catalogue/products.ts — this file had zero coverage despite
// being the keystone the module comment calls out: the CSV import path that
// customers actually hit first, and the one place a silent "imported"
// message would erase 12 dropped rows without anyone noticing.
//
// These pin down the three failure/edge modes that matter most:
//  1. a file with no recognisable SKU column rejects every row with a reason
//     (not a crash, not a silent 0-row import);
//  2. a duplicate SKU within the same file is rejected and the *first*
//     occurrence wins, so a customer can see exactly which row lost;
//  3. code columns (hs/hts/schedule_b/etc.) are filed as "lead" tier
//     classifications, never silently promoted — this is the same
//     guardrail classifications.test.ts pins from the other side.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";

before(async () => {
  await operatingDb();
});

test("importProductsCsv rejects every row when no SKU column is present", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv } = await import("@/lib/catalogue/products");

  const csv = "name,description\nWidget,A widget\nGadget,A gadget\n";
  const summary = importProductsCsv(customerId, csv);

  assert.equal(summary.created, 0);
  assert.equal(summary.rejected, 2);
  assert.ok(summary.caveats.some((c) => c.includes("No SKU column")));
  assert.equal(summary.rows[0].reason, "The file has no SKU column, so rows cannot be matched to products.");
});

test("importProductsCsv keeps the first row and rejects later duplicate SKUs in-file", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv, getProductBySku } = await import("@/lib/catalogue/products");

  const csv = "sku,name\nSKU-1,First Name\nSKU-1,Second Name\n";
  const summary = importProductsCsv(customerId, csv);

  assert.equal(summary.created, 1);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.rows[1].outcome, "rejected");
  assert.equal(
    summary.rows[1].reason,
    "Duplicate SKU within the same file; the earlier row was kept.",
  );

  const product = getProductBySku(customerId, "SKU-1");
  assert.equal(product?.name, "First Name");
});

test("importProductsCsv files code columns as lead-tier classifications, never approved", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv } = await import("@/lib/catalogue/products");
  const { db } = await import("@/lib/db/client");
  const { productClassifications } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const csv = "sku,name,hs_code\nSKU-9,Widget,1234.56.78\n";
  const summary = importProductsCsv(customerId, csv);

  assert.equal(summary.created, 1);
  assert.deepEqual(summary.rows[0].codesRecorded, ["hs:1234.56.78"]);
  assert.ok(summary.caveats.some((c) => c.includes("filed as unapproved leads")));

  const rows = db
    .select()
    .from(productClassifications)
    .where(eq(productClassifications.code, "1234.56.78"))
    .all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, "lead");
  assert.equal(rows[0].status, "proposed");
});

test("importProductsCsv reports unrecognised columns as a caveat without dropping rows", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv } = await import("@/lib/catalogue/products");

  const csv = "sku,name,favorite_color\nSKU-5,Widget,blue\n";
  const summary = importProductsCsv(customerId, csv);

  assert.equal(summary.created, 1);
  assert.deepEqual(summary.ignoredColumns, ["favorite_color"]);
  assert.ok(summary.caveats.some((c) => c.includes("favorite_color")));
});
