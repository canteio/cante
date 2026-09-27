import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { GET as discover } from "../../app/api/memories/openapi/route";
import { MEMORY_KINDS } from "./contract";
import { buildMemoriesOpenApiSpec } from "./openapi";

process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/memories/route");
let database: typeof import("../db/client");

before(async () => {
  // Bind the real handler to isolated storage before its database imports run.
  route = await import("../../app/api/memories/route");
  database = await import("../db/client");
  database.db.$client.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL,
      city TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE customer_profiles (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, product_description TEXT NOT NULL,
      business_type TEXT, side_of_trade TEXT NOT NULL DEFAULT 'export',
      hs_codes TEXT NOT NULL, kbli_codes TEXT NOT NULL, destination_markets TEXT NOT NULL,
      hs_codes_confirmed INTEGER NOT NULL DEFAULT 0,
      destinations_confirmed INTEGER NOT NULL DEFAULT 0,
      relevance_guidance TEXT NOT NULL
    );
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT 'United States',
      kind TEXT NOT NULL DEFAULT 'other', content TEXT NOT NULL,
      source TEXT, origin TEXT NOT NULL DEFAULT 'manual',
      confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO customers VALUES ('customer-1', 'Acme', 'United States', NULL, '2026-09-20T00:00:00Z');
  `);
});

after(() => database.db.$client.close());

const contract: any = buildMemoriesOpenApiSpec().paths["/api/memories"];
function jsonRequest(method: "POST" | "PATCH", body: unknown) {
  return new Request("http://localhost/api/memories", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("memory discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildMemoriesOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post", "patch", "delete"]);
  assert.deepEqual(
    contract.post.requestBody.content["application/json"].schema.properties.kind.enum,
    MEMORY_KINDS,
  );
});

test("memory discovery imports without initializing storage", () => {
  const script = [
    "const { GET } = await import('./app/api/memories/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/memories']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("real routes create, list, update, and delete a memory", async () => {
  const createdResponse = await route.POST(jsonRequest("POST", {
    customerId: "customer-1",
    country: "US",
    kind: "product",
    content: "  Imports wooden toys  ",
    source: "operator interview",
  }));
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()).memory;
  assert.equal(created.content, "Imports wooden toys");
  assert.equal(created.jurisdiction, "United States");
  assert.equal(created.kind, "product");
  assert.equal(created.confirmed, true);

  const listedResponse = await route.GET(new Request("http://localhost/api/memories?customerId=customer-1&country=USA"));
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  assert.equal(listed.jurisdiction, "United States");
  assert.deepEqual(listed.memories.map((memory: { id: string }) => memory.id), [created.id]);

  const updated = await route.PATCH(jsonRequest("PATCH", { id: created.id, confirmed: false }));
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ok: true });

  const duplicate = await route.POST(jsonRequest("POST", {
    customerId: "customer-1",
    content: "imports wooden toys",
  }));
  assert.equal(duplicate.status, 409);

  const removed = await route.DELETE(new Request(`http://localhost/api/memories?id=${created.id}`, { method: "DELETE" }));
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true });
  const empty = await route.GET(new Request("http://localhost/api/memories?customerId=customer-1"));
  assert.deepEqual((await empty.json()).memories, []);
});

test("primitive and incomplete requests return documented corrective JSON", async () => {
  for (const body of [null, [], "memory"]) {
    const response = await route.POST(jsonRequest("POST", body));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON object/);
  }

  const patch = await route.PATCH(jsonRequest("PATCH", { id: "memory-1", confirmed: "yes" }));
  assert.equal(patch.status, 400);
  assert.match((await patch.json()).error, /boolean `confirmed`/);

  const deletion = await route.DELETE(new Request("http://localhost/api/memories", { method: "DELETE" }));
  assert.equal(deletion.status, 400);
  assert.deepEqual(await deletion.json(), { error: "No id." });
});
