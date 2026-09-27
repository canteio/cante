import assert from "node:assert/strict";
import test from "node:test";
import { operatingDb } from "@/lib/test-support/operating-db";
import { POST } from "../../app/api/suppliers/route";

// Regression for the "Unknown action" agent-usability audit (continuing the
// workqueue/llm/workflow sweep, 2026-09-17): an unrecognized POST `action`
// used to say only that the value was wrong, not what to try instead. This
// asserts the fix actually lists the real options in the 400 body, mirroring
// lib/workflow/workqueue-request.test.ts's structure for the same route
// family so an agent client can self-correct from the response alone.
test("suppliers POST rejects an unknown action with the valid action list", async () => {
  const { customerId } = await operatingDb();
  const response = await POST(new Request("http://localhost/api/suppliers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId, action: "not-a-real-action" }),
  }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const payload = await response.json();
  assert.match(payload.error, /Unknown action "not-a-real-action"/);
  assert.deepEqual(payload.validActions, ["upsert", "evidence", "request", "screen"]);
});
