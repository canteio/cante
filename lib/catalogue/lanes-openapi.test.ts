import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { buildLanesOpenApiSpec } from "./lanes-openapi";
import { GET as discover } from "../../app/api/lanes/openapi/route";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/lanes/route");
let customerId: string;

beforeEach(async () => {
  // Create the real throwaway Supabase customer before importing the route.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/lanes/route");
});

const contract = buildLanesOpenApiSpec().paths["/api/lanes"];
function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/lanes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("lanes discovery serves GET, POST and DELETE as cacheable OpenAPI 3.1 JSON", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildLanesOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post", "delete"]);
});

test("single-lane contract matches a real POST write and GET read", async () => {
  const create = await route.POST(jsonRequest({
    customerId,
    direction: "import",
    originCountry: "Vietnam",
    destinationCountry: "United States",
    transitCountries: ["Singapore"],
    annualShipments: 12,
    currency: "usd",
  }));
  assert.equal(create.status, 200);
  const created = (await create.json()).lane;
  assert.equal(created.direction, "import");
  assert.equal(created.currency, "USD");

  const get = await route.GET(new Request(`http://localhost/api/lanes?customerId=${customerId}`));
  assert.equal(get.status, 200);
  const payload = await get.json();
  assert.equal(payload.lanes.length, 1);
  assert.equal(payload.lanes[0].id, created.id);
  assert.deepEqual(contract.get.responses["200"].content["application/json"].schema.required, ["lanes"]);
});

test("CSV contract matches real per-row created and rejected outcomes", async () => {
  const csv = [
    "origin,destination,direction,annual_shipments",
    "Mexico,United States,import,8",
    "Canada,,,4",
  ].join("\n");
  const response = await route.POST(jsonRequest({ customerId, csv }));
  assert.equal(response.status, 200);
  const { summary } = await response.json();
  assert.equal(summary.created, 1);
  assert.equal(summary.rejected, 1);
  assert.deepEqual(summary.rows.map((row: { outcome: string }) => row.outcome), ["created", "rejected"]);

  const summarySchema = contract.post.responses["200"].content["application/json"].schema.properties.summary;
  assert.deepEqual(summarySchema.required, ["created", "rejected", "rows", "caveats"]);
  assert.deepEqual(summarySchema.properties.rows.items.properties.outcome.enum, ["created", "rejected"]);
});

test("documented 400 errors match the real malformed and incomplete POST responses", async () => {
  const malformed = await route.POST(new Request("http://localhost/api/lanes", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).error, "string");

  const incomplete = await route.POST(jsonRequest({ customerId, originCountry: "Mexico" }));
  assert.equal(incomplete.status, 400);
  assert.equal(typeof (await incomplete.json()).error, "string");
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400"]);
});

test("DELETE contract matches real deletion and unknown-id false behavior", async () => {
  const create = await route.POST(jsonRequest({ customerId, originCountry: "Japan", destinationCountry: "United States" }));
  const laneId = (await create.json()).lane.id;
  const first = await route.DELETE(new Request(`http://localhost/api/lanes?customerId=${customerId}&laneId=${laneId}`, { method: "DELETE" }));
  assert.deepEqual(await first.json(), { deleted: true });
  const second = await route.DELETE(new Request(`http://localhost/api/lanes?customerId=${customerId}&laneId=${laneId}`, { method: "DELETE" }));
  assert.deepEqual(await second.json(), { deleted: false });
  assert.deepEqual(Object.keys(contract.delete.responses).sort(), ["200", "400", "500"]);
});
