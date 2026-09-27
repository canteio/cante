import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildSubstancesOpenApiSpec } from "./openapi";
import { RESTRICTION_VERDICTS, SUBSTANCES_ACTIONS } from "./contract";
import { GET as discover } from "../../app/api/substances/openapi/route";
import { operatingDb } from "@/lib/test-support/operating-db";

process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/substances/route");
let database: typeof import("../db/client");
let customerId: string;

before(async () => {
  // The real handler binds db/client at import time. Select throwaway storage
  // first so contract tests can never write to a user's compliance ledger.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/substances/route");
  database = await import("../db/client");
});
after(() => database.db.$client.close());

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
    "import { GET } from './app/api/substances/openapi/route.ts';",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/substances']?.delete) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DATA_BACKEND: "sqlite", CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the contract matches real component, declaration, list, assessment, and delete writes", async () => {
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { product } = upsertProduct(customerId, { sku: "API-CHEM-1", name: "Coated fabric" });

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

  const listResponse = await route.POST(jsonRequest({
    action: "load_list",
    name: "Test PFAS list",
    jurisdiction: "United States",
    entries: [{ name: "PFOA", casNumber: "335-67-1", thresholdPpm: 25, restriction: "restricted" }],
  }));
  assert.equal(listResponse.status, 200);
  assert.equal(typeof (await listResponse.json()).listId, "string");

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
});

test("documented 400 paths return JSON an agent can correct", async () => {
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
