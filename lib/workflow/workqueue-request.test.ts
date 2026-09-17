import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../app/api/workqueue/route";

for (const body of ["null", "[]", '["finding"]', '"finding"', "42", "true", "false"]) {
  test(`workqueue rejects non-object JSON: ${body}`, async () => {
    const response = await POST(new Request("http://localhost/api/workqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }));
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const payload = await response.json();
    assert.match(payload.error, /JSON object/);
    assert.match(payload.error, /findingId/);
  });
}

test("workqueue explains malformed JSON separately", async () => {
  const response = await POST(new Request("http://localhost/api/workqueue", {
    method: "POST",
    body: "{",
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Request body must be valid JSON." });
});
