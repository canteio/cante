import assert from "node:assert/strict";
import test from "node:test";
import { resolveStackingRule, type StackingRuleRow } from "./stacking-rules";

function rule(overrides: Partial<StackingRuleRow> = {}): StackingRuleRow {
  return {
    id: "rule-1",
    action: "include",
    capRatePercent: null,
    conditions: {},
    priority: 100,
    citation: "Test citation",
    ruleText: "Test rule",
    effectiveDate: null,
    expiresDate: null,
    precedenceOver: null,
    precedenceReason: null,
    ...overrides,
  };
}

test("an unflagged measure (zero rows) leaves stack.ts's default behavior untouched", () => {
  const result = resolveStackingRule([], { section_232_matched: true }, "2026-09-20");
  assert.deepEqual(result, { status: "unflagged" });
});

test("known case: Section 338 alcohol basket includes when Section 232 matched, per the confirmed rule", () => {
  const rows = [rule({ action: "include", conditions: { section_232_matched: true }, citation: "FR doc 2026-18838" })];
  const result = resolveStackingRule(rows, { section_232_matched: true }, "2026-09-20");
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.match.action, "include");
    assert.equal(result.match.citation, "FR doc 2026-18838");
  }
});

test("known case, other direction: no rule matches when the condition fact is false", () => {
  const rows = [rule({ action: "include", conditions: { section_232_matched: true } })];
  const result = resolveStackingRule(rows, { section_232_matched: false }, "2026-09-20");
  assert.equal(result.status, "needs_review");
});

test("missing data: an unsupplied fact never silently matches either direction", () => {
  const rows = [
    rule({ id: "a", action: "include", conditions: { usmca_qualified: true } }),
    rule({ id: "b", action: "exclude", conditions: { usmca_qualified: false } }),
  ];
  const result = resolveStackingRule(rows, { usmca_qualified: undefined }, "2026-09-20");
  assert.equal(result.status, "needs_review");
});

test("conflicting rules WITH precedence_over resolve deterministically to the named winner", () => {
  const rows = [
    rule({ id: "base", action: "exclude", conditions: { x: true }, priority: 50 }),
    rule({
      id: "override", action: "include", conditions: { x: true }, priority: 10,
      precedenceOver: "base", precedenceReason: "The later amendment explicitly supersedes the general exclusion.",
    }),
  ];
  const result = resolveStackingRule(rows, { x: true }, "2026-09-20");
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.match.ruleId, "override");
    assert.match(result.match.explanation, /takes precedence over a conflicting rule/);
  }
});

test("conflicting rules WITHOUT precedence_over never resolve via priority alone", () => {
  const rows = [
    rule({ id: "a", action: "exclude", conditions: { x: true }, priority: 10 }),
    rule({ id: "b", action: "include", conditions: { x: true }, priority: 50 }),
  ];
  const result = resolveStackingRule(rows, { x: true }, "2026-09-20");
  assert.equal(result.status, "needs_review");
  if (result.status === "needs_review") assert.match(result.reason, /multiple confirmed rules/i);
});

test("expired rule does not match a current shipment, but matches a historical one before expiry", () => {
  const rows = [rule({ conditions: {}, expiresDate: "2026-06-01" })];
  assert.equal(resolveStackingRule(rows, {}, "2026-09-20").status, "needs_review");
  assert.equal(resolveStackingRule(rows, {}, "2026-03-01").status, "resolved");
});

test("a shipment dated before the rule's effective date does not match", () => {
  const rows = [rule({ conditions: {}, effectiveDate: "2026-09-15" })];
  assert.equal(resolveStackingRule(rows, {}, "2026-08-01").status, "needs_review");
  assert.equal(resolveStackingRule(rows, {}, "2026-09-16").status, "resolved");
});

test("a confirmed exclude rule resolves with its action and citation", () => {
  const rows = [rule({ action: "exclude", conditions: { usmca_qualified: true }, citation: "19 U.S.C. example", ruleText: "Excluded when USMCA-qualified." })];
  const result = resolveStackingRule(rows, { usmca_qualified: true }, "2026-09-20");
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") {
    assert.equal(result.match.action, "exclude");
    assert.equal(result.match.explanation, "Excluded when USMCA-qualified.");
  }
});

test("two confirmed rules with the SAME action and overlapping conditions are not treated as a conflict", () => {
  const rows = [
    rule({ id: "a", action: "exclude", conditions: { x: true }, priority: 10 }),
    rule({ id: "b", action: "exclude", conditions: { x: true }, priority: 50 }),
  ];
  const result = resolveStackingRule(rows, { x: true }, "2026-09-20");
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") assert.equal(result.match.ruleId, "a");
});

test("no asOfDate falls back to today via easternIsoDate, not an unbounded match", () => {
  const rows = [rule({ conditions: {}, expiresDate: "2000-01-01" })];
  const result = resolveStackingRule(rows, {}, null);
  assert.equal(result.status, "needs_review");
});

test("one precedence link cannot resolve three different outcomes", () => {
  const rows = [rule({ id: "a", action: "include", precedenceOver: "b", precedenceReason: "a overrides b" }),
    rule({ id: "b", action: "exclude" }), rule({ id: "c", action: "cap_at", capRatePercent: 0.1 })];
  assert.equal(resolveStackingRule(rows, {}, "2026-09-20").status, "needs_review");
});

test("cyclic precedence never manufactures a winner", () => {
  const rows = [rule({ id: "a", action: "include", precedenceOver: "b", precedenceReason: "a overrides b" }),
    rule({ id: "b", action: "exclude", precedenceOver: "a", precedenceReason: "b overrides a" })];
  assert.equal(resolveStackingRule(rows, {}, "2026-09-20").status, "needs_review");
});

test("a potentially conflicting rule with missing facts withholds a fallback total", () => {
  const rows = [rule({ id: "a", action: "include" }), rule({ id: "b", action: "exclude", conditions: { usmca_qualified: true } })];
  assert.equal(resolveStackingRule(rows, {}, "2026-09-20").status, "needs_review");
});

test("scope conditions match origin exactly and HTS prefixes deterministically", () => {
  const rows = [rule({ conditions: { country_of_origin: "CA", hts_prefix: "2204" } })];
  assert.equal(resolveStackingRule(rows, { country_of_origin: "CA", hts_prefix: "2204100000" }, "2026-09-20").status, "resolved");
  assert.equal(resolveStackingRule(rows, { country_of_origin: "CN", hts_prefix: "2204100000" }, "2026-09-20").status, "needs_review");
});
