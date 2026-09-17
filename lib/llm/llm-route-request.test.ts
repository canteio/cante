import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../app/api/llm/route";

// Regression coverage for the null-body crash noted in the prior run's UI/UX
// audit: POST /api/llm previously dereferenced `body.provider` on any
// non-object JSON payload, throwing a TypeError that the outer try/catch
// turned into an undifferentiated 500 — the same failure mode already fixed
// on POST /api/workqueue. An AI agent probing this endpoint cold with a bad
// payload should get an actionable 400, not an opaque server error. Lives
// under lib/ (not app/) because the project's test glob only covers
// lib/**/*.test.ts and pipelines/import-manifest/**/*.test.ts — the sibling
// workqueue-request.test.ts uses the same cross-directory import pattern.
for (const body of ["null", "[]", '["claude-code"]', '"claude-code"', "42", "true"]) {
  test(`POST /api/llm rejects non-object JSON body: ${body}`, async () => {
    const response = await POST(
      new Request("http://localhost/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const payload = await response.json();
    assert.match(payload.error, /JSON object/);
    assert.match(payload.error, /provider/);
  });
}

test("POST /api/llm still explains malformed (unparseable) JSON separately", async () => {
  const response = await POST(
    new Request("http://localhost/api/llm", {
      method: "POST",
      body: "{",
    }),
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /JSON object/);
});
