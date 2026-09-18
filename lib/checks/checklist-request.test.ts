import assert from "node:assert/strict";
import { after, before, test } from "node:test";

// Use the real route and SQLite writes without touching any customer's ledger.
process.env.CANTE_DB_PATH = ":memory:";
process.env.CANTE_DATA_BACKEND = "sqlite";
let route: typeof import("../../app/api/checklist/route");
let database: typeof import("../db/client");
let statuses: typeof import("./checklist-status");
before(async () => {
  route = await import("../../app/api/checklist/route");
  database = await import("../db/client");
  statuses = await import("./checklist-status");
  database.db.$client.exec(`
    CREATE TABLE checklist_items (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT);
    INSERT INTO checklist_items VALUES ('test-item', 'required', 'initial');
  `);
});
after(() => database.db.$client.close());

function patch(body: string) {
  return route.PATCH(new Request("http://localhost/api/checklist", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  }));
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
    const before = database.db.$client.prepare("SELECT * FROM checklist_items").all();
    const response = await patch(body);
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const payload = await response.json();
    assert.match(payload.error, /non-empty string `id`/);
    assert.deepEqual(payload.shape.status.enum, statuses.checklistStatusSchema.options);
    assert.ok(payload.issues.length > 0);
    assert.deepEqual(database.db.$client.prepare("SELECT * FROM checklist_items").all(), before);
  });
}

test("checklist PATCH persists every documented status, including all UI actions", async () => {
  for (const status of statuses.checklistStatusSchema.options) {
    const response = await patch(JSON.stringify({ id: "test-item", status }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(database.db.$client.prepare("SELECT status FROM checklist_items WHERE id = ?").get("test-item"), { status });
  }
});
