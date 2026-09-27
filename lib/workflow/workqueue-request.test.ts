import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../../app/api/workqueue/route";

for (const value of ["", "TRUE", "False", "1", "0", "yes", "null", " true "]) {
  test(`workqueue rejects invalid includeResolved: ${JSON.stringify(value)}`, async () => {
    const response = await GET(new Request(
      `http://localhost/api/workqueue?customerId=&includeResolved=${encodeURIComponent(value)}`,
    ));
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), {
      error: "includeResolved must be 'true' or 'false'; omit it to hide resolved tasks.",
    });
  });
}

for (const query of ["", "&includeResolved=true", "&includeResolved=false"]) {
  test(`workqueue accepts the documented filter with no customer: ${query || "omitted"}`, async () => {
    // Demo mode plus an explicitly empty customer avoids accessing real tenant data.
    const previous = process.env.CANTE_AUTH_MODE;
    process.env.CANTE_AUTH_MODE = "demo";
    try {
      const response = await GET(new Request(`http://localhost/api/workqueue?customerId=${query}`));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { queue: [], summary: {} });
    } finally {
      if (previous === undefined) delete process.env.CANTE_AUTH_MODE;
      else process.env.CANTE_AUTH_MODE = previous;
    }
  });
}

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
