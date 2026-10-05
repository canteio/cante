import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChecklistOpenApiSpec } from "./openapi";
import { GET as discover } from "../../app/api/checklist/openapi/route";
import { createServiceClient } from "@/lib/supabase/service";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

process.env.CANTE_AUTH_MODE = "none";
const contract = buildChecklistOpenApiSpec().paths["/api/checklist"];

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/checklist", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function readStatus(id: string) {
  const { data, error } = await createServiceClient()
    .from("checklist_items").select("status").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.status ?? null;
}

test("checklist discovery serves the generated contract as cacheable JSON", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildChecklistOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post", "patch"]);
});

test("checklist GET's real no-customer response does not require jurisdiction", async () => {
  const route = await import("../../app/api/checklist/route");
  const response = await route.GET(new Request("http://localhost/api/checklist"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
  assert.deepEqual(contract.get.responses["200"].content["application/json"].schema.required, ["items"]);
});

test("checklist POST's real unresolved-customer response matches the documented error", async () => {
  const route = await import("../../app/api/checklist/route");
  const response = await route.POST(request("POST", {}));
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(typeof payload.error, "string");
  assert.deepEqual(contract.post.responses["404"].content["application/json"].schema.required, Object.keys(payload));
});

test("every status advertised by discovery is accepted and persisted by PATCH", async () => {
  const route = await import("../../app/api/checklist/route");
  const { customerId } = await operatingDb();
  const itemId = "contract-item";
  const { error: seedError } = await createServiceClient().from("checklist_items").insert({
    id: itemId, customer_id: customerId, title: "Contract item", status: "required",
  });
  if (seedError) throw new Error(seedError.message);

  const schema = contract.patch.requestBody.content["application/json"].schema;
  for (const status of schema.properties.status.enum) {
    const response = await route.PATCH(request("PATCH", { id: ` ${itemId} `, status }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: contract.patch.responses["200"].content["application/json"].schema.properties.ok.const });
    assert.equal(await readStatus(itemId), status);
  }
  const response = await route.PATCH(request("PATCH", { id: itemId, status: "done" }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.deepEqual(payload.shape.status.enum, schema.properties.status.enum);
  assert.deepEqual(Object.keys(payload).sort(), [...contract.patch.responses["400"].content["application/json"].schema.required].sort());
  assert.ok(payload.issues.length > 0);
});

test("unknown checklist IDs return the documented 404 instead of a no-op success", async () => {
  const route = await import("../../app/api/checklist/route");
  const response = await route.PATCH(request("PATCH", { id: " missing ", status: "completed" }));
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.match(payload.error, /Checklist item "missing" was not found/);
  assert.deepEqual(
    Object.keys(payload),
    contract.patch.responses["404"].content["application/json"].schema.required,
  );
  assert.match(contract.patch.description, /Unknown IDs return 404/);
  assert.equal(await readStatus("missing"), null);
});
