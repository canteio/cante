import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

/**
 * `matchProducts` (lib/impact/assess.ts) had zero direct test coverage even
 * though it decides which catalogue products a regulation touches, and at
 * what confidence (exact code / code prefix / material keyword). Getting
 * this wrong either hides a real exposure or falsely flags an unrelated
 * product, so it deserves the same scrutiny as the exposure math it feeds.
 *
 * Same DB-binding constraint as impact.test.ts: operatingDb() must run
 * before any code that needs a real customer row.
 */

const finding = (over: Partial<{ title: string; summaryEn: string | null; reasoning: string | null; regulationRef: string | null }> = {}) => ({
  title: over.title ?? "",
  summaryEn: over.summaryEn ?? null,
  reasoning: over.reasoning ?? null,
  regulationRef: over.regulationRef ?? null,
});

test("an exact HS code match outranks a prefix match on the same product", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { matchProducts } = await import("@/lib/impact/assess");

  const { product } = (await upsertProduct(customerId, { sku: "PVC-200", name: "Green tarp" }));
  (await recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "document",
    basis: "PEB",
  }));

  const matches = (await matchProducts(customerId, finding({ title: "Rule covering 6306.12.00" })));

  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "exact_code");
  assert.equal(matches[0].product.id, product.id);
});

test("a 6-digit rule against an 8-digit catalogue code is only a prefix match", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { matchProducts } = await import("@/lib/impact/assess");

  const { product } = (await upsertProduct(customerId, { sku: "PVC-300", name: "Red tarp" }));
  (await recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.99",
    tier: "document",
    basis: "PEB",
  }));

  const matches = (await matchProducts(customerId, finding({ title: "Duty change for 6306.12" })));

  assert.equal(matches.length, 1);
  assert.equal(matches[0].kind, "code_prefix");
  assert.match(matches[0].reason, /confirm at the full code before acting/);
});

test("a material keyword only matches when there is no code hit, and is labelled as weaker", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { matchProducts } = await import("@/lib/impact/assess");

  const { product } = (await upsertProduct(customerId, {
    sku: "PVC-400",
    name: "Unclassified tarp",
    materials: ["PVC coated polyester"],
  }));

  const matches = (await matchProducts(
    customerId,
    finding({ title: "New PFAS restriction on PVC coated polyester imports" }),
  ));

  assert.equal(matches.length, 1);
  assert.equal(matches[0].product.id, product.id);
  assert.equal(matches[0].kind, "material");
  assert.match(matches[0].reason, /keyword signal, not a classification match/);
});

test("a superseded or rejected classification is ignored, and no match falls through to material", async () => {
  const { customerId } = await operatingDb();
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { matchProducts } = await import("@/lib/impact/assess");

  const { rejectClassification } = await import("@/lib/catalogue/classifications");
  const { product } = (await upsertProduct(customerId, { sku: "PVC-500", name: "Unrelated item" }));
  const classification = (await recordClassification({
    productId: product.id,
    system: "hs",
    code: "6306.12.00",
    tier: "document",
    basis: "PEB",
  }));
  (await rejectClassification(classification.id, "wrong HS code, superseded on audit"));

  const matches = (await matchProducts(customerId, finding({ title: "Rule covering 6306.12.00" })));

  assert.equal(matches.length, 0, "a rejected classification must not produce a match");
});
