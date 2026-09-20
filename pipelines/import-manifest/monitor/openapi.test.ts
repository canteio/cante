import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImportMonitorOpenApiSpec } from "./openapi";
import { monitorQueryDocs } from "./query";

test("openapi spec lists every monitorQueryDocs parameter with a schema", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const params = spec.paths["/api/import-monitor"].get.parameters;
  const names = params.map(p => p.name).sort();
  assert.deepEqual(names, Object.keys(monitorQueryDocs).sort());
  for (const p of params) {
    assert.ok(p.schema && typeof p.schema === "object", `${p.name} missing schema`);
    assert.ok(p.schema.type, `${p.name} schema missing type`);
  }
});

test("enum param (kind) carries its values and default in the schema", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const kind = spec.paths["/api/import-monitor"].get.parameters.find(p => p.name === "kind")!;
  assert.deepEqual(kind.schema.enum, ["named_importer", "commodity_candidate", "all"]);
  assert.equal(kind.schema.default, "named_importer");
});

test("integer param (limit) carries min/max/default", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const limit = spec.paths["/api/import-monitor"].get.parameters.find(p => p.name === "limit")!;
  assert.equal(limit.schema.type, "integer");
  assert.equal(limit.schema.minimum, 1);
  assert.equal(limit.schema.maximum, 100);
  assert.equal(limit.schema.default, 50);
});

test("openapi paths declare all four documented response codes", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const responses = spec.paths["/api/import-monitor"].get.responses;
  assert.deepEqual(Object.keys(responses).sort(), ["200", "400", "401", "503"]);
});

test("every response now documents a JSON body schema, not just a prose description", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const responses = spec.paths["/api/import-monitor"].get.responses;
  for (const [code, response] of Object.entries(responses)) {
    const schema = response.content?.["application/json"]?.schema;
    assert.ok(schema, `${code} response missing content.application/json.schema`);
    assert.equal(schema.type, "object", `${code} schema should describe a JSON object`);
  }
});

test("200 schema's results item (lead) covers every field searchMonitor actually returns", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const okSchema = spec.paths["/api/import-monitor"].get.responses["200"].content["application/json"].schema;
  assert.deepEqual(Object.keys(okSchema.properties).sort(),
    ["caveats", "params", "results", "sources", "status", "total", "updatedAt"]);
  const leadProps = Object.keys(okSchema.properties.results.items.properties).sort();
  for (const field of ["id", "shipmentId", "importer", "recallId", "recallUrl", "recallTitle",
    "recallDate", "terms", "kind", "firstSeenAt", "newInLatestRun", "shipment"]) {
    assert.ok(leadProps.includes(field), `lead schema missing ${field}`);
  }
});

test("200 schema documents actionable source recovery without requiring it on healthy sources", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const okSchema = spec.paths["/api/import-monitor"].get.responses["200"].content["application/json"].schema;
  const sourceSchema = okSchema.properties.sources.properties.shipments;
  assert.equal(sourceSchema.properties.nextAction.type, "string");
  assert.ok(!(sourceSchema.required as readonly string[]).includes("nextAction"));
});

test("every response now carries a worked JSON example, not just a schema", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const responses = spec.paths["/api/import-monitor"].get.responses;
  for (const [code, response] of Object.entries(responses)) {
    const examples = response.content?.["application/json"]?.examples;
    assert.ok(examples && Object.keys(examples).length > 0, `${code} response missing a worked example`);
    for (const [name, example] of Object.entries(examples)) {
      assert.ok(example.value && typeof example.value === "object", `${code}/${name} example missing a value object`);
      assert.ok(example.summary, `${code}/${name} example missing a summary`);
    }
  }
});

test("200 example's results item satisfies the schema's required lead fields", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const ok = spec.paths["/api/import-monitor"].get.responses["200"].content["application/json"];
  const requiredLeadFields = ok.schema.properties.results.items.required;
  const exampleLead = ok.examples.current.value.results[0];
  for (const field of requiredLeadFields) assert.ok(field in exampleLead, `example lead missing required field ${field}`);
});

test("200 response also carries a worked commodity_candidate example (kind=all consumers see both shapes)", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const ok = spec.paths["/api/import-monitor"].get.responses["200"].content["application/json"];
  const commodityExample = ok.examples.commodityCandidate;
  assert.ok(commodityExample, "200 response missing commodityCandidate example");
  const lead = commodityExample.value.results[0];
  assert.equal(lead.kind, "commodity_candidate");
  const requiredLeadFields = ok.schema.properties.results.items.required;
  for (const field of requiredLeadFields) assert.ok(field in lead, `commodity_candidate example lead missing required field ${field}`);
});

test("200 response also carries a worked never_run example (fresh workspace, no data yet)", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const ok = spec.paths["/api/import-monitor"].get.responses["200"].content["application/json"];
  const neverRunExample = ok.examples.neverRun;
  assert.ok(neverRunExample, "200 response missing neverRun example");
  assert.equal(neverRunExample.value.status, "never_run");
  assert.equal(neverRunExample.value.sources, null, "never_run example should show sources: null, not a populated object");
  assert.deepEqual(neverRunExample.value.results, []);
});

test("lead schema's shipment field is a typed object, not a bare pointer to source", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const okSchema = spec.paths["/api/import-monitor"].get.responses["200"].content["application/json"].schema;
  const shipmentSchema = okSchema.properties.results.items.properties.shipment;
  assert.equal(shipmentSchema.type, "object");
  // Every field on ImportShipmentRow (schema/shipments.ts) should be documented
  // here so an agent never has to fall back to reading source for the shape.
  for (const field of ["id", "billOfLading", "carrierScac", "manifestSequenceNumber",
    "vesselName", "vesselImoCode", "voyageNumber", "portOfLadingCode", "portOfUnladingCode",
    "shipperName", "shipperAddress", "shipperCountryCode", "consigneeName", "consigneeAddress",
    "dataRedacted", "cargoDescription", "hsChapter", "grossWeightKg", "packageCount",
    "containerNumbers", "estimatedArrivalDate", "manifestFiledDate", "sourceType",
    "sourceFileRef", "ingestedAt"]) {
    assert.ok(field in shipmentSchema.properties, `shipment schema missing ${field}`);
  }
});

test("error responses (400/401/503) each require error + params in their schema", () => {
  const spec = buildImportMonitorOpenApiSpec();
  const responses = spec.paths["/api/import-monitor"].get.responses;
  for (const code of ["400", "401", "503"] as const) {
    const schema = responses[code].content["application/json"].schema;
    assert.deepEqual(schema.required.slice().sort(), ["error", "params"]);
  }
  const schema503 = responses["503"].content["application/json"].schema;
  assert.ok("retryable" in schema503.properties, "503 schema missing retryable");
});
