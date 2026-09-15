// Tests for lib/catalogue/classifications.ts — this file had zero coverage
// despite being the sole guardrail preventing a model-proposed HS code
// ("guess"/"lead") from ever becoming an "approved" classification without a
// document or a named human sign-off. Pinning that refusal behavior down here
// means a future refactor that loosens APPROVABLE_TIERS trips a test instead
// of shipping silently.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";

before(async () => {
  await operatingDb();
});

test("a freshly recorded classification always lands as proposed, never approved", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");

  const { product } = upsertProduct(customerId, { sku: "SKU-1", name: "Widget" });
  const row = recordClassification({
    productId: product.id,
    system: "HTS",
    code: "1234.56.78",
    tier: "guess",
    basis: "model suggestion",
  });

  assert.equal(row.status, "proposed");
  assert.equal(row.approvedBy, null);
  assert.equal(row.approvedAt, null);
});

test("approveClassification refuses a guess- or lead-tier code outright", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification, approveClassification, ClassificationApprovalError } = await import(
    "@/lib/catalogue/classifications"
  );

  const { product } = upsertProduct(customerId, { sku: "SKU-2", name: "Gadget" });
  const guess = recordClassification({
    productId: product.id,
    system: "HTS",
    code: "1111.11.11",
    tier: "guess",
    basis: "model suggestion",
  });

  assert.throws(
    () => approveClassification(guess.id, "J", "looks right"),
    ClassificationApprovalError,
  );

  const lead = recordClassification({
    productId: product.id,
    system: "HTS",
    code: "2222.22.22",
    tier: "lead",
    basis: "seen on a PEB",
  });
  assert.throws(() => approveClassification(lead.id, "J", "seen elsewhere"), ClassificationApprovalError);
});

test("approveClassification requires both a named approver and a written rationale", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification, approveClassification, ClassificationApprovalError } = await import(
    "@/lib/catalogue/classifications"
  );

  const { product } = upsertProduct(customerId, { sku: "SKU-3", name: "Doohickey" });
  const doc = recordClassification({
    productId: product.id,
    system: "HTS",
    code: "3333.33.33",
    tier: "document",
    basis: "commercial invoice",
  });

  assert.throws(() => approveClassification(doc.id, "", "fine"), ClassificationApprovalError);
  assert.throws(() => approveClassification(doc.id, "J", "   "), ClassificationApprovalError);
});

test("approving a document-tier code supersedes the prior approved code for the same system/jurisdiction", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification, approveClassification, resolveProductCodes } = await import(
    "@/lib/catalogue/classifications"
  );

  const { product } = upsertProduct(customerId, { sku: "SKU-4", name: "Thingamajig" });
  const first = recordClassification({
    productId: product.id,
    system: "HTS",
    code: "4444.44.44",
    tier: "document",
    basis: "old invoice",
  });
  approveClassification(first.id, "J", "matches the March invoice");

  const second = recordClassification({
    productId: product.id,
    system: "HTS",
    code: "5555.55.55",
    tier: "document",
    basis: "corrected invoice",
  });
  approveClassification(second.id, "J", "supersedes the March code with the corrected one");

  const resolved = resolveProductCodes(product.id, "HTS");
  assert.equal(resolved.current?.code, "5555.55.55");
  assert.equal(resolved.current?.status, "approved");
  // The superseded row must not vanish — it stays queryable for "what did we
  // declare in March" even though resolveProductCodes no longer surfaces it
  // as current.
  const { listClassifications } = await import("@/lib/catalogue/classifications");
  const all = listClassifications(product.id);
  const supersededFirst = all.find((r) => r.id === first.id);
  assert.ok(supersededFirst?.supersededAt, "the earlier approved row should be marked superseded, not deleted");
});

test("recordClassification is idempotent per (product, system, jurisdiction, code) and only upgrades tier", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification, listClassifications } = await import("@/lib/catalogue/classifications");

  const { product } = upsertProduct(customerId, { sku: "SKU-5", name: "Contraption" });
  recordClassification({ productId: product.id, system: "HTS", code: "6666.66.66", tier: "guess", basis: "model" });
  recordClassification({ productId: product.id, system: "HTS", code: "6666.66.66", tier: "guess", basis: "model again" });

  let rows = listClassifications(product.id);
  assert.equal(rows.length, 1, "re-recording the same guess must not grow the history");

  recordClassification({
    productId: product.id,
    system: "HTS",
    code: "6666.66.66",
    tier: "lead",
    basis: "seen on a PEB now",
  });
  rows = listClassifications(product.id);
  assert.equal(rows.length, 1, "a stronger tier for the same code updates in place, it does not add a row");
  assert.equal(rows[0].tier, "lead");
});
