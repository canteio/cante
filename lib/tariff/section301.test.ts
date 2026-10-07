import assert from "node:assert/strict";
import test from "node:test";
import { extractChapter99Refs, lookupSection301Measure, lookupSection301Coverage, SECTION_301_CHINA_MEASURES } from "@/lib/tariff/section301";

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

test("List 4B is recorded under 9903.88.16 as suspended, while 9903.88.04 remains active List 3", () => {
  const list3Companion = lookupSection301Measure("9903.88.04");
  assert.ok(list3Companion);
  assert.equal(list3Companion.status, "active");
  assert.equal(list3Companion.ratePercent, 0.25);

  const list4b = lookupSection301Measure("9903.88.16");
  assert.ok(list4b);
  assert.equal(list4b.status, "suspended");
  assert.equal(list4b.ratePercent, null);
  assert.match(list4b.federalRegisterCitations.join(" "), /84 FR 69447/);
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

test("snapshot preserves old valid footwear/speaker coverage and fixes split electronics", () => {
  for (const code of ["6404.11.20", "6404.11.71", "6404.11.79", "6404.11.81", "6404.11.89", "6404.11.90", "6404.19.9060", "8518.21.00", "8518.22.00"]) {
    assert.equal(lookupSection301Coverage(code)?.chapter99Code, "9903.88.15", code);
  }
  for (const [code, heading, rate] of [
    ["3916.90.30", "9903.88.02", 0.25],
    ["8517.62.0010", "9903.88.04", 0.25],
    ["8517.62.0020", "9903.88.04", 0.25],
    ["8517.62.0090", "9903.88.15", 0.075],
  ] as const) {
    const match = lookupSection301Coverage(code);
    assert.equal(match?.chapter99Code, heading);
    assert.equal(lookupSection301Measure(match!.chapter99Code)?.ratePercent, rate);
  }
  for (const code of ["8517.62", "8517.62.00", "8517.62.0000"]) {
    assert.equal(lookupSection301Coverage(code), null, code);
  }
  assert.equal(lookupSection301Coverage("6404.19.9030")?.chapter99Code, "9903.88.15");
  assert.equal(lookupSection301Coverage("6404.20.20")?.chapter99Code, "9903.88.15");
});

import snapshot from "./section301-coverage.json";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("generated snapshot preserves every extracted source row exactly", () => {
  const text = readFileSync("scripts/test-fixtures/usitc-china-tariffs-2026-07-28.txt", "utf8");
  const rows = [...text.matchAll(/^(\d{4}\.\d{2}\.\d{2}(?:\d{2})?)\s+(9903\.\d{2}\.\d{2})\s*$/gm)];
  assert.equal(rows.length, 10460);
  assert.equal(Object.keys(snapshot.coverage).length, rows.length);
  assert.equal(snapshot.sourceTextSha256, createHash("sha256").update(text).digest("hex"));
  for (const [, code, heading] of rows) assert.equal(lookupSection301Coverage(code)?.chapter99Code, heading, code);
  assert.equal(Object.keys(snapshot.coverage).filter(k => k.length === 10).length, 69);
});

// Exercise the real stack with deterministic USITC rows, not live network data.
import { computeStackedDuty } from "./stack";
import { resetTariffCacheForTests } from "./rates";

const active640411 = ["20", "71", "79", "81", "89", "90"];
const suspended640411 = ["41", "49", "51", "59", "61", "69", "75", "85"];

test("exact snapshot matching rejects unsupported siblings and malformed inputs", () => {
  for (const code of ["6404.11", "6404.20.0000", "8517.62.9900", "8518.21.9900", "8518.22.9900", "85182200000", "junk85182200", "8518-22-00"]) {
    assert.equal(lookupSection301Coverage(code), null, code);
  }
  for (const code of ["85182200", "8518220000", "8518.22.00", "8518.22.0000", "8518.22.00.00"]) {
    assert.equal(lookupSection301Coverage(code)?.chapter99Code, "9903.88.15", code);
  }
});

async function stackRow(
  code: string,
  ref: string | null,
  date: string,
  country = "CN",
  publishedRowCode = code,
) {
  resetTariffCacheForTests();
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    json: async () => [{ htsno: publishedRowCode, general: "5%", additionalDuties: ref }],
  })) as unknown as typeof fetch;
  try {
    const result = await computeStackedDuty({ htsCode: code, countryOfOrigin: country, value: 1000, importDate: date });
    assert.ok(result);
    return result;
  } finally {
    global.fetch = original;
    resetTariffCacheForTests();
  }
}

test("all cited 6404.11 active and suspended lines produce distinct stack behavior", async () => {
  for (const suffix of active640411) {
    const result = await stackRow(`6404.11.${suffix}.00`, null, "2026-10-06");
    const component = result.components.find((c) => c.type === "section301");
    assert.equal(component?.ratePercent, 0.075, suffix);
    assert.equal(component?.amount, 75, suffix);
    assert.deepEqual(result.unresolvedMeasures, []);
  }
  for (const suffix of suspended640411) {
    const result = await stackRow(`6404.11.${suffix}.00`, null, "2026-10-06");
    assert.equal(result.components.some((c) => c.type === "section301"), false, suffix);
    assert.ok(result.unresolvedMeasures.some((m) => m.includes("Section 301 applicability")), suffix);
    assert.equal(result.totalRatePercent, null);
    assert.equal(result.totalAmount, null);
  }
});

test("List 3 companion .04 stacks at 25% only from its current-rate effective date", async () => {
  for (const date of ["2019-05-10", "2026-10-06"]) {
    const result = await stackRow("8544.42.90.00", "See 9903.88.04", date);
    const component = result.components.find((c) => c.type === "section301");
    assert.match(component!.label, /List 3/);
    assert.equal(component?.ratePercent, 0.25);
    assert.equal(component?.amount, 250);
  }
  const historical = await stackRow("8544.42.90.00", "See 9903.88.04", "2019-05-09");
  assert.equal(historical.components.some((c) => c.type === "section301"), false);
  assert.ok(historical.unresolvedMeasures.includes("9903.88.04 historical rate before 2019-05-10"));
});

test("snapshot and row-reference paths both withhold rates before their effective date", async () => {
  for (const [code, heading, before, effective, rate] of [
    ["6404.11.90.20", "9903.88.15", "2020-02-13", "2020-02-14", 0.075],
    ["3916.90.30.00", "9903.88.02", "2018-08-22", "2018-08-23", 0.25],
  ] as const) {
    for (const ref of [null, `See ${heading}`]) {
      const historical = await stackRow(code, ref, before);
      assert.equal(historical.components.some((c) => c.type === "section301"), false);
      assert.ok(historical.unresolvedMeasures.includes(`${heading} historical rate before ${effective}`));
      const current = await stackRow(code, ref, effective);
      assert.equal(current.components.find((c) => c.type === "section301")?.ratePercent, rate);
    }
  }
});

test("coarse caller inputs cannot inherit a more-specific row's snapshot membership", async () => {
  const sixDigit = await stackRow("6404.11", null, "2026-10-06", "CN", "6404.11.90");
  assert.equal(sixDigit.components.some((component) => component.type === "section301"), false);
  assert.ok(sixDigit.unresolvedMeasures.some((measure) => measure.includes("Section 301 applicability")));

  const eightDigit = await stackRow("8517.62.00", null, "2026-10-06", "CN", "8517.62.0090");
  assert.equal(eightDigit.components.some((component) => component.type === "section301"), false);
  assert.ok(eightDigit.unresolvedMeasures.some((measure) => measure.includes("Section 301 applicability")));
});

test("future entry dates withhold aggregate totals instead of projecting today's rate", async () => {
  const result = await stackRow("6404.11.90.20", null, "9999-12-31");
  assert.equal(result.components.find((component) => component.type === "section301")?.ratePercent, 0.075);
  assert.equal(result.totalRatePercent, null);
  assert.equal(result.totalAmount, null);
  assert.ok(result.unresolvedMeasures.some((measure) => measure.includes("Future import date 9999-12-31")));
  assert.ok(result.stackingExplanation.some((line) => line.includes("after today's date")));
});

test("published references take priority; unsupported text stays unresolved; non-China does not stack", async () => {
  const suspended = await stackRow("6404.11.90.20", "See 9903.88.16", "2026-10-06");
  assert.equal(suspended.components.some((c) => c.type === "section301"), false);
  assert.ok(suspended.stackingExplanation.some((m) => m.includes("suspended and never took effect")));
  for (const text of ["See 9903.99.99", "See U.S. note 20"]) {
    const unknown = await stackRow("6404.11.90.20", text, "2026-10-06");
    assert.equal(unknown.components.some((c) => c.type === "section301"), false);
    assert.ok(unknown.unresolvedMeasures.length > 0);
  }
  const otherOrigin = await stackRow("6404.11.90.20", null, "2026-10-06", "VN");
  assert.equal(otherOrigin.components.some((c) => c.type === "section301"), false);
  assert.deepEqual(otherOrigin.unresolvedMeasures, []);
});


test("split statistical suffixes resolve through the stack even with a rated parent row", async () => {
  for (const [code, rate] of [["8517.62.0010", 0.25], ["8517.62.0020", 0.25], ["8517.62.0090", 0.075]] as const) {
    const result = await stackRow(code, null, "2026-10-06", "CN", "8517.62.00");
    assert.equal(result.components.find(c => c.type === "section301")?.ratePercent, rate);
  }
});

test("snapshot headings without verified rates remain explicitly unresolved", async () => {
  const entry = Object.entries(snapshot.coverage).find(([, heading]) => !lookupSection301Measure(heading));
  assert.ok(entry);
  const result = await stackRow(entry[0], null, "2026-10-06");
  assert.ok(result.unresolvedMeasures.includes(entry[1]));
  assert.equal(result.totalRatePercent, null);
});
