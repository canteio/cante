import assert from "node:assert/strict";
import test from "node:test";
import { AD_CVD_ORDERS, lookupAdCvdAdvisories } from "@/lib/tariff/adcvd";

test("matches a China-origin solar cell HTS code to its AD/CVD advisory", () => {
  const advisories = lookupAdCvdAdvisories("8541.42.00.10", "CN");
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].caseNumbers[0], "A-570-979");
  assert.equal(advisories[0].computed, false);
});

test("does not match the same HTS code from a non-China origin", () => {
  assert.deepEqual(lookupAdCvdAdvisories("8541.42.00.10", "VN"), []);
});

test("matches a China-origin wood flooring HTS code", () => {
  const advisories = lookupAdCvdAdvisories("4412.91.05.05", "CN");
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].caseNumbers[0], "A-570-970");
});

test("returns [] for an HTS code outside every table entry's prefix", () => {
  assert.deepEqual(lookupAdCvdAdvisories("0101.21.00.10", "CN"), []);
});

test("returns [] for an empty or unusable HTS code", () => {
  assert.deepEqual(lookupAdCvdAdvisories("", "CN"), []);
  assert.deepEqual(lookupAdCvdAdvisories("not-a-code", "CN"), []);
});

test("every table entry's computed flag is false, never a fabricated duty amount", () => {
  for (const order of AD_CVD_ORDERS) {
    // The table itself has no `computed` field — only lookupAdCvdAdvisories results do.
    assert.equal("computed" in order, false);
  }
});
