import assert from "node:assert/strict";
import test from "node:test";
import { codesMentionedIn } from "./assess";

/**
 * codesMentionedIn() had no direct unit coverage even though it is the
 * regex-driven entry point that decides which HS/HTS codes a finding is
 * considered to mention — everything downstream (product matching, exposure
 * math) depends on it finding the right digits and ignoring noise.
 */

test("codesMentionedIn extracts a fully-dotted 10-digit HTS code from title text", () => {
  const codes = codesMentionedIn({
    title: "New duty on HTS 6306.12.00.00 tarpaulins",
    summaryEn: null,
    reasoning: null,
    regulationRef: null,
  });
  // The regex captures every dotted group present, so a fully-qualified
  // 10-digit statistical suffix is kept whole rather than truncated to the
  // 8-digit tariff-line prefix.
  assert.ok(codes.includes("6306120000"));
});

test("codesMentionedIn extracts a bare 6-digit heading from reasoning text", () => {
  const codes = codesMentionedIn({
    title: null,
    summaryEn: null,
    reasoning: "The measure applies to heading 630612 broadly.",
    regulationRef: null,
  });
  assert.ok(codes.includes("630612"));
});

test("codesMentionedIn currently matches a space-separated year+month as a false-positive code", () => {
  // Documents an existing limitation rather than asserting an ideal: the
  // regex's `[.\s]?` separator also matches a plain space, so "2026 12"
  // parses as a 6-digit code even though it is really a date. The module's
  // own comment says short numeric noise like a year should be filtered,
  // but that only holds for unseparated digits — a space-joined year/month
  // still passes the >=6-digit length check. Recorded here so a future fix
  // to the regex has a regression test to flip green.
  const codes = codesMentionedIn({
    title: "Effective 2026 12 rule change",
    summaryEn: null,
    reasoning: null,
    regulationRef: null,
  });
  assert.deepEqual(codes, ["202612"]);
});

test("codesMentionedIn deduplicates the same code mentioned in multiple fields", () => {
  const codes = codesMentionedIn({
    title: "Tariff change for 6306.12",
    summaryEn: "See 6306.12 for the affected heading.",
    reasoning: null,
    regulationRef: null,
  });
  assert.deepEqual(codes, ["630612"]);
});

test("codesMentionedIn does not read regulationRef, only title/summary/reasoning", () => {
  const codes = codesMentionedIn({
    title: null,
    summaryEn: null,
    reasoning: null,
    regulationRef: "6306.12.00.00",
  });
  assert.equal(codes.length, 0);
});
