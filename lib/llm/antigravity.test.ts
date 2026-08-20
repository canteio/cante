import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderChoice, PROVIDER_OPTIONS } from "@/lib/llm/provider-choice";
import { getProvider } from "@/lib/llm";
import { AntigravityCliProvider } from "@/lib/llm/antigravity-cli";

test("normalizeProviderChoice maps Antigravity and Gemini aliases accurately", () => {
  assert.equal(normalizeProviderChoice("antigravity"), "antigravity");
  assert.equal(normalizeProviderChoice("agy"), "antigravity");
  assert.equal(normalizeProviderChoice("gemini"), "antigravity");
  assert.equal(normalizeProviderChoice("google"), "antigravity");
});

test("PROVIDER_OPTIONS contains Claude, Codex, Antigravity and API", () => {
  const ids = PROVIDER_OPTIONS.map((o) => o.id);
  assert.ok(ids.includes("claude-code"));
  assert.ok(ids.includes("codex-cli"));
  assert.ok(ids.includes("antigravity"));
  assert.ok(ids.includes("api"));
});

test("getProvider initializes AntigravityCliProvider when selected", () => {
  const provider = getProvider("antigravity");
  assert.equal(provider.name, "antigravity");
  assert.ok(provider instanceof AntigravityCliProvider);
});

test("AntigravityCliProvider reports status with binary name", async () => {
  const provider = new AntigravityCliProvider("agy-test-binary");
  const health = await provider.available();
  assert.equal(health.ok, false);
  assert.ok(health.detail.includes("agy-test-binary"));
});
