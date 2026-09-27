import assert from "node:assert/strict";
import test from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";

// Regression for the "Unknown action" agent-usability audit. The route first
// resolves a tenant, so this test creates its own isolated fictional customer
// instead of depending on whatever happens to exist in the developer's real
// cante.db. Import the route only after operatingDb sets CANTE_DB_PATH because
// lib/db/client.ts binds that path at module initialization.
test("documents POST rejects an unknown action with the valid action list", async () => {
  const { customerId } = await operatingDb();
  const { POST } = await import("../../app/api/documents/route");
  const response = await POST(new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId, action: "not-a-real-action" }),
  }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const payload = await response.json();
  assert.match(payload.error, /Unknown action "not-a-real-action"/);
  assert.deepEqual(payload.validActions, ["ingest", "audit", "price", "promote"]);
});
