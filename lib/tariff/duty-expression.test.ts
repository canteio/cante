import assert from "node:assert/strict";
import test from "node:test";
import { computeDuty, parseDutyRate, specialProgrammeCodes } from "./duty-expression";

test("parseDutyRate reads a plain ad valorem rate", () => {
  const rate = parseDutyRate("8.8%");
  assert.equal(rate.parsed, true);
  assert.equal(rate.free, false);
  assert.equal(rate.adValorem, 0.088);
  assert.equal(rate.specificAmount, null);
});

test("parseDutyRate reads Free including a trailing FTA country list", () => {
  const rate = parseDutyRate("Free (AU,BH,CL)");
  assert.equal(rate.parsed, true);
  assert.equal(rate.free, true);
  assert.equal(rate.adValorem, null);
});

test("parseDutyRate reads a specific (per-unit) rate in cents", () => {
  const rate = parseDutyRate("2.5\u00a2/kg");
  assert.equal(rate.parsed, true);
  assert.equal(rate.specificAmount, 0.025);
  assert.equal(rate.specificUnit, "kg");
  assert.equal(rate.adValorem, null);
});

test("parseDutyRate reads a compound rate (specific + ad valorem)", () => {
  const rate = parseDutyRate("4.4\u00a2/kg + 8.5%");
  assert.equal(rate.parsed, true);
  assert.equal(rate.adValorem, 0.085);
  assert.equal(rate.specificAmount, 0.044);
  assert.equal(rate.specificUnit, "kg");
});

test("parseDutyRate refuses a cross-reference to another heading", () => {
  const rate = parseDutyRate("See 9903.88.15");
  assert.equal(rate.parsed, false);
  assert.match(rate.note ?? "", /cross-references/);
});

test("parseDutyRate refuses an unrecognised expression rather than guessing", () => {
  const rate = parseDutyRate("The rate applicable to article of heading 9802");
  assert.equal(rate.parsed, false);
  assert.equal(rate.adValorem, null);
  assert.equal(rate.specificAmount, null);
});

test("parseDutyRate flags leftover residue instead of silently dropping it", () => {
  // A component this parser doesn't recognise (e.g. "+ Chapter 99 rate")
  // must not be silently discarded from a rate that otherwise looks parseable.
  const rate = parseDutyRate("8.5% + extra");
  assert.equal(rate.parsed, false);
  assert.equal(rate.adValorem, 0.085);
  assert.match(rate.note ?? "", /does not understand/);
});

test("parseDutyRate handles an empty or missing rate", () => {
  const rate = parseDutyRate("");
  assert.equal(rate.parsed, false);
  assert.match(rate.note ?? "", /No duty rate was published/);
  assert.equal(parseDutyRate(null).parsed, false);
  assert.equal(parseDutyRate(undefined).parsed, false);
});

test("computeDuty applies a Free rate", () => {
  const result = computeDuty(parseDutyRate("Free"), { value: 10000 });
  assert.equal(result.amount, 0);
});

test("computeDuty applies a plain ad valorem rate against shipment value", () => {
  const result = computeDuty(parseDutyRate("8.8%"), { value: 10000 });
  assert.equal(result.amount, 880);
});

test("computeDuty returns null (never a partial figure) when value is missing", () => {
  const result = computeDuty(parseDutyRate("8.8%"), { value: null });
  assert.equal(result.amount, null);
});

test("computeDuty returns null for a specific rate with no matching-unit quantity", () => {
  const result = computeDuty(parseDutyRate("2.5\u00a2/kg"), { value: 10000, quantity: null });
  assert.equal(result.amount, null);
});

test("computeDuty combines ad valorem and specific parts of a compound rate", () => {
  const result = computeDuty(parseDutyRate("4.4\u00a2/kg + 8.5%"), {
    value: 10000,
    quantity: 500,
    unit: "kg",
  });
  // 500kg * 0.044 = 22, plus 10000 * 0.085 = 850 -> 872
  assert.equal(result.amount, 872);
});

test("computeDuty returns null when a rate could not be parsed at all", () => {
  const result = computeDuty(parseDutyRate("See 9903.88.15"), { value: 10000 });
  assert.equal(result.amount, null);
});

test("specialProgrammeCodes extracts FTA symbols from a special rate string", () => {
  const codes = specialProgrammeCodes("Free (AU,BH, CL,CO,IL,JO,KR, MA,OM,P, PA,PE,S,SG)");
  assert.deepEqual(codes, [
    "AU", "BH", "CL", "CO", "IL", "JO", "KR", "MA", "OM", "P", "PA", "PE", "S", "SG",
  ]);
});

test("specialProgrammeCodes returns empty array when no programme list is present", () => {
  assert.deepEqual(specialProgrammeCodes(null), []);
  assert.deepEqual(specialProgrammeCodes(undefined), []);
  assert.deepEqual(specialProgrammeCodes("Free"), []);
});
