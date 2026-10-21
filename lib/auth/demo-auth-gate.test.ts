import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE } from "./config";

// Oct 20 security review, finding: demo mode was getAuthMode()'s silent
// default and middleware accepted the constant `cante_demo_session=demo`
// cookie on any protected route whenever CANTE_AUTH_MODE wasn't exactly
// "supabase" -- including a production deploy that forgot to set
// CANTE_AUTH_MODE. These tests exercise the real middleware function end to
// end (not just the config helper) to prove the fix actually closes the gap:
// the demo cookie must be rejected unless ENABLE_DEMO_AUTH=true is set, and
// must keep working for local dev when it is set.

const ENV_KEYS = ["CANTE_AUTH_MODE", "ENABLE_DEMO_AUTH"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function demoRequest() {
  const request = new NextRequest("https://cante.test/tariff");
  request.cookies.set(DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE);
  return request;
}

test("(a) with ENABLE_DEMO_AUTH unset, a prod-like config rejects the demo cookie", async () => {
  // CANTE_AUTH_MODE unset too: this is exactly the misconfigured-production
  // shape the review flagged -- no explicit auth mode, no demo opt-in.
  const response = await middleware(demoRequest());
  assert.equal(response.status, 307); // redirect to /login, not NextResponse.next()
  assert.equal(response.headers.get("location")?.includes("/login"), true);
});

test("(a) with ENABLE_DEMO_AUTH explicitly 'false', the demo cookie is still rejected", async () => {
  process.env.ENABLE_DEMO_AUTH = "false";
  const response = await middleware(demoRequest());
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location")?.includes("/login"), true);
});

test("(a) a protected API route returns 401 JSON, not a redirect, when the flag is unset", async () => {
  const request = new NextRequest("https://cante.test/api/tariff/anything");
  request.cookies.set(DEMO_SESSION_COOKIE, DEMO_SESSION_VALUE);
  const response = await middleware(request);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

test("(b) with ENABLE_DEMO_AUTH=true, demo mode still works for local dev", async () => {
  process.env.ENABLE_DEMO_AUTH = "true";
  const response = await middleware(demoRequest());
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("(b) with the flag set, a request without the cookie is still sent to /login", async () => {
  process.env.ENABLE_DEMO_AUTH = "true";
  const request = new NextRequest("https://cante.test/tariff");
  const response = await middleware(request);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location")?.includes("/login"), true);
});
