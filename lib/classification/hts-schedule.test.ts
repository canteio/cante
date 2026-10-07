import assert from "node:assert/strict";
import test from "node:test";
import { flattenHtsChapter } from "./hts-schedule";

const fixture = [
  { htsno: "3916", indent: "0", description: "Monofilament &amp; profile shapes, of plastics:" },
  { htsno: "", indent: "1", description: "Of other plastics:" },
  { htsno: "3916.90.30", indent: "2", description: "Other", general: "5.8%", units: ["kg"] },
  { htsno: "3916.90.30.00", indent: "3", description: "Other" },
  { htsno: "3917.10.10", indent: "0", description: "Tubes", general: "Free" },
];

test("HTS leaves retain uncoded ancestors and inherit rates without sibling bleed", () => {
  const rows = flattenHtsChapter(fixture, "39");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullDescription, "Monofilament & profile shapes, of plastics: > Of other plastics: > Other > Other");
  assert.equal(rows[0].general, "5.8%");
  assert.deepEqual(rows[0].units, ["kg"]);
  assert.equal(rows[1].fullDescription, "Tubes");
  assert.deepEqual(rows[1].units, []);
});

test("description hash changes for ancestor changes but not rate-only changes", () => {
  const original = flattenHtsChapter(fixture, "39")[0];
  const rateChange = fixture.map((row) => ({ ...row, general: row.general ? "6%" : undefined }));
  assert.equal(flattenHtsChapter(rateChange, "39")[0].descriptionHash, original.descriptionHash);
  const textChange = fixture.map((row, i) => ({ ...row, description: i ? row.description : "Changed heading" }));
  assert.notEqual(flattenHtsChapter(textChange, "39")[0].descriptionHash, original.descriptionHash);
});

test("malformed, wrong-chapter, duplicate and empty responses fail explicitly", () => {
  assert.throws(() => flattenHtsChapter({}, "39"));
  assert.throws(() => flattenHtsChapter(fixture, "85"), /contains/);
  assert.throws(() => flattenHtsChapter([...fixture, fixture[4]], "39"), /Duplicate/);
  assert.throws(() => flattenHtsChapter([], "39"), /No rate-bearing/);
  assert.deepEqual(flattenHtsChapter([], "77"), []);
});
