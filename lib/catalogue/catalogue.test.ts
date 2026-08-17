import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "@/lib/catalogue/csv";
import { operatingDb } from "@/lib/test-support/operating-db";

test("CSV reader handles quoted commas, embedded quotes, and CRLF", () => {
  const table = parseCsv(
    'sku,name,description\r\nA-1,"Tarpaulin, heavy","12oz ""blue"" PVC"\r\nA-2,Plain,simple\r\n',
  );
  assert.deepEqual(table.headers, ["sku", "name", "description"]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].name, "Tarpaulin, heavy");
  assert.equal(table.rows[0].description, '12oz "blue" PVC');
  assert.equal(table.rows[1].sku, "A-2");
});

test("import reports created, updated, unchanged and rejected separately", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv, listProducts } = await import("@/lib/catalogue/products");

  const first = importProductsCsv(
    customerId,
    "sku,name,hs_code\nPVC-100,Blue tarp 12oz,6306.12.00\nPVC-200,Green tarp,\n",
  );
  assert.equal(first.created, 2);
  assert.equal(first.rejected, 0);

  // Same file again: unchanged, not a duplicate and not an "update".
  const second = importProductsCsv(
    customerId,
    "sku,name,hs_code\nPVC-100,Blue tarp 12oz,6306.12.00\nPVC-200,Green tarp,\n",
  );
  assert.equal(second.unchanged, 2);
  assert.equal(second.created, 0);

  const third = importProductsCsv(
    customerId,
    "sku,name\nPVC-100,Blue tarp 14oz\n,No sku here\nPVC-200,Green tarp\nPVC-200,Duplicate row\n",
  );
  assert.equal(third.updated, 1, "PVC-100 name changed");
  assert.equal(third.unchanged, 1, "PVC-200 unchanged");
  assert.equal(third.rejected, 2, "missing SKU and in-file duplicate");
  assert.match(third.rows[1].reason ?? "", /Missing SKU/);
  assert.match(third.rows[3].reason ?? "", /Duplicate SKU/);

  assert.equal(listProducts(customerId).length, 2);
});

test("a file with no SKU column is rejected wholesale rather than half-imported", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv, listProducts } = await import("@/lib/catalogue/products");
  const result = importProductsCsv(customerId, "name,description\nThing,Some thing\n");
  assert.equal(result.created, 0);
  assert.equal(result.rejected, 1);
  assert.equal(listProducts(customerId).length, 0);
  assert.match(result.caveats[0], /No SKU column/);
});

test("CSV codes land as unapproved leads, never as verified", async () => {
  const { customerId } = await operatingDb();
  const { importProductsCsv, getProductBySku } = await import("@/lib/catalogue/products");
  const { resolveProductCodes } = await import("@/lib/catalogue/classifications");

  importProductsCsv(customerId, "sku,name,hs_code\nPVC-100,Blue tarp,6306.12.00\n");
  const product = getProductBySku(customerId, "PVC-100");
  assert.ok(product);

  const resolved = resolveProductCodes(product.id, "hs");
  assert.equal(resolved.documentVerified, false);
  assert.equal(resolved.leads.length, 1);
  assert.equal(resolved.leads[0].code, "6306.12.00");
  assert.equal(resolved.leads[0].status, "proposed");
  assert.equal(resolved.current, null, "a lead is not a current classification");
});

test("approval refuses lead-tier codes, requires a rationale, and supersedes the previous code", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const {
    recordClassification,
    approveClassification,
    resolveProductCodes,
    listClassifications,
    ClassificationApprovalError,
  } = await import("@/lib/catalogue/classifications");

  const { product } = upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp" });

  const lead = recordClassification({
    productId: product.id,
    system: "hs",
    code: "3921.90",
    tier: "lead",
    basis: "model suggestion",
  });
  assert.throws(
    () => approveClassification(lead.id, "j", "looks right"),
    (error: Error) => error instanceof ClassificationApprovalError && /lead-tier/.test(error.message),
    "a model suggestion must not be approvable",
  );

  const human = recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "human",
    basis: "broker email",
  });
  assert.throws(
    () => approveClassification(human.id, "j", "   "),
    (error: Error) => error instanceof ClassificationApprovalError && /rationale/.test(error.message),
  );

  approveClassification(human.id, "j", "Confirmed with broker against GRI 1 and heading text.");
  let resolved = resolveProductCodes(product.id, "hs");
  assert.equal(resolved.current?.code, "6306.12.00");

  // A document-tier code arrives later and is approved: the old one is
  // superseded, not deleted — the history has to survive.
  const doc = recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.19.90",
    tier: "document",
    basis: "PEB 000123",
  });
  approveClassification(doc.id, "j", "Read off PEB 000123.");

  resolved = resolveProductCodes(product.id, "hs");
  assert.equal(resolved.current?.code, "6306.19.90");
  assert.equal(resolved.documentVerified, true);

  const history = listClassifications(product.id);
  assert.equal(history.length, 3, "every code ever asserted is retained");
  const superseded = history.find((h) => h.code === "6306.12.00");
  assert.equal(superseded?.status, "superseded");
  assert.equal(superseded?.supersededBy, doc.id);
});

test("a stronger tier upgrades an existing code without inventing approval", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification, resolveProductCodes } = await import(
    "@/lib/catalogue/classifications"
  );

  const { product } = upsertProduct(customerId, { sku: "PVC-100", name: "Blue tarp" });
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "lead",
    basis: "CSV import",
  });
  recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "document",
    basis: "PEB 000123",
  });

  const resolved = resolveProductCodes(product.id, "hs");
  assert.equal(resolved.document.length, 1, "upgraded in place, not duplicated");
  assert.equal(resolved.leads.length, 0);
  assert.equal(resolved.document[0].status, "proposed", "still awaiting a human");
});
