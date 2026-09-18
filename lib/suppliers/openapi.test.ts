import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSuppliersOpenApiSpec } from "./openapi";
import { EVIDENCE_TYPES } from "./evidence";

test("suppliers openapi spec declares GET and POST for /api/suppliers", () => {
  const spec = buildSuppliersOpenApiSpec();
  const path = spec.paths["/api/suppliers"];
  assert.ok(path.get, "missing GET operation");
  assert.ok(path.post, "missing POST operation");
});

test("GET response documents suppliers array plus gaps/suggestions/screeningCoverage", () => {
  const spec = buildSuppliersOpenApiSpec();
  const props = spec.paths["/api/suppliers"].get.responses["200"].content["application/json"].schema.properties;
  assert.ok(props.suppliers);
  assert.ok(props.gaps);
  assert.ok(props.suggestions);
  assert.ok(props.screeningCoverage);
  // documents + latestScreening are joined onto each supplier row, not top-level
  const supplierItem: any = props.suppliers.items.allOf[1].properties;
  assert.ok(supplierItem.documents);
  assert.ok(supplierItem.latestScreening);
});

test("docType enum in the spec never drifts from EVIDENCE_TYPES", () => {
  const spec = buildSuppliersOpenApiSpec();
  const evidenceShape: any = spec.paths["/api/suppliers"].post.requestBody.content["application/json"].schema.oneOf[1];
  assert.deepEqual([...evidenceShape.properties.docType.enum].sort(), [...EVIDENCE_TYPES].sort());
});

test("POST request body documents all 4 actions via oneOf, each requiring `action`", () => {
  const spec = buildSuppliersOpenApiSpec();
  const bodySchema = spec.paths["/api/suppliers"].post.requestBody.content["application/json"].schema;
  assert.equal(bodySchema.oneOf.length, 4);
  const actionEnums = bodySchema.oneOf.map((shape: any) => shape.properties.action.enum[0]);
  assert.deepEqual(actionEnums.sort(), ["evidence", "request", "screen", "upsert"]);
});

test("request mode documents delivered as always false — never implies a message was sent", () => {
  const spec = buildSuppliersOpenApiSpec();
  const responseProps = spec.paths["/api/suppliers"].post.responses["200"].content["application/json"].schema.properties;
  assert.deepEqual(responseProps.delivered.enum, [false]);
});

test("POST responses cover every status code the route handler actually returns", () => {
  const spec = buildSuppliersOpenApiSpec();
  const responses = spec.paths["/api/suppliers"].post.responses;
  // route.ts: 200 (all 4 actions), 400 (bad body/no customer/EvidenceError/unknown action), 500 (unexpected).
  assert.deepEqual(Object.keys(responses).sort(), ["200", "400", "500"]);
});
