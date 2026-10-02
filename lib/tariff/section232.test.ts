import assert from "node:assert/strict";
import test from "node:test";
import { lookupSection232BasicArticle, lookupSection232Derivative } from "@/lib/tariff/section232";

test("a basic flat-rolled steel heading (7208) matches at 50% for a non-UK origin", () => {
  const match = lookupSection232BasicArticle("7208.10.15.00", "KR");
  assert.ok(match);
  assert.equal(match?.category, "steel");
  assert.equal(match?.ratePercent, 0.5);
  assert.equal(match?.chapter99Code, "9903.81.87/9903.81.88");
  assert.match(match!.federalRegisterCitations.join(" "), /90 FR 24199/);
});

test("the same steel heading from the United Kingdom is quoted at 25%, not 50%", () => {
  const match = lookupSection232BasicArticle("7208.10.15.00", "GB");
  assert.ok(match);
  assert.equal(match?.ratePercent, 0.25);
  assert.match(match!.note, /Economic Prosperity Deal/);
});

test("the three 7216.61/.69/.91 exclusions are NOT matched as basic steel articles", () => {
  assert.equal(lookupSection232BasicArticle("7216.61.00.00", "CN"), null);
  assert.equal(lookupSection232BasicArticle("7216.69.00.00", "CN"), null);
  assert.equal(lookupSection232BasicArticle("7216.91.00.00", "CN"), null);
});

test("a neighbouring 7216 subheading outside the exclusions still matches", () => {
  const match = lookupSection232BasicArticle("7216.10.00.00", "VN");
  assert.ok(match);
  assert.equal(match?.category, "steel");
});

test("unwrought aluminum (heading 7601) matches at 50% for a non-UK origin", () => {
  const match = lookupSection232BasicArticle("7601.10.60.00", "CN");
  assert.ok(match);
  assert.equal(match?.category, "aluminum");
  assert.equal(match?.ratePercent, 0.5);
  assert.equal(match?.chapter99Code, "9903.85.02");
});

test("aluminum castings/forgings only match the specific 7616.99.51 subheading, not all of 7616.99", () => {
  const match = lookupSection232BasicArticle("7616.99.51.60", "CN");
  assert.ok(match);
  assert.equal(match?.category, "aluminum");
  assert.equal(lookupSection232BasicArticle("7616.99.10.00", "CN"), null);
});

test("UK aluminum is quoted at 25% with the Economic Prosperity Deal caveat", () => {
  const match = lookupSection232BasicArticle("7601.10.60.00", "GB");
  assert.ok(match);
  assert.equal(match?.ratePercent, 0.25);
  assert.match(match!.note, /Economic Prosperity Deal/);
});

test("a Section 232 derivative product code (e.g. a washing machine, 8450.11.00) is NOT matched here", () => {
  assert.equal(lookupSection232BasicArticle("8450.11.00.00", "CN"), null);
});

test("a wholly unrelated HTS code (e.g. apparel, 6109.10.00) is not matched", () => {
  assert.equal(lookupSection232BasicArticle("6109.10.00.04", "VN"), null);
});

test("an empty/garbage code returns null rather than throwing", () => {
  assert.equal(lookupSection232BasicArticle("", "CN"), null);
  assert.equal(lookupSection232BasicArticle("not-a-code", "CN"), null);
});

test("every code in the verified June 23 appliance subset matches a steel content measure", () => {
  const codes = [
    "8418.10.00", "8451.21.00", "8451.29.00", "8450.11.00", "8450.20.00",
    "8422.11.00", "8418.30.00", "8418.40.00", "8516.60.40", "8509.80.20",
    "9403.99.9020",
  ];
  for (const code of codes) {
    const match = lookupSection232Derivative(code, "CN");
    assert.ok(match, code);
    assert.equal(match.measures[0].category, "steel", code);
    assert.equal(match.measures[0].ratePercent, 0.5, code);
    assert.equal(match.measures[0].effectiveDate, "2025-06-23", code);
    assert.match(match.measures[0].citations.join(" "), /90 FR 25208/, code);
    assert.match(match.measures[0].citations.join(" "), /65441222/, code);
  }
});

test("welded wire rack requires separate steel and aluminum content measures", () => {
  const match = lookupSection232Derivative("9403.99.9020", "VN");
  assert.ok(match);
  assert.deepEqual(match.measures.map((measure) => measure.category), ["steel", "aluminum"]);
  assert.equal(match.measures[1].effectiveDate, "2025-03-12");
  assert.equal(match.measures[1].contentValueField, "aluminumContentValue");
});

test("the derivative subset uses the UK content rates and headings", () => {
  const match = lookupSection232Derivative("8450.11.00.90", "GB");
  assert.ok(match);
  assert.equal(match.measures[0].ratePercent, 0.25);
  assert.equal(match.measures[0].chapter99Code, "9903.81.98");
});

test("nearby codes are not implied to belong to the bounded derivative subset", () => {
  assert.equal(lookupSection232Derivative("8450.12.00", "CN"), null);
  assert.equal(lookupSection232Derivative("9403.99.9010", "CN"), null);
});
