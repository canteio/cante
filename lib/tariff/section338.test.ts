import assert from "node:assert/strict";
import test from "node:test";
import { lookupSection338, SECTION_338_EFFECTIVE_DATE } from "@/lib/tariff/section338";

test("a verified Canada-origin whisky code (2208.30) matches the alcohol basket at 50%", () => {
  const match = lookupSection338("2208.30.60.85", "CA");
  assert.ok(match);
  assert.equal(match?.basket, "alcohol");
  assert.equal(match?.ratePercent, 0.5);
  assert.equal(match?.chapter99Code, "9903.03.13");
  assert.match(match!.federalRegisterCitations.join(" "), /2026-14991/);
});

test("a verified Canada-origin dairy code (0402.10) matches the dairy basket at 50%", () => {
  const match = lookupSection338("0402.10.05.00", "CA");
  assert.ok(match);
  assert.equal(match?.basket, "dairy");
  assert.equal(match?.ratePercent, 0.5);
});

test("a verified Canada-origin motor-vehicle-basket consumer good (lamps, 9405.29) matches", () => {
  const match = lookupSection338("9405.29.80.00", "CA");
  assert.ok(match);
  assert.equal(match?.basket, "motor_vehicle_basket");
  assert.equal(match?.chapter99Code, "9903.03.14");
});

test("the same HTS codes do NOT match for a non-Canada origin", () => {
  assert.equal(lookupSection338("2208.30.60.85", "FR"), null);
  assert.equal(lookupSection338("0402.10.05.00", "US"), null);
});

test("an HTS code outside the small verified table returns null, never a guess", () => {
  assert.equal(lookupSection338("8471.30.01.00", "CA"), null);
});

test("an empty or garbage HTS code returns null rather than throwing", () => {
  assert.equal(lookupSection338("", "CA"), null);
  assert.equal(lookupSection338("not-a-code", "CA"), null);
});

test("the module's verified effective date is 2026-08-22, the actual first-collection date", () => {
  assert.equal(SECTION_338_EFFECTIVE_DATE, "2026-08-22");
});

test("the note on a matched measure names the basket, rate, and exclusions", () => {
  const match = lookupSection338("2208.30.60.85", "CA");
  assert.ok(match);
  assert.match(match!.note, /50%/);
  assert.match(match!.note, /Section 232/);
});
