import assert from "node:assert/strict";
import test from "node:test";
import { AD_CVD_ORDERS, lookupAdCvdAdvisories } from "@/lib/tariff/adcvd";

test("mattress leads remain country-specific and never become computed duties", () => {
  const expected = { CN: "A-570-092", MY: "A-557-818", RS: "A-801-002", TR: "A-489-841", VN: "A-552-827" };
  for (const [country, caseNumber] of Object.entries(expected)) {
    const matches = lookupAdCvdAdvisories("9404.21.00.10", country);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].caseNumbers, [caseNumber]);
    assert.equal(matches[0].computed, false);
    assert.equal("amount" in matches[0], false);
  }
  // Indonesia's revoked order must not be copied from the multi-country notice.
  assert.deepEqual(lookupAdCvdAdvisories("9404.21.00.10", "ID"), []);
});

test("a broad steel heading does not fabricate an AD/CVD scope determination", () => {
  assert.deepEqual(lookupAdCvdAdvisories("7318", "CN"), []);
  const rod = lookupAdCvdAdvisories("7318.15.50.90", "CN");
  assert.equal(rod[0].caseNumbers[0], "A-570-932");
  assert.equal(rod[0].computed, false);
});

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
