import { test } from "node:test";
import assert from "node:assert/strict";
import { clampLimit } from "./limit-clamp";

test("clampLimit passes through valid values in range", () => {
  assert.equal(clampLimit(1), 1);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(100), 100);
});

test("clampLimit floors fractional input", () => {
  assert.equal(clampLimit(12.9), 12);
});

test("clampLimit clamps above-range values down to the server's max of 100", () => {
  assert.equal(clampLimit(500), 100);
});

test("clampLimit falls back to default for an explicit 0, not the raw falsy value", () => {
  // Regression test for the 2026-09-16 bug: `Number(limit) || 50` treated 0
  // as falsy and fell back correctly here, but a naive `raw || fallback`
  // rewrite would not — 0 must hit the `< 1` branch explicitly, not rely on
  // JS falsy-coercion, so this stays correct if the implementation changes.
  assert.equal(clampLimit(0), 50);
});

test("clampLimit falls back to default for negative, NaN, or non-numeric input", () => {
  assert.equal(clampLimit(-5), 50);
  assert.equal(clampLimit(NaN), 50);
  assert.equal(clampLimit("not-a-number"), 50);
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(null), 50);
});

test("clampLimit honors a custom fallback", () => {
  assert.equal(clampLimit(0, 20), 20);
  assert.equal(clampLimit(undefined, 20), 20);
});
