import assert from "node:assert/strict";
import test from "node:test";
import { section232TargetDate } from "./section232-live";

test("Section 232 defaults to the U.S. Eastern legal day around UTC midnight", () => {
  assert.equal(section232TargetDate(undefined, new Date("2026-10-07T03:59:59Z")), "2026-10-06");
  assert.equal(section232TargetDate(undefined, new Date("2026-10-07T04:00:00Z")), "2026-10-07");
});

test("Section 232 preserves an explicitly supplied effective date", () => {
  assert.equal(section232TargetDate("2026-04-06", new Date("2026-10-07T03:59:59Z")), "2026-04-06");
});
