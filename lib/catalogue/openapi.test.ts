import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProductsOpenApiSpec } from "./openapi";

test("products openapi spec declares GET, POST and DELETE for /api/products", () => {
  const spec = buildProductsOpenApiSpec();
  const path = spec.paths["/api/products"];
  assert.ok(path.get, "missing GET operation");
  assert.ok(path.post, "missing POST operation");
  assert.ok(path.delete, "missing DELETE operation");
});

test("GET response documents products array with classifications attached", () => {
  const spec = buildProductsOpenApiSpec();
  const props = spec.paths["/api/products"].get.responses["200"].content["application/json"].schema.properties;
  assert.ok(props.products);
  const productItem: any = props.products.items.allOf[1].properties;
  assert.ok(productItem.classifications);
});

test("POST request body documents single-upsert, JSON-csv and multipart-file modes", () => {
  const spec = buildProductsOpenApiSpec();
  const post = spec.paths["/api/products"].post;
  const jsonSchema = post.requestBody.content["application/json"].schema;
  assert.equal(jsonSchema.oneOf.length, 2);
  const requiredSets = jsonSchema.oneOf.map((shape: any) => [...shape.required].sort());
  assert.deepEqual(requiredSets, [["name", "sku"], ["csv"]]);
  assert.ok(post.requestBody.content["multipart/form-data"], "missing multipart mode documentation");
});

test("productClass enum matches the four classes the route/lib actually accept", () => {
  const spec = buildProductsOpenApiSpec();
  const productItem: any = spec.paths["/api/products"].get.responses["200"].content["application/json"].schema.properties.products.items.allOf[0];
  assert.deepEqual([...productItem.properties.productClass.enum].sort(), ["component", "consumer", "industrial", "unknown"]);
});

test("import summary schema always reports per-row outcomes, never a bare count", () => {
  const spec = buildProductsOpenApiSpec();
  const summarySchema = spec.paths["/api/products"].post.responses["200"].content["application/json"].schema.properties.summary;
  assert.ok(summarySchema.properties.rows, "summary must expose per-row outcomes");
  assert.deepEqual(
    [...summarySchema.properties.rows.items.properties.outcome.enum].sort(),
    ["created", "rejected", "unchanged", "updated"],
  );
});

test("DELETE responses cover the status codes the route handler actually returns", () => {
  const spec = buildProductsOpenApiSpec();
  const responses = spec.paths["/api/products"].delete.responses;
  // route.ts DELETE: 200 (deleted true/false), 400 (missing params), 500 (unexpected).
  assert.deepEqual(Object.keys(responses).sort(), ["200", "400", "500"]);
});
