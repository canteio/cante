import assert from "node:assert/strict";
import test from "node:test";
import { lookupSection232BasicArticle } from "@/lib/tariff/section232";

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
