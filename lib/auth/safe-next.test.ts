import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "./safe-next";

test("safeNext falls back to the US default chat route when next is missing", () => {
  assert.equal(safeNext(null), "/chat?country=United%20States");
});

test("safeNext falls back to the US default chat route when next is empty", () => {
  assert.equal(safeNext(""), "/chat?country=United%20States");
});

test("safeNext rejects protocol-relative open-redirect attempts", () => {
  assert.equal(safeNext("//evil.example.com/steal"), "/chat?country=United%20States");
});

test("safeNext rejects absolute URLs that don't start with a single /", () => {
  assert.equal(safeNext("https://evil.example.com"), "/chat?country=United%20States");
});

test("safeNext preserves a legitimate same-origin next path", () => {
  assert.equal(safeNext("/checklist?country=United%20States"), "/checklist?country=United%20States");
});
