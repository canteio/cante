import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkQueueOpenApiSpec } from "./openapi";
import { STATES_LIST } from "./actions";

test("workqueue openapi spec declares GET and POST for /api/workqueue", () => {
  const spec = buildWorkQueueOpenApiSpec();
  const path = spec.paths["/api/workqueue"];
  assert.ok(path.get, "missing GET operation");
  assert.ok(path.post, "missing POST operation");
});

test("GET response summary schema requires every ActionState, zero-drift with STATES_LIST", () => {
  const spec = buildWorkQueueOpenApiSpec();
  const summarySchema = spec.paths["/api/workqueue"].get.responses["200"].content["application/json"].schema.properties.summary;
  assert.deepEqual(Object.keys(summarySchema.properties).sort(), [...STATES_LIST].sort());
  assert.deepEqual([...summarySchema.required].sort(), [...STATES_LIST].sort());
});

test("GET queue item schema documents finding, action, impact array, and all three drafts", () => {
  const spec = buildWorkQueueOpenApiSpec();
  const itemSchema = spec.paths["/api/workqueue"].get.responses["200"].content["application/json"].schema.properties.queue.items;
  assert.ok(itemSchema.properties.finding);
  assert.ok(itemSchema.properties.action);
  assert.equal(itemSchema.properties.impact.type, "array");
  const drafts = itemSchema.properties.drafts.properties;
  assert.deepEqual(Object.keys(drafts).sort(), ["brokerDraft", "internalOpsDraft", "supplierDraft"]);
});

test("includeResolved query param documents the exact 400-triggering contract", () => {
  const spec = buildWorkQueueOpenApiSpec();
  const param = spec.paths["/api/workqueue"].get.parameters.find((p) => p.name === "includeResolved");
  assert.ok(param, "includeResolved parameter missing from spec");
  assert.deepEqual(param!.schema.enum, ["true", "false"]);
});

test("POST request body documents both assess and transition shapes via oneOf", () => {
  const spec = buildWorkQueueOpenApiSpec();
  const bodySchema = spec.paths["/api/workqueue"].post.requestBody.content["application/json"].schema;
  assert.equal(bodySchema.oneOf.length, 2);
  const [assessShape, transitionShape] = bodySchema.oneOf;
  assert.deepEqual(assessShape.required, ["findingId", "action"]);
  assert.deepEqual(transitionShape.required, ["findingId", "state"]);
});

test("POST responses cover every status code the route handler actually returns", () => {
  const spec = buildWorkQueueOpenApiSpec();
  const responses = spec.paths["/api/workqueue"].post.responses;
  // route.ts: 200 (both modes), 400 (bad body/no customer/WorkflowError),
  // 403 + 404 (assess mode only), 500 (unexpected transition failure).
  assert.deepEqual(Object.keys(responses).sort(), ["200", "400", "403", "404", "500"]);
});
