import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../app/api/documents/route";

// Regression for the "Unknown action" agent-usability audit (continuing the
// workqueue/llm/workflow/suppliers/substances sweep, 2026-09-18): an
// unrecognized POST `action` used to say only that the value was wrong, not
// what to try instead. This asserts the fix actually lists the real options
// in the 400 body, mirroring lib/suppliers/suppliers-request.test.ts and
// lib/substances/substances-request.test.ts for the same route family so an
// agent client can self-correct from the response alone.
test("documents POST rejects an unknown action with the valid action list", async () => {
  const response = await POST(new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "not-a-real-action" }),
  }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const payload = await response.json();
  assert.match(payload.error, /Unknown action "not-a-real-action"/);
  assert.deepEqual(payload.validActions, ["ingest", "audit", "price", "promote"]);
});
