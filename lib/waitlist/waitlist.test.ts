import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { hashWaitlistIp, joinWaitlist, parseWaitlistRequest } from "./index";

const keys = ["NEXT_PUBLIC_SUPABASE_URL", "WAITLIST_WRITE_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.WAITLIST_WRITE_KEY = "server-write-key";
});

afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("waitlist input trims and normalizes a valid email", () => {
  assert.deepEqual(parseWaitlistRequest({ email: "  Person@Example.COM  ", website: "" }), {
    email: "person@example.com",
  });
});

test("waitlist input rejects invalid emails and the bot honeypot", () => {
  assert.equal(parseWaitlistRequest({ email: "not-an-email", website: "" }), null);
  assert.equal(parseWaitlistRequest({ email: "person@example.com", website: "https://bot.test" }), null);
});

test("IP hashing is stable per salt and does not reveal the address", () => {
  const first = hashWaitlistIp("203.0.113.8", "salt-one");
  assert.equal(first, hashWaitlistIp("203.0.113.8", "salt-one"));
  assert.notEqual(first, hashWaitlistIp("203.0.113.8", "salt-two"));
  assert.equal(first.includes("203.0.113.8"), false);
});

test("joinWaitlist uses the server-only write key and accepts only the success contract", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({ accepted: true, rate_limited: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await joinWaitlist("person@example.com", "hashed-ip", "browser", fetcher);
  const headers = new Headers(requestInit?.headers);
  assert.deepEqual(result, { ok: true });
  assert.equal(requestUrl, "https://example.supabase.co/rest/v1/rpc/join_waitlist");
  assert.equal(headers.get("apikey"), "server-write-key");
  assert.equal(headers.get("authorization"), null);
  assert.ok(requestInit?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    requested_email: "person@example.com",
    requested_ip_hash: "hashed-ip",
    requested_user_agent: "browser",
  });
});

test("joinWaitlist translates the exact database rate-limit response", async () => {
  const fetcher = (async () =>
    new Response(JSON.stringify({ accepted: false, rate_limited: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  assert.deepEqual(await joinWaitlist("person@example.com", "hashed-ip", "browser", fetcher), {
    ok: false,
    status: 429,
    message: "Too many attempts. Try again in a few minutes.",
  });
});

test("joinWaitlist fails closed on malformed successful RPC responses", async () => {
  const malformedPayloads: unknown[] = [
    null,
    {},
    [],
    [{ accepted: true, rate_limited: false }],
    { accepted: true },
    { accepted: true, rate_limited: false, already_joined: true },
    { already_joined: false, rate_limited: false },
  ];

  for (const payload of malformedPayloads) {
    const fetcher = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    assert.deepEqual(await joinWaitlist("person@example.com", "hashed-ip", "browser", fetcher), {
      ok: false,
      status: 500,
      message: "We couldn't save your email. Please try again.",
    });
  }
});

test("the waitlist RPC is server-only, hardened, and serializes each IP rate limit", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/202609210001_public_waitlist.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /from public\.waitlist_attempts/);
  assert.match(migration, /insert into public\.waitlist_attempts/);
  assert.doesNotMatch(migration, /from public\.waitlist_entries[\s\S]{0,180}>= 5/);
  assert.match(migration, /grant execute on function public\.join_waitlist\(text, text, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|authenticated)/);
});
