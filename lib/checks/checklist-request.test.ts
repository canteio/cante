import assert from "node:assert/strict";
import { test } from "node:test";
import { createServiceClient } from "@/lib/supabase/service";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import * as route from "../../app/api/checklist/route";
import * as statuses from "./checklist-status";

function patch(body: string) {
  return route.PATCH(new Request("http://localhost/api/checklist", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  }));
}

async function seedItem(customerId: string) {
  const client = createServiceClient();
  const id = "test-item";
  const { error } = await client.from("checklist_items").insert({
    id, customer_id: customerId, title: "Test checklist item", status: "required",
  });
  if (error) throw new Error(error.message);
  return id;
}

async function readItem(id: string) {
  const client = createServiceClient();
  const { data, error } = await client.from("checklist_items").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const invalidBodies: [string, string][] = [
  ["malformed JSON", "{"],
  ["null", "null"],
  ["array", "[]"],
  ["scalar", "42"],
  ["missing fields", "{}"],
  ["numeric id", JSON.stringify({ id: 12, status: "completed" })],
  ["blank id", JSON.stringify({ id: "  ", status: "completed" })],
  ["object status", JSON.stringify({ id: "test-item", status: {} })],
  ["numeric status", JSON.stringify({ id: "test-item", status: 12 })],
  ...["done", "pending", "skipped", "typo"].map((status): [string, string] => [
    `unsupported status ${status}`, JSON.stringify({ id: "test-item", status }),
  ]),
];

for (const [label, body] of invalidBodies) {
  test(`checklist PATCH rejects ${label} with usable guidance and no write`, async () => {
    const { customerId } = await operatingDb();
    const id = await seedItem(customerId);
    const before = await readItem(id);
    const response = await patch(body);
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const payload = await response.json();
    assert.match(payload.error, /non-empty string `id`/);
    assert.deepEqual(payload.shape.status.enum, statuses.checklistStatusSchema.options);
    assert.ok(payload.issues.length > 0);
    assert.deepEqual(await readItem(id), before);
  });
}

test("checklist PATCH persists every documented status, including all UI actions", async () => {
  const { customerId } = await operatingDb();
  const id = await seedItem(customerId);
  for (const status of statuses.checklistStatusSchema.options) {
    const response = await patch(JSON.stringify({ id, status }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const row = await readItem(id);
    assert.equal(row?.status, status);
  }
});
