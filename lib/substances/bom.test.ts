import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";

async function seedCatalogue(customerId: string) {
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const bom = await import("@/lib/substances/bom");
  const { product } = await upsertProduct(customerId, { sku: "TARP-12", name: "Blue tarp" });
  const coating = await bom.addComponent({ productId: product.id, name: "PVC coating", massGrams: 800 });
  const scrim = await bom.addComponent({ productId: product.id, name: "Polyester scrim", massGrams: 400 });
  return { product, coating, scrim, bom };
}

/**
 * loadRestrictionList() calls a privilege-gated RPC
 * (private.is_trusted_operator(), owner/admin-only) requiring a genuine
 * end-user auth session — the test harness's service-role client correctly
 * has no auth.uid(), so that gate rejecting it is the gate working as
 * designed, not a bug. Seed the shared reference tables directly instead.
 * These rows have no customer_id (they are global reference data, not
 * per-tenant) so they are NOT covered by the harness's per-customer
 * cascade cleanup — the caller must delete them itself.
 */
async function seedRestrictionList(entries: Array<{ name: string; casNumber: string; thresholdPpm: number }>) {
  const client = createServiceClient();
  const listId = randomUUID();
  const substanceIds: string[] = [];
  const { error: listError } = await client.from("restricted_substance_lists").insert({
    id: listId, name: "Test PFAS restriction", jurisdiction: "United States",
    captured_at: new Date().toISOString(),
  });
  if (listError) throw new Error(listError.message);
  for (const entry of entries) {
    const { data: existing } = await client.from("substances")
      .select("id").eq("cas_number", entry.casNumber).maybeSingle();
    const substanceId = existing?.id ?? randomUUID();
    if (!existing) {
      const { error: subError } = await client.from("substances").insert({
        id: substanceId, name: entry.name, cas_number: entry.casNumber,
      });
      if (subError) throw new Error(subError.message);
      substanceIds.push(substanceId);
    }
    const { error: entryError } = await client.from("restricted_substance_entries").insert({
      id: randomUUID(), list_id: listId, substance_id: substanceId,
      threshold_ppm: entry.thresholdPpm, restriction: "restricted",
    });
    if (entryError) throw new Error(entryError.message);
  }
  return {
    listId,
    async cleanup() {
      await client.from("restricted_substance_entries").delete().eq("list_id", listId);
      await client.from("restricted_substance_lists").delete().eq("id", listId);
      await client.from("substances").delete().in("id", substanceIds);
    },
  };
}

test("a restriction check with no lists loaded is a gap, not a pass", async () => {
  const { customerId } = await operatingDb();
  const { assessRestrictions } = await import("@/lib/substances/bom");
  const result = await assessRestrictions(customerId);
  assert.equal(result.hits.length, 0);
  assert.match(result.caveats[0], /coverage gap, not a clean result/);
});

test("over threshold, below threshold, unknown amount, and undeclared are four answers", async () => {
  const { customerId } = await operatingDb();
  const { coating, scrim, bom } = await seedCatalogue(customerId);
  const list = await seedRestrictionList([
    { name: "PFOA", casNumber: "335-67-1", thresholdPpm: 25 },
    { name: "Lead", casNumber: "7439-92-1", thresholdPpm: 1000 },
  ]);

  try {
    const pfoa = await bom.upsertSubstance({ name: "PFOA", casNumber: "335-67-1" });
    const lead = await bom.upsertSubstance({ name: "Lead", casNumber: "7439-92-1" });

    await bom.declareSubstance({
      componentId: coating.id,
      substanceId: pfoa.id,
      concentrationPpm: 40,
      tier: "document",
      basis: "supplier material declaration",
    });
    await bom.declareSubstance({
      componentId: coating.id,
      substanceId: lead.id,
      concentrationPpm: 12,
      tier: "document",
      basis: "supplier material declaration",
    });
    // scrim is left undeclared on purpose.

    const result = await bom.assessRestrictions(customerId);
    const byVerdict = new Map(result.hits.map((h) => [h.verdict, h]));

    assert.ok(byVerdict.get("over_threshold"), "PFOA at 40ppm exceeds the 25ppm threshold");
    assert.equal(byVerdict.get("over_threshold")?.substanceName, "PFOA");
    assert.ok(byVerdict.get("below_threshold"), "lead at 12ppm is under 1000ppm");

    assert.equal(result.undeclaredComponents.length, 1);
    assert.equal(result.undeclaredComponents[0].componentName, "Polyester scrim");
    assert.match(result.caveats.join(" "), /NOT assessed and must not be read as clear/);

    // Presence with no stated amount is its own verdict, and is not a pass.
    await bom.declareSubstance({
      componentId: scrim.id,
      substanceId: pfoa.id,
      concentrationPpm: null,
      tier: "lead",
      basis: "inferred from material description",
    });
    const second = await bom.assessRestrictions(customerId);
    const unknown = second.hits.find((h) => h.verdict === "present_unknown_amount");
    assert.ok(unknown);
    assert.match(unknown.detail, /cannot be cleared/);
    assert.match(second.caveats.join(" "), /lead-tier declarations/);
  } finally {
    await list.cleanup();
  }
});

test("a regulation naming a CAS number finds the product containing it", async () => {
  const { customerId } = await operatingDb();
  const { coating, bom } = await seedCatalogue(customerId);
  const pfoa = await bom.upsertSubstance({
    name: "Perfluorooctanoic acid",
    casNumber: "335-67-1",
    synonyms: ["PFOA"],
  });
  await bom.declareSubstance({
    componentId: coating.id,
    substanceId: pfoa.id,
    concentrationPpm: 40,
    tier: "document",
    basis: "declaration",
  });

  // By CAS number, which is how restriction rules actually cite substances.
  const byCas = await bom.productsContainingSubstanceNamedIn(
    customerId,
    "This rule restricts perfluoroalkyl substances including CAS 335-67-1 in consumer articles.",
  );
  assert.equal(byCas.length, 1);
  assert.equal(byCas[0].productSku, "TARP-12");
  assert.equal(byCas[0].componentName, "PVC coating");

  // By synonym.
  const bySynonym = await bom.productsContainingSubstanceNamedIn(customerId, "A ban on PFOA in textiles.");
  assert.equal(bySynonym.length, 1);

  // An unrelated rule matches nothing.
  assert.equal(
    (await bom.productsContainingSubstanceNamedIn(customerId, "Rules on wooden pallet fumigation.")).length,
    0,
  );
});

test("components nest into a tree", async () => {
  const { customerId } = await operatingDb();
  const { product, coating, bom } = await seedCatalogue(customerId);
  await bom.addComponent({ productId: product.id, name: "Plasticiser", parentComponentId: coating.id });

  const tree = await bom.componentTree(product.id);
  const coatingNode = tree.find((n) => n.name === "PVC coating");
  assert.ok(coatingNode);
  assert.equal(coatingNode.children.length, 1);
  assert.equal(coatingNode.children[0].name, "Plasticiser");
});
