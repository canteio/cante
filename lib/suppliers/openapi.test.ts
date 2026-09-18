import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { buildSuppliersOpenApiSpec } from "./openapi";
import { EVIDENCE_TYPES } from "./contract";
import { GET as discover } from "../../app/api/suppliers/openapi/route";
import { operatingDb } from "@/lib/test-support/operating-db";

process.env.CANTE_DATA_BACKEND = "sqlite";
process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/suppliers/route");
let database: typeof import("../db/client");
let customerId: string;

before(async () => {
  // Import the real route only after throwaway storage is selected. db/client
  // resolves CANTE_DB_PATH once, so reversing this order risks the user ledger.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/suppliers/route");
  database = await import("../db/client");
});
after(() => database.db.$client.close());

const contract = buildSuppliersOpenApiSpec().paths["/api/suppliers"];
function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/suppliers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("suppliers openapi spec declares GET and POST for /api/suppliers", () => {
  assert.ok(contract.get, "missing GET operation");
  assert.ok(contract.post, "missing POST operation");
});

test("GET response documents suppliers array plus gaps/suggestions/screeningCoverage", () => {
  const props = contract.get.responses["200"].content["application/json"].schema.properties;
  assert.ok(props.suppliers);
  assert.ok(props.gaps);
  assert.ok(props.suggestions);
  assert.ok(props.screeningCoverage);
  // Documents and latestScreening are joined onto each supplier, not top-level.
  const supplierItem: any = props.suppliers.items.allOf[1].properties;
  assert.ok(supplierItem.documents);
  assert.ok(supplierItem.latestScreening);
});

test("docType enum in the spec never drifts from route validation", () => {
  const evidenceShape: any = contract.post.requestBody.content["application/json"].schema.oneOf[1];
  assert.deepEqual([...evidenceShape.properties.docType.enum].sort(), [...EVIDENCE_TYPES].sort());
});

test("POST request body documents all 4 actions via oneOf", () => {
  const bodySchema = contract.post.requestBody.content["application/json"].schema;
  assert.equal(bodySchema.oneOf.length, 4);
  const actionEnums = bodySchema.oneOf.map((shape: any) => shape.properties.action.enum[0]);
  assert.deepEqual(actionEnums.sort(), ["evidence", "request", "screen", "upsert"]);
});

test("request mode documents delivered as always false", () => {
  const responseProps = contract.post.responses["200"].content["application/json"].schema.properties;
  assert.deepEqual(responseProps.delivered.enum, [false]);
});

test("POST responses cover every status code the route handler returns", () => {
  // route.ts: 200 (all actions), 400 (caller-fixable input), 500 (unexpected).
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400", "500"]);
});

test("suppliers discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildSuppliersOpenApiSpec());
});

test("supplier contract matches a real POST write and joined GET read", async () => {
  const create = await route.POST(jsonRequest({
    customerId,
    action: "upsert",
    name: "Acme Components",
    country: "Mexico",
    role: "manufacturer",
    contactEmail: "trade@acme.example",
  }));
  assert.equal(create.status, 200);
  const { supplier } = await create.json();
  assert.equal(supplier.name, "Acme Components");
  assert.equal(supplier.country, "Mexico");

  const get = await route.GET(new Request(`http://localhost/api/suppliers?customerId=${customerId}`));
  assert.equal(get.status, 200);
  const payload = await get.json();
  assert.equal(payload.suppliers.length, 1);
  assert.equal(payload.suppliers[0].id, supplier.id);
  assert.deepEqual(payload.suppliers[0].documents, []);
  assert.equal(payload.suppliers[0].latestScreening, null);
  assert.equal(payload.screeningCoverage.totalSuppliers, 1);
  assert.deepEqual(payload.screeningCoverage.neverScreened, ["Acme Components"]);
});

test("evidence and request contracts match real persisted action responses", async () => {
  const list = await route.GET(new Request(`http://localhost/api/suppliers?customerId=${customerId}`));
  const supplierId = (await list.json()).suppliers[0].id;

  const evidence = await route.POST(jsonRequest({
    customerId,
    action: "evidence",
    supplierId,
    docType: "certificate_of_origin",
    status: "received",
    expiresAt: "2027-09-18",
  }));
  assert.equal(evidence.status, 200);
  const evidencePayload = await evidence.json();
  assert.equal(evidencePayload.document.status, "received");
  assert.equal(evidencePayload.document.docType, "certificate_of_origin");

  const request = await route.POST(jsonRequest({
    customerId,
    action: "request",
    supplierId,
    docType: "pfas",
  }));
  assert.equal(request.status, 200);
  const requestPayload = await request.json();
  assert.equal(requestPayload.record.status, "requested");
  assert.equal(requestPayload.delivered, false);
  assert.match(requestPayload.draftMessage, /Acme Components/);

  const get = await route.GET(new Request(`http://localhost/api/suppliers?customerId=${customerId}`));
  const documents = (await get.json()).suppliers[0].documents;
  assert.deepEqual(documents.map((document: { docType: string }) => document.docType).sort(), ["certificate_of_origin", "pfas"]);
});

test("documented 400 responses match malformed, unknown-action, and invalid-enum requests", async () => {
  const malformed = await route.POST(new Request("http://localhost/api/suppliers", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, "string");

  const unknown = await route.POST(jsonRequest({ customerId, action: "ship" }));
  assert.equal(unknown.status, 400);
  assert.deepEqual((await unknown.json()).validActions, ["upsert", "evidence", "request", "screen"]);

  const list = await route.GET(new Request(`http://localhost/api/suppliers?customerId=${customerId}`));
  const supplierId = (await list.json()).suppliers[0].id;
  const invalidType = await route.POST(jsonRequest({
    customerId,
    action: "evidence",
    supplierId,
    docType: "mystery_certificate",
    status: "received",
  }));
  assert.equal(invalidType.status, 400);
  assert.match((await invalidType.json()).error, /Unknown document type/);
});
