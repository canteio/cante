import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "./safe-next";

test("safeNext falls back to the import review route when next is missing", () => {
  assert.equal(safeNext(null), "/tariff");
});

test("safeNext falls back to the import review route when next is empty", () => {
  assert.equal(safeNext(""), "/tariff");
});

test("safeNext rejects protocol-relative open-redirect attempts", () => {
  assert.equal(safeNext("//evil.example.com/steal"), "/tariff");
});

test("safeNext rejects absolute URLs that don't start with a single /", () => {
  assert.equal(safeNext("https://evil.example.com"), "/tariff");
});

test("safeNext preserves a legitimate same-origin next path", () => {
  assert.equal(safeNext("/checklist?country=United%20States"), "/checklist?country=United%20States");
});
