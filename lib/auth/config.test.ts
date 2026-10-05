import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  emailIsAllowed,
  getAuthMode,
  hasSupabaseEnv,
} from "./config";

// lib/auth/config.ts had zero test coverage despite gating both auth mode
// and the email allowlist used for Supabase login. These tests lock in the
// documented env-var contract and the emailIsAllowed() whitespace-trim fix
// (a copy-pasted email with stray spaces used to be rejected even when it
// was on the allowlist).
//
// getDataBackend()/CANTE_DATA_BACKEND were removed when this app's data
// layer became Supabase-only (SQLite fully retired) — there is only one
// backend now, so there is nothing left to test there.

const ENV_KEYS = [
  "CANTE_AUTH_MODE",
  "CANTE_ALLOWED_EMAILS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

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

test("getAuthMode defaults to demo and only switches on exact 'supabase'", () => {
  assert.equal(getAuthMode(), "demo");
  process.env.CANTE_AUTH_MODE = "Supabase";
  assert.equal(getAuthMode(), "demo");
  process.env.CANTE_AUTH_MODE = "supabase";
  assert.equal(getAuthMode(), "supabase");
});

test("hasSupabaseEnv requires both url and publishable key", () => {
  assert.equal(hasSupabaseEnv(), false);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  assert.equal(hasSupabaseEnv(), false);
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "pk_test";
  assert.equal(hasSupabaseEnv(), true);
});

test("emailIsAllowed returns false when allowlist is unset or empty", () => {
  assert.equal(emailIsAllowed("j@cante.com"), false);
  process.env.CANTE_ALLOWED_EMAILS = "  , ,";
  assert.equal(emailIsAllowed("j@cante.com"), false);
});

test("emailIsAllowed matches case-insensitively and trims list entries", () => {
  process.env.CANTE_ALLOWED_EMAILS = " J@Cante.com , ops@cante.com";
  assert.equal(emailIsAllowed("j@cante.com"), true);
  assert.equal(emailIsAllowed("OPS@CANTE.COM"), true);
  assert.equal(emailIsAllowed("nobody@cante.com"), false);
});

test("emailIsAllowed trims stray whitespace on the input email", () => {
  process.env.CANTE_ALLOWED_EMAILS = "j@cante.com";
  assert.equal(emailIsAllowed("  j@cante.com  "), true);
});

test("emailIsAllowed handles null/undefined input", () => {
  process.env.CANTE_ALLOWED_EMAILS = "j@cante.com";
  assert.equal(emailIsAllowed(null), false);
  assert.equal(emailIsAllowed(undefined), false);
});
