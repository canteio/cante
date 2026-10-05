import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildProductsOpenApiSpec } from "./openapi";
import { GET as discover } from "../../app/api/products/openapi/route";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/products/route");
let customerId: string;

beforeEach(async () => {
  // Bind the real route to throwaway storage before db/client's one-time import,
  // so contract tests can exercise persistence without touching the user ledger.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/products/route");
});

const contract = buildProductsOpenApiSpec().paths["/api/products"];
function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

test("products discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildProductsOpenApiSpec());
});

test("single-product contract matches a real POST write and GET read", async () => {
  const create = await route.POST(jsonRequest({
    customerId,
    sku: "VALVE-001",
    name: "Brass valve",
    materials: ["brass", "rubber"],
    originCountry: "Mexico",
    currency: "usd",
    productClass: "component",
  }));
  assert.equal(create.status, 200);
  const created = await create.json();
  assert.equal(created.outcome, "created");
  assert.equal(created.product.currency, "USD");
  assert.equal(created.product.productClass, "component");

  const get = await route.GET(new Request(`http://localhost/api/products?customerId=${customerId}`));
  assert.equal(get.status, 200);
  const payload = await get.json();
  assert.equal(payload.products.length, 1);
  assert.equal(payload.products[0].id, created.product.id);
  assert.deepEqual(payload.products[0].materials, ["brass", "rubber"]);
  assert.deepEqual(payload.products[0].classifications, []);
  assert.deepEqual(contract.get.responses["200"].content["application/json"].schema.required, ["products"]);
});

test("CSV response contract matches real created and rejected row outcomes", async () => {
  const csv = [
    "sku,name,hs_code,unused_column",
    "PUMP-001,Water pump,8413.70,ignored",
    ",Missing SKU,8413.70,ignored",
  ].join("\n");
  const response = await route.POST(jsonRequest({ customerId, csv }));
  assert.equal(response.status, 200);
  const { summary } = await response.json();
  assert.equal(summary.created, 1);
  assert.equal(summary.rejected, 1);
  assert.deepEqual(summary.rows.map((row: { outcome: string }) => row.outcome), ["created", "rejected"]);
  assert.deepEqual(summary.rows[0].codesRecorded, ["hs:8413.70"]);
  assert.deepEqual(summary.ignoredColumns, ["unused_column"]);

  const summarySchema = contract.post.responses["200"].content["application/json"].schema.properties.summary;
  assert.deepEqual(summarySchema.required, [
    "created", "updated", "unchanged", "rejected", "rows", "recognisedColumns", "ignoredColumns", "caveats",
  ]);
  assert.deepEqual(summarySchema.properties.rows.items.properties.outcome.enum, ["created", "updated", "unchanged", "rejected"]);
});

test("documented POST errors match real malformed and incomplete requests", async () => {
  const malformed = await route.POST(new Request("http://localhost/api/products", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, "string");

  const incomplete = await route.POST(jsonRequest({ customerId, sku: "NO-NAME" }));
  assert.equal(incomplete.status, 400);
  assert.equal(typeof (await incomplete.json()).error, "string");
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400"]);
});

test("DELETE contract matches real deletion and unknown-id false behavior", async () => {
  const create = await route.POST(jsonRequest({ customerId, sku: "DELETE-001", name: "Delete me" }));
  const productId = (await create.json()).product.id;
  const first = await route.DELETE(new Request(
    `http://localhost/api/products?customerId=${customerId}&productId=${productId}`,
    { method: "DELETE" },
  ));
  assert.deepEqual(await first.json(), { deleted: true });
  const second = await route.DELETE(new Request(
    `http://localhost/api/products?customerId=${customerId}&productId=${productId}`,
    { method: "DELETE" },
  ));
  assert.deepEqual(await second.json(), { deleted: false });
});
