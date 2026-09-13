import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_JURISDICTION,
  jurisdictionCode,
  normalizeJurisdiction,
} from "./countries";

test("DEFAULT_JURISDICTION is United States (Cante's primary GTM market)", () => {
  assert.equal(DEFAULT_JURISDICTION, "United States");
});

test("normalizeJurisdiction maps US variants to United States", () => {
  assert.equal(normalizeJurisdiction("us"), "United States");
  assert.equal(normalizeJurisdiction("USA"), "United States");
  assert.equal(normalizeJurisdiction("United States"), "United States");
  assert.equal(normalizeJurisdiction("united states of america"), "United States");
});

test("normalizeJurisdiction recognizes Indonesia variants explicitly", () => {
  assert.equal(normalizeJurisdiction("indonesia"), "Indonesia");
  assert.equal(normalizeJurisdiction("ID"), "Indonesia");
});

test("normalizeJurisdiction falls back to DEFAULT_JURISDICTION for unknown input", () => {
  assert.equal(normalizeJurisdiction("random"), DEFAULT_JURISDICTION);
  assert.equal(normalizeJurisdiction(undefined), DEFAULT_JURISDICTION);
  assert.equal(normalizeJurisdiction(42), DEFAULT_JURISDICTION);
});

test("jurisdictionCode maps names to ISO-ish codes", () => {
  assert.equal(jurisdictionCode("United States"), "US");
  assert.equal(jurisdictionCode("Indonesia"), "ID");
});
