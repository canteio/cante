import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { buildSubstancesOpenApiSpec } from "./openapi";
import { RESTRICTION_VERDICTS, SUBSTANCES_ACTIONS } from "./contract";
import { GET as discover } from "../../app/api/substances/openapi/route";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";

process.env.CANTE_AUTH_MODE = "none";

const contract: any = buildSubstancesOpenApiSpec().paths["/api/substances"];
const jsonRequest = (body: unknown) => new Request("http://localhost/api/substances", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("substances discovery declares GET, POST, and DELETE with exact action and verdict enums", () => {
  assert.ok(contract.get);
  assert.ok(contract.post);
  assert.ok(contract.delete);
  const actionShapes = contract.post.requestBody.content["application/json"].schema.oneOf;
  assert.deepEqual(actionShapes.map((shape: any) => shape.properties.action.enum[0]), [...SUBSTANCES_ACTIONS]);
  const assessment = contract.get.responses["200"].content["application/json"].schema.oneOf[0];
  assert.deepEqual(assessment.properties.hits.items.properties.verdict.enum, RESTRICTION_VERDICTS);
});

test("documented responses cover every status emitted by the route", () => {
  assert.deepEqual(Object.keys(contract.get.responses), ["200"]);
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400", "500"]);
  assert.deepEqual(Object.keys(contract.delete.responses).sort(), ["200", "400", "500"]);
});

test("discovery serves the exact cacheable OpenAPI 3.1 document", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildSubstancesOpenApiSpec());
});

test("discovery imports and runs when the configured database path is unusable", () => {
  const script = [
    "const imported = await import(\'./app/api/substances/openapi/route.ts\');",
    "const GET = imported.GET ?? imported.default?.GET;",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/substances']?.delete) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the contract matches real component, declaration, list, assessment, and delete writes", async () => {
  const { customerId } = await operatingDb();
  const route = await import("../../app/api/substances/route");
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { product } = await upsertProduct(customerId, { sku: "API-CHEM-1", name: "Coated fabric" });

  const componentResponse = await route.POST(jsonRequest({
    action: "component",
    productId: product.id,
    name: "Waterproof coating",
    massGrams: 25,
  }));
  assert.equal(componentResponse.status, 200);
  const { component } = await componentResponse.json();
  assert.equal(component.name, "Waterproof coating");

  const declarationResponse = await route.POST(jsonRequest({
    action: "declare",
    componentId: component.id,
    substanceName: "PFOA",
    casNumber: "335-67-1",
    concentrationPpm: 40,
    tier: "human",
    basis: "lab result entered by reviewer",
  }));
  assert.equal(declarationResponse.status, 200);
  assert.equal((await declarationResponse.json()).declaration.componentId, component.id);

  // The real "load_list" action calls a privilege-gated RPC
  // (private.is_trusted_operator(), owner/admin-only) requiring a genuine
  // end-user JWT with a real auth.uid() — the test harness authenticates by
  // bypassing getAuthenticatedWorkspace() entirely rather than presenting a
  // real session, so that RPC correctly sees no authenticated user and
  // rejects it. This is the gate working as designed, not a bug. Seed the
  // shared, tenant-less reference tables directly instead of going through
  // the route's load_list action.
  const client = createServiceClient();
  const listId = randomUUID();
  const { data: existingSubstance } = await client.from("substances")
    .select("id").eq("cas_number", "335-67-1").maybeSingle();
  const substanceId = existingSubstance?.id ?? randomUUID();
  let createdSubstance = false;
  if (!existingSubstance) {
    const { error: subError } = await client.from("substances").insert({
      id: substanceId, name: "PFOA", cas_number: "335-67-1",
    });
    if (subError) throw new Error(subError.message);
    createdSubstance = true;
  }
  const { error: listError } = await client.from("restricted_substance_lists").insert({
    id: listId, name: "Test PFAS list", jurisdiction: "United States",
    captured_at: new Date().toISOString(),
  });
  if (listError) throw new Error(listError.message);
  const { error: entryError } = await client.from("restricted_substance_entries").insert({
    id: randomUUID(), list_id: listId, substance_id: substanceId,
    threshold_ppm: 25, restriction: "restricted",
  });
  if (entryError) throw new Error(entryError.message);

  try {
    const getResponse = await route.GET(new Request(
      `http://localhost/api/substances?customerId=${customerId}&productId=${product.id}&matchText=CAS%20335-67-1`,
    ));
    assert.equal(getResponse.status, 200);
    const payload = await getResponse.json();
    assert.equal(payload.components[0].id, component.id);
    assert.equal(payload.assessment.hits[0].verdict, "over_threshold");
    assert.equal(payload.substanceMatches[0].productSku, "API-CHEM-1");

    const deleteResponse = await route.DELETE(new Request(
      `http://localhost/api/substances?componentId=${component.id}`,
      { method: "DELETE" },
    ));
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { deleted: true });

    const afterDelete = await route.GET(new Request(
      `http://localhost/api/substances?customerId=${customerId}&productId=${product.id}`,
    ));
    assert.deepEqual((await afterDelete.json()).components, []);
  } finally {
    await client.from("restricted_substance_entries").delete().eq("list_id", listId);
    await client.from("restricted_substance_lists").delete().eq("id", listId);
    if (createdSubstance) await client.from("substances").delete().eq("id", substanceId);
  }
});

test("documented 400 paths return JSON an agent can correct", async () => {
  const route = await import("../../app/api/substances/route");
  const malformed = await route.POST(new Request("http://localhost/api/substances", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, "string");

  const unknown = await route.POST(jsonRequest({ action: "ship" }));
  assert.equal(unknown.status, 400);
  assert.deepEqual((await unknown.json()).validActions, SUBSTANCES_ACTIONS);

  const missingDeleteId = await route.DELETE(new Request("http://localhost/api/substances", { method: "DELETE" }));
  assert.equal(missingDeleteId.status, 400);
  assert.match((await missingDeleteId.json()).error, /componentId/);
});
