import assert from "node:assert/strict";
import test from "node:test";
import { easternIsoDate, isStrictIsoDate } from "@/lib/tariff/date";

test("uses the U.S. Eastern calendar date across UTC midnight", () => {
  assert.equal(easternIsoDate(new Date("2026-10-07T03:54:00Z")), "2026-10-06");
  assert.equal(easternIsoDate(new Date("2026-10-07T04:01:00Z")), "2026-10-07");
  assert.equal(easternIsoDate(new Date("2026-01-07T04:54:00Z")), "2026-01-06");
  assert.equal(easternIsoDate(new Date("2026-01-07T05:01:00Z")), "2026-01-07");
});

test("accepts real calendar dates in exact YYYY-MM-DD form", () => {
  assert.equal(isStrictIsoDate("2024-02-29"), true);
  assert.equal(isStrictIsoDate("2025-06-23"), true);
  assert.equal(isStrictIsoDate("0001-01-01"), true);
});

test("rejects impossible calendar dates", () => {
  for (const value of ["2025-02-29", "2025-04-31", "2025-13-01", "2025-00-10", "2025-01-00"]) {
    assert.equal(isStrictIsoDate(value), false, value);
  }
});

test("rejects non-canonical date strings that Date.parse may accept", () => {
  for (const value of ["2025-6-23", "2025-06-23T00:00:00Z", "06/23/2025", "0000-01-01", "not-a-date"]) {
    assert.equal(isStrictIsoDate(value), false, value);
  }
});
