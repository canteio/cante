import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";

before(async () => {
  await operatingDb();
});

async function seedCatalogue(customerId: string) {
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const bom = await import("@/lib/substances/bom");
  const { product } = upsertProduct(customerId, { sku: "TARP-12", name: "Blue tarp" });
  const coating = bom.addComponent({ productId: product.id, name: "PVC coating", massGrams: 800 });
  const scrim = bom.addComponent({ productId: product.id, name: "Polyester scrim", massGrams: 400 });
  return { product, coating, scrim, bom };
}

test("a restriction check with no lists loaded is a gap, not a pass", async () => {
  const { customerId } = await operatingDb();
  const { assessRestrictions } = await import("@/lib/substances/bom");
  const result = assessRestrictions(customerId);
  assert.equal(result.hits.length, 0);
  assert.match(result.caveats[0], /coverage gap, not a clean result/);
});

test("over threshold, below threshold, unknown amount, and undeclared are four answers", async () => {
  const { customerId } = await operatingDb();
  const { coating, scrim, bom } = await seedCatalogue(customerId);

  bom.loadRestrictionList({
    name: "Test PFAS restriction",
    jurisdiction: "United States",
    entries: [
      { name: "PFOA", casNumber: "335-67-1", thresholdPpm: 25 },
      { name: "Lead", casNumber: "7439-92-1", thresholdPpm: 1000 },
    ],
  });

  const pfoa = bom.upsertSubstance({ name: "PFOA", casNumber: "335-67-1" });
  const lead = bom.upsertSubstance({ name: "Lead", casNumber: "7439-92-1" });

  bom.declareSubstance({
    componentId: coating.id,
    substanceId: pfoa.id,
    concentrationPpm: 40,
    tier: "document",
    basis: "supplier material declaration",
  });
  bom.declareSubstance({
    componentId: coating.id,
    substanceId: lead.id,
    concentrationPpm: 12,
    tier: "document",
    basis: "supplier material declaration",
  });
  // scrim is left undeclared on purpose.

  const result = assessOf(await import("@/lib/substances/bom"), customerId);
  const byVerdict = new Map(result.hits.map((h) => [h.verdict, h]));

  assert.ok(byVerdict.get("over_threshold"), "PFOA at 40ppm exceeds the 25ppm threshold");
  assert.equal(byVerdict.get("over_threshold")?.substanceName, "PFOA");
  assert.ok(byVerdict.get("below_threshold"), "lead at 12ppm is under 1000ppm");

  assert.equal(result.undeclaredComponents.length, 1);
  assert.equal(result.undeclaredComponents[0].componentName, "Polyester scrim");
  assert.match(result.caveats.join(" "), /NOT assessed and must not be read as clear/);

  // Presence with no stated amount is its own verdict, and is not a pass.
  bom.declareSubstance({
    componentId: scrim.id,
    substanceId: pfoa.id,
    concentrationPpm: null,
    tier: "lead",
    basis: "inferred from material description",
  });
  const second = assessOf(await import("@/lib/substances/bom"), customerId);
  const unknown = second.hits.find((h) => h.verdict === "present_unknown_amount");
  assert.ok(unknown);
  assert.match(unknown.detail, /cannot be cleared/);
  assert.match(second.caveats.join(" "), /lead-tier declarations/);
});

function assessOf(bom: typeof import("@/lib/substances/bom"), customerId: string) {
  return bom.assessRestrictions(customerId);
}

test("a regulation naming a CAS number finds the product containing it", async () => {
  const { customerId } = await operatingDb();
  const { coating, bom } = await seedCatalogue(customerId);
  const pfoa = bom.upsertSubstance({
    name: "Perfluorooctanoic acid",
    casNumber: "335-67-1",
    synonyms: ["PFOA"],
  });
  bom.declareSubstance({
    componentId: coating.id,
    substanceId: pfoa.id,
    concentrationPpm: 40,
    tier: "document",
    basis: "declaration",
  });

  // By CAS number, which is how restriction rules actually cite substances.
  const byCas = bom.productsContainingSubstanceNamedIn(
    customerId,
    "This rule restricts perfluoroalkyl substances including CAS 335-67-1 in consumer articles.",
  );
  assert.equal(byCas.length, 1);
  assert.equal(byCas[0].productSku, "TARP-12");
  assert.equal(byCas[0].componentName, "PVC coating");

  // By synonym.
  const bySynonym = bom.productsContainingSubstanceNamedIn(customerId, "A ban on PFOA in textiles.");
  assert.equal(bySynonym.length, 1);

  // An unrelated rule matches nothing.
  assert.equal(
    bom.productsContainingSubstanceNamedIn(customerId, "Rules on wooden pallet fumigation.").length,
    0,
  );
});

test("components nest into a tree", async () => {
  const { customerId } = await operatingDb();
  const { product, coating, bom } = await seedCatalogue(customerId);
  bom.addComponent({ productId: product.id, name: "Plasticiser", parentComponentId: coating.id });

  const tree = bom.componentTree(product.id);
  const coatingNode = tree.find((n) => n.name === "PVC coating");
  assert.ok(coatingNode);
  assert.equal(coatingNode.children.length, 1);
  assert.equal(coatingNode.children[0].name, "Plasticiser");
});
