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
