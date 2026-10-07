import assert from "node:assert/strict";
import test from "node:test";
import { extractChapter99Refs, lookupSection301Measure, lookupSection301SupplementalList4A, SECTION_301_CHINA_MEASURES } from "@/lib/tariff/section301";

test("extracts a single Chapter 99 cross-reference", () => {
  assert.deepEqual(extractChapter99Refs("See 9903.88.03"), ["9903.88.03"]);
});

test("extracts multiple distinct references and dedupes repeats", () => {
  assert.deepEqual(
    extractChapter99Refs("See 9903.88.01, 9903.88.03 and again 9903.88.01"),
    ["9903.88.01", "9903.88.03"],
  );
});

test("returns [] for null, empty, or non-matching text", () => {
  assert.deepEqual(extractChapter99Refs(null), []);
  assert.deepEqual(extractChapter99Refs(undefined), []);
  assert.deepEqual(extractChapter99Refs(""), []);
  assert.deepEqual(extractChapter99Refs("Free (AU,BH)"), []);
});

test("does not match a lookalike number that isn't a 9903.xx.xx heading", () => {
  assert.deepEqual(extractChapter99Refs("See 9904.88.03"), []);
  assert.deepEqual(extractChapter99Refs("9903.8.03"), []);
});

test("lookupSection301Measure returns the verified List 3 record", () => {
  const measure = lookupSection301Measure("9903.88.03");
  assert.ok(measure);
  assert.equal(measure?.ratePercent, 0.25);
  assert.equal(measure?.status, "active");
  assert.equal(measure?.effectiveDate, "2019-05-10");
  assert.match(measure!.federalRegisterCitations.join(" "), /84 FR 20459/);
});

test("lookupSection301Measure returns the verified List 4A reduced rate, not the original", () => {
  const measure = lookupSection301Measure("9903.88.15");
  assert.ok(measure);
  // Must reflect the CURRENT in-force rate (7.5%, Phase One), not the original 15%.
  assert.equal(measure?.ratePercent, 0.075);
  assert.match(measure!.federalRegisterCitations.join(" "), /85 FR 3741/);
  assert.match(measure!.federalRegisterCitations.join(" "), /15%/);
});

test("List 4B is recorded as suspended with a null rate, never a guessed number", () => {
  const measure = lookupSection301Measure("9903.88.04");
  assert.ok(measure);
  assert.equal(measure?.status, "suspended");
  assert.equal(measure?.ratePercent, null);
});

test("an unrecognised Chapter 99 code returns null, never a fabricated measure", () => {
  assert.equal(lookupSection301Measure("9903.99.99"), null);
});

test("every table entry country is CN (this table is China Section 301 only)", () => {
  for (const measure of Object.values(SECTION_301_CHINA_MEASURES)) {
    assert.equal(measure.country, "CN");
  }
});

test("every table entry's key matches its own chapter99Code field", () => {
  for (const [key, measure] of Object.entries(SECTION_301_CHINA_MEASURES)) {
    assert.equal(key, measure.chapter99Code);
  }
});

// --- Supplemental List 4A table (verified via CBP rulings) ---

test("lookupSection301SupplementalList4A matches verified footwear and speaker codes", () => {
  assert.ok(lookupSection301SupplementalList4A("6404.11.90.20"));
  assert.ok(lookupSection301SupplementalList4A("6404.19.90.30"));
  assert.ok(lookupSection301SupplementalList4A("8518.22.00.00"));
  assert.ok(lookupSection301SupplementalList4A("8518.21.00.00"));
  assert.ok(lookupSection301SupplementalList4A("8517.62.00.00"));
});

test("lookupSection301SupplementalList4A returns the 9903.88.15 heading with a CBP ruling citation", () => {
  const match = lookupSection301SupplementalList4A("6404.11.90.20");
  assert.ok(match);
  assert.equal(match?.chapter99Code, "9903.88.15");
  assert.match(match!.rulingCitation, /NY N346450/);
});

test("lookupSection301SupplementalList4A returns null for a code outside the verified table", () => {
  assert.equal(lookupSection301SupplementalList4A("0101.21.00.10"), null);
  assert.equal(lookupSection301SupplementalList4A(""), null);
});
