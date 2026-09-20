import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { GET as discover } from "../../app/api/customers/openapi/route";
import { PROVIDER_OPTIONS } from "../llm/provider-choice";
import { buildCustomersOpenApiSpec } from "./openapi";

process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
process.env.CANTE_LLM_LOCKED = "true";
process.env.CANTE_LLM = "api";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
let route: typeof import("../../app/api/customers/route");
let database: typeof import("../db/client");

before(async () => {
  // Import the stateful route only after its isolated database settings exist.
  route = await import("../../app/api/customers/route");
  database = await import("../db/client");
  database.db.$client.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL,
      city TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE sources (
      id TEXT PRIMARY KEY, country TEXT NOT NULL, name TEXT NOT NULL,
      domain TEXT NOT NULL, url TEXT NOT NULL, regulation_type TEXT NOT NULL,
      reliability_status TEXT NOT NULL, view TEXT, notes TEXT, last_success_at TEXT
    );
    INSERT INTO customers VALUES
      ('customer-z', 'Zulu Imports', 'United States', NULL, '2026-09-20T00:00:00Z'),
      ('customer-a', 'Acme Goods', 'United States', 'Chicago', '2026-09-19T00:00:00Z');
    INSERT INTO sources VALUES
      ('source-z', 'United States', 'Zulu Register', 'zulu.example', 'https://zulu.example', 'trade', 'working', NULL, NULL, NULL),
      ('source-a', 'United States', 'Agency Notices', 'agency.example', 'https://agency.example', 'national', 'working', 'notices', 'Official notices', '2026-09-20T01:00:00Z');
  `);
});

after(() => database.db.$client.close());

const contract: any = buildCustomersOpenApiSpec().paths["/api/customers"].get;

test("customer discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildCustomersOpenApiSpec());
  assert.deepEqual(Object.keys(contract.responses).sort(), ["200", "500"]);
  const providerSchema = contract.responses["200"].content["application/json"].schema
    .properties.llm.properties.provider;
  assert.deepEqual(providerSchema.enum, PROVIDER_OPTIONS.map(({ id }) => id));
});

test("customer discovery imports without initializing storage or probing a model", () => {
  const script = [
    "const { GET } = await import('./app/api/customers/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/customers']?.get) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DB_PATH: "/dev/null/cante.db", PATH: "/definitely/missing" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("real customer route returns ordered rows and provider health", async () => {
  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.customers.map(({ name }: { name: string }) => name), ["Acme Goods", "Zulu Imports"]);
  assert.equal(payload.customers[0].city, "Chicago");
  assert.deepEqual(payload.sources.map(({ name }: { name: string }) => name), ["Agency Notices", "Zulu Register"]);
  assert.deepEqual(payload.llm, {
    provider: "api",
    ok: false,
    detail: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY for the hosted runtime.",
  });
});
