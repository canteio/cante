import assert from "node:assert/strict";
import test from "node:test";
import { chunkMessage, telegramConfig } from "./telegram";

/**
 * telegram.ts had zero test coverage despite being the ONLY delivery path
 * for compliance alerts (see the file's own header: "silence must never be
 * ambiguous"). These tests cover the two pure functions that are easy to
 * get subtly wrong and hard to notice broken in production:
 *
 * 1. telegramConfig() — the null-vs-configured decision that upstream code
 *    uses to distinguish "channel not set up" (skipped) from "channel set
 *    up but delivery failed" (a real incident). A blank-string env var
 *    (e.g. TELEGRAM_BOT_TOKEN="") must be treated as unconfigured, not as
 *    a truthy token that then fails Telegram's API with a cryptic 404.
 *
 * 2. chunkMessage() — the paragraph/line-boundary splitter that keeps a
 *    long alert from being silently truncated by Telegram's 4096-char
 *    limit. Off-by-one errors here either drop content or send
 *    empty/duplicate chunks.
 */

test("telegramConfig returns null when both env vars are missing", () => {
  assert.equal(telegramConfig({}), null);
});

test("telegramConfig returns null when a var is present but blank/whitespace", () => {
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_CHAT_ID: "123" }), null);
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: "abc", TELEGRAM_CHAT_ID: "" }), null);
});

test("telegramConfig trims and returns both values when set", () => {
  assert.deepEqual(
    telegramConfig({ TELEGRAM_BOT_TOKEN: " abc123 ", TELEGRAM_CHAT_ID: " -100987 " }),
    { botToken: "abc123", chatId: "-100987" },
  );
});

test("chunkMessage returns the whole text as one chunk when under the limit", () => {
  const text = "short alert";
  assert.deepEqual(chunkMessage(text), [text]);
});

test("chunkMessage splits on paragraph boundaries without cutting a line", () => {
  const para1 = "a".repeat(10);
  const para2 = "b".repeat(10);
  const chunks = chunkMessage(`${para1}\n${para2}`, 15);
  assert.deepEqual(chunks, [para1, para2]);
  // Rejoining recovers every character that was in the original text.
  assert.equal(chunks.join("\n"), `${para1}\n${para2}`);
});

test("chunkMessage hard-splits a single paragraph longer than the limit", () => {
  const longLine = "x".repeat(25);
  const chunks = chunkMessage(longLine, 10);
  assert.deepEqual(chunks, ["xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"]);
  assert.equal(chunks.join(""), longLine);
  for (const chunk of chunks) assert.ok(chunk.length <= 10);
});

test("chunkMessage never produces a chunk over the limit across mixed paragraphs", () => {
  const text = [
    "short",
    "y".repeat(30),
    "another short one",
    "z".repeat(5),
  ].join("\n");
  const chunks = chunkMessage(text, 12);
  for (const chunk of chunks) assert.ok(chunk.length <= 12, `chunk too long: ${chunk.length}`);
});
