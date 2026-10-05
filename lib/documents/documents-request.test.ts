import assert from "node:assert/strict";
import test from "node:test";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

// Regression for the "Unknown action" agent-usability audit. The route first
// resolves a tenant, so this test creates its own isolated fictional customer
// instead of depending on whatever happens to exist in a real database.
//
// Current route behavior: only "ingest" runs synchronously in this handler;
// any other action ("audit", "price", "promote", or an unrecognized one)
// returns 409 "runs on the trusted worker" rather than a distinct "Unknown
// action" 400 — the route does not attempt to validate the action name
// against DOCUMENTS_ACTIONS before routing it to that 409, since everything
// non-"ingest" is uniformly deferred to the worker regardless of whether the
// name is even a real action.
test("documents POST defers any non-ingest action to the trusted worker", async () => {
  const { customerId } = await operatingDb();
  const { POST } = await import("../../app/api/documents/route");
  const response = await POST(new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId, action: "not-a-real-action" }),
  }));
  assert.equal(response.status, 409);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const payload = await response.json();
  assert.match(payload.error, /trusted worker/);
});
