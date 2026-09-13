import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProviderChoice, PROVIDER_OPTIONS, PROVIDER_COOKIE } from "@/lib/llm/provider-choice";

test("canonical ids normalize to themselves", () => {
  assert.equal(normalizeProviderChoice("claude-code"), "claude-code");
  assert.equal(normalizeProviderChoice("codex-cli"), "codex-cli");
  assert.equal(normalizeProviderChoice("antigravity"), "antigravity");
  assert.equal(normalizeProviderChoice("api"), "api");
});

test("known aliases map to their canonical provider", () => {
  assert.equal(normalizeProviderChoice("codex"), "codex-cli");
  assert.equal(normalizeProviderChoice("openai"), "codex-cli");
  assert.equal(normalizeProviderChoice("chatgpt"), "codex-cli");
  assert.equal(normalizeProviderChoice("agy"), "antigravity");
  assert.equal(normalizeProviderChoice("gemini"), "antigravity");
  assert.equal(normalizeProviderChoice("google"), "antigravity");
});

test("aliases are matched case-insensitively", () => {
  assert.equal(normalizeProviderChoice("CODEX"), "codex-cli");
  assert.equal(normalizeProviderChoice("Gemini"), "antigravity");
  assert.equal(normalizeProviderChoice("API"), "api");
});

test("unrecognised, empty, or non-string input falls back to claude-code", () => {
  assert.equal(normalizeProviderChoice("something-unknown"), "claude-code");
  assert.equal(normalizeProviderChoice(""), "claude-code");
  assert.equal(normalizeProviderChoice(undefined), "claude-code");
  assert.equal(normalizeProviderChoice(null), "claude-code");
  assert.equal(normalizeProviderChoice(42), "claude-code");
});

test("every provider option has a stable id, label, and description", () => {
  const ids = PROVIDER_OPTIONS.map((option) => option.id);
  assert.deepEqual(ids, ["claude-code", "codex-cli", "antigravity", "api"]);
  for (const option of PROVIDER_OPTIONS) {
    assert.ok(option.label.length > 0);
    assert.ok(option.shortLabel.length > 0);
    assert.ok(option.description.length > 0);
    // normalizeProviderChoice must accept every canonical id it advertises.
    assert.equal(normalizeProviderChoice(option.id), option.id);
  }
});

test("the cookie name is stable", () => {
  assert.equal(PROVIDER_COOKIE, "cante_llm");
});
