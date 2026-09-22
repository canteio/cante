import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/waitlist/route";
import { middleware } from "../../middleware";

function waitlistRequest(body: unknown) {
  return new NextRequest("https://cante.test/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the public waitlist route rejects a malformed email", async () => {
  const response = await POST(waitlistRequest({ email: "bad", website: "" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Enter a valid email address." });
});

test("the public waitlist route rejects oversized request bodies", async () => {
  const response = await POST(waitlistRequest({ email: `${"a".repeat(2_000)}@example.com`, website: "" }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { message: "Request body is too large." });
});

test("the honeypot quietly accepts bots without touching storage", async () => {
  const response = await POST(waitlistRequest({ email: "bot@example.com", website: "spam" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "You're on the list. We'll be in touch." });
});

test("middleware leaves the waitlist API public", async () => {
  const response = await middleware(waitlistRequest({ email: "person@example.com", website: "" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});
