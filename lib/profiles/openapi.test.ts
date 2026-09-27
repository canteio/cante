import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { GET as discover } from "../../app/api/profiles/openapi/route";
import { JurisdictionProfileInputSchema, profileShapeDocs } from "./contract";
import { buildProfilesOpenApiSpec } from "./openapi";

process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/profiles/route");
let database: typeof import("../db/client");

before(async () => {
  // Import the stateful route only after its isolated database settings exist.
  route = await import("../../app/api/profiles/route");
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
    CREATE TABLE jurisdiction_profiles (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, country TEXT NOT NULL,
      legal_name TEXT, facility_addresses TEXT NOT NULL DEFAULT '[]',
      naics_codes TEXT NOT NULL DEFAULT '[]', products TEXT NOT NULL DEFAULT '[]',
      skus TEXT NOT NULL DEFAULT '[]', materials_chemicals TEXT NOT NULL DEFAULT '[]',
      manufacturing_processes TEXT NOT NULL DEFAULT '[]', waste_streams TEXT NOT NULL DEFAULT '[]',
      distribution_states TEXT NOT NULL DEFAULT '[]', labels_claims TEXT NOT NULL DEFAULT '[]',
      hts_schedule_b_codes TEXT NOT NULL DEFAULT '[]', export_classifications TEXT NOT NULL DEFAULT '[]',
      export_countries TEXT NOT NULL DEFAULT '[]', regulated_product_flags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO customers VALUES ('customer-1', 'Acme', 'United States', NULL, '2026-09-20T00:00:00Z');
  `);
});

after(() => database.db.$client.close());

const contract: any = buildProfilesOpenApiSpec().paths["/api/profiles"];
const jsonRequest = (body: unknown) => new Request("http://localhost/api/profiles", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("profile discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildProfilesOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "put"]);
  assert.deepEqual(Object.keys(contract.get.responses).sort(), ["200", "500"]);
  assert.deepEqual(Object.keys(contract.put.responses).sort(), ["200", "400", "404", "500"]);
  const documentedFields = Object.keys(
    contract.put.requestBody.content["application/json"].schema.properties.profile.properties,
  ).sort();
  assert.deepEqual(documentedFields, JurisdictionProfileInputSchema.keyof().options.sort());
  assert.deepEqual(documentedFields, Object.keys(profileShapeDocs).sort());
});

test("profile discovery imports without initializing storage", () => {
  const script = [
    "const { GET } = await import('./app/api/profiles/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/profiles']?.put) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("real routes store and read a normalized jurisdiction profile", async () => {
  const empty = await route.GET(new Request("http://localhost/api/profiles?customerId=customer-1&country=US"));
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { country: "United States", profile: null });

  const savedResponse = await route.PUT(jsonRequest({
    customerId: "customer-1",
    country: "USA",
    profile: {
      legalName: "  Acme Imports  ",
      products: ["toys"],
      naicsCodes: [{ code: " 423920 " }],
    },
  }));
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.country, "United States");
  assert.equal(saved.profile.legalName, "Acme Imports");
  assert.deepEqual(saved.profile.naicsCodes, [{ code: "423920", basis: "entered in profile", confirmed: false }]);

  const loaded = await route.GET(new Request("http://localhost/api/profiles?customerId=customer-1&country=United%20States"));
  assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).profile.id, saved.profile.id);
});

test("primitive and malformed profile requests return corrective JSON", async () => {
  for (const body of [null, [], "profile"]) {
    const response = await route.PUT(jsonRequest(body));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /JSON object/);
    assert.deepEqual(payload.shape, profileShapeDocs);
  }

  const malformed = await route.PUT(jsonRequest({ customerId: "customer-1", profile: { products: "toys" } }));
  assert.equal(malformed.status, 400);
  assert.deepEqual((await malformed.json()).shape, profileShapeDocs);
});
