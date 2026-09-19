import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { GET as discover } from "../../app/api/checks/openapi/route";
import { buildChecksOpenApiSpec } from "./runs-openapi";

process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/checks/route");
let database: typeof import("../db/client");

before(async () => {
  route = await import("../../app/api/checks/route");
  database = await import("../db/client");
  database.db.$client.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE check_runs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, jurisdiction TEXT NOT NULL,
      started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, error_message TEXT
    );
    INSERT INTO customers VALUES ('customer-1', 'Acme');
  `);
});
after(() => database.db.$client.close());

const contract: any = buildChecksOpenApiSpec().paths["/api/checks"];

test("checks discovery serves the exact cacheable GET and POST contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildChecksOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post"]);
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "404", "409", "500"]);
});

test("checks discovery imports without opening customer storage or invoking a provider", () => {
  const script = [
    "globalThis.fetch = () => { throw new Error('discovery called the network'); };",
    "const { GET } = await import('./app/api/checks/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/checks']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DATA_BACKEND: "sqlite", CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the documented history envelope matches a real empty-history response", async () => {
  const response = await route.GET(new Request("http://localhost/api/checks?customerId=customer-1&country=US"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { customerId: "customer-1", jurisdiction: "United States", runs: [] });
  assert.deepEqual(contract.get.responses["200"].content["application/json"].schema.required, Object.keys(payload));
});

test("direct Supabase checks return the documented scheduler-only conflict", async () => {
  process.env.CANTE_DATA_BACKEND = "supabase";
  try {
    const response = await route.POST(new Request("http://localhost/api/checks", { method: "POST" }));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload), contract.post.responses["409"].content["application/json"].schema.required);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /trusted local scheduler/);
  } finally {
    process.env.CANTE_DATA_BACKEND = "sqlite";
  }
});
