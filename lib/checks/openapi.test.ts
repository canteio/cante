import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { buildChecklistOpenApiSpec } from "./openapi";
import { GET as discover } from "../../app/api/checklist/openapi/route";

process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/checklist/route");
let database: typeof import("../db/client");
before(async () => {
  route = await import("../../app/api/checklist/route");
  database = await import("../db/client");
  database.db.$client.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE checklist_items (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT);
    INSERT INTO checklist_items VALUES ('contract-item', 'required', 'initial');
  `);
});
after(() => database.db.$client.close());
const contract = buildChecklistOpenApiSpec().paths["/api/checklist"];
function request(method: string, body: unknown) {
  return new Request("http://localhost/api/checklist", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("checklist discovery serves the generated contract as cacheable JSON", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildChecklistOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post", "patch"]);
});

test("checklist GET's real no-customer response does not require jurisdiction", async () => {
  const response = await route.GET(new Request("http://localhost/api/checklist"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
  assert.deepEqual(contract.get.responses["200"].content["application/json"].schema.required, Object.keys(payload));
});

test("checklist POST's real unresolved-customer response matches the documented error", async () => {
  const response = await route.POST(request("POST", {}));
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(typeof payload.error, "string");
  assert.deepEqual(contract.post.responses["404"].content["application/json"].schema.required, Object.keys(payload));
});

test("every status advertised by discovery is accepted and persisted by PATCH", async () => {
  const schema = contract.patch.requestBody.content["application/json"].schema;
  for (const status of schema.properties.status.enum) {
    const response = await route.PATCH(request("PATCH", { id: " contract-item ", status }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: contract.patch.responses["200"].content["application/json"].schema.properties.ok.const });
    assert.deepEqual(database.db.$client.prepare("SELECT status FROM checklist_items WHERE id = ?").get("contract-item"), { status });
  }
  const response = await route.PATCH(request("PATCH", { id: "contract-item", status: "done" }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.deepEqual(payload.shape.status.enum, schema.properties.status.enum);
  assert.deepEqual(Object.keys(payload).sort(), [...contract.patch.responses["400"].content["application/json"].schema.required].sort());
  assert.ok(payload.issues.length > 0);
});

test("discovery discloses PATCH's no-op success for unknown IDs", async () => {
  const response = await route.PATCH(request("PATCH", { id: "missing", status: "completed" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(contract.patch.description, /unknown IDs also return ok: true/);
  assert.equal(database.db.$client.prepare("SELECT id FROM checklist_items WHERE id = ?").get("missing"), undefined);
});
