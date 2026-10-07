import assert from "node:assert/strict";
import test from "node:test";
import {
  lookupSection338,
  isSection338ImportBanDateAmbiguous,
  SECTION_338_EFFECTIVE_DATE,
  SECTION_338_IMPORT_BAN_DATE,
} from "@/lib/tariff/section338";

test("a verified Canada-origin whisky code (2208.30) matches the alcohol basket at 50%", () => {
  const match = lookupSection338("2208.30.60.85", "CA", "2026-09-01");
  assert.ok(match);
  assert.equal(match?.basket, "alcohol");
  assert.equal(match?.ratePercent, 0.5);
  assert.equal(match?.chapter99Code, "9903.03.13");
  assert.match(match!.federalRegisterCitations.join(" "), /2026-14991/);
  assert.equal(match?.banDateAmbiguous, false);
  assert.equal(match?.banCitation, null);
});

test("a verified Canada-origin dairy code (0402.10) matches the dairy basket at 50%", () => {
  const match = lookupSection338("0402.10.05.00", "CA", "2026-09-01");
  assert.ok(match);
  assert.equal(match?.basket, "dairy");
  assert.equal(match?.ratePercent, 0.5);
});

test("a verified Canada-origin motor-vehicle-basket consumer good (lamps, 9405.29) matches", () => {
  const match = lookupSection338("9405.29.80.00", "CA", "2026-09-01");
  assert.ok(match);
  assert.equal(match?.basket, "motor_vehicle_basket");
  assert.equal(match?.chapter99Code, "9903.03.14");
});

test("the same HTS codes do NOT match for a non-Canada origin", () => {
  assert.equal(lookupSection338("2208.30.60.85", "FR", "2026-09-01"), null);
  assert.equal(lookupSection338("0402.10.05.00", "US", "2026-09-01"), null);
});

test("an HTS code outside the small verified table returns null, never a guess", () => {
  assert.equal(lookupSection338("8471.30.01.00", "CA", "2026-09-01"), null);
});

test("an empty or garbage HTS code returns null rather than throwing", () => {
  assert.equal(lookupSection338("", "CA", "2026-09-01"), null);
  assert.equal(lookupSection338("not-a-code", "CA", "2026-09-01"), null);
});

test("the module's verified effective date is 2026-08-22, the actual first-collection date", () => {
  assert.equal(SECTION_338_EFFECTIVE_DATE, "2026-08-22");
});

test("the module's import-ban conversion date is 2026-09-29", () => {
  assert.equal(SECTION_338_IMPORT_BAN_DATE, "2026-09-29");
});

test("the note on a matched measure names the basket, rate, and exclusions", () => {
  const match = lookupSection338("2208.30.60.85", "CA", "2026-09-01");
  assert.ok(match);
  assert.match(match!.note, /50%/);
  assert.match(match!.note, /Section 232/);
});

test("isSection338ImportBanDateAmbiguous is false strictly before Sept 29, 2026", () => {
  assert.equal(isSection338ImportBanDateAmbiguous("2026-09-28"), false);
});

test("isSection338ImportBanDateAmbiguous is true on and after Sept 29, 2026", () => {
  assert.equal(isSection338ImportBanDateAmbiguous("2026-09-29"), true);
  assert.equal(isSection338ImportBanDateAmbiguous("2026-10-15"), true);
});

test("a matched line on/after the ban date reports banDateAmbiguous with the right basket's proclamation cited, not a confident 50%", () => {
  const match = lookupSection338("2208.30.60.85", "CA", "2026-09-29");
  assert.ok(match);
  assert.equal(match?.banDateAmbiguous, true);
  assert.match(match!.banCitation ?? "", /11061/);
  assert.match(match!.banCitation ?? "", /2026-18835/);
  assert.match(match!.note, /import ban/);
  // The rate figure the measure object carries is still 0.5 (the module's
  // single verified duty rate), but callers (stack.ts) must treat it as
  // unresolved once banDateAmbiguous is true — this is enforced at the
  // stack.ts integration level, not inside this lookup.
  assert.equal(match?.ratePercent, 0.5);
});

test("a matched dairy line on/after the ban date cites the dairy ban proclamation (11062), not the alcohol one", () => {
  const match = lookupSection338("0402.10.05.00", "CA", "2026-09-29");
  assert.ok(match);
  assert.match(match!.banCitation ?? "", /11062/);
  assert.match(match!.banCitation ?? "", /2026-18836/);
});

test("a matched motor-vehicle-basket line on/after the ban date cites proclamation 11063", () => {
  const match = lookupSection338("9405.29.80.00", "CA", "2026-09-29");
  assert.ok(match);
  assert.match(match!.banCitation ?? "", /11063/);
  assert.match(match!.banCitation ?? "", /2026-18837/);
});

test("omitting importDate (null) falls back to today's US/Eastern date for the ban check", () => {
  // Today in this sandbox's test run is after Sept 29, 2026 per repo
  // commit history dated Oct 2026 — the default-arg path must still
  // return a result (not throw) and, since the module's ban date is a
  // fixed point already in the past relative to "today", must flag
  // banDateAmbiguous true rather than silently assuming the pre-ban rate.
  const match = lookupSection338("2208.30.60.85", "CA");
  assert.ok(match);
  assert.equal(match?.banDateAmbiguous, true);
});
