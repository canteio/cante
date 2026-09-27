import assert from "node:assert/strict";
import test from "node:test";
import { supplierEmptyState } from "./empty-state";

test("an empty supplier account prompts registration", () => {
  assert.deepEqual(supplierEmptyState(0, ""), {
    kind: "empty",
    message: "No suppliers registered yet. Add a vendor above or tell the AI Copilot in chat.",
  });
});

test("a filtered list names the unmatched query instead of suggesting another vendor", () => {
  assert.deepEqual(supplierEmptyState(3, "  steel  "), {
    kind: "no_match",
    message: 'No vendors match "steel".',
  });
});
