import assert from "node:assert/strict";
import test from "node:test";
import { computeDuty, parseDutyRate, specialProgrammeCodes } from "@/lib/tariff/duty-expression";

test("plain rates parse", () => {
  const free = parseDutyRate("Free");
  assert.equal(free.free, true);
  assert.equal(free.parsed, true);

  const advalorem = parseDutyRate("8.8%");
  assert.equal(advalorem.adValorem, 0.088);
  assert.equal(advalorem.parsed, true);

  const column2 = parseDutyRate("90%");
  assert.equal(column2.adValorem, 0.9);

  const specific = parseDutyRate("2.5¢/kg");
  assert.equal(specific.specificAmount, 0.025);
  assert.equal(specific.specificUnit, "kg");
  assert.equal(specific.parsed, true);

  const dollars = parseDutyRate("$1.50/kg");
  assert.equal(dollars.specificAmount, 1.5);
});

test("an FTA country list does not defeat the rate", () => {
  const rate = parseDutyRate("Free (AU,BH, CL,CO,IL,JO,KR, MA,OM,P, PA,PE,S,SG)");
  assert.equal(rate.free, true);
  assert.equal(rate.parsed, true);
  assert.deepEqual(specialProgrammeCodes("Free (AU,BH, CL,S,SG)"), ["AU", "BH", "CL", "S", "SG"]);
});

test("an unrecognised rate is never a partial number", () => {
  const weird = parseDutyRate("8.8% but see chapter note 3");
  assert.equal(weird.parsed, false);
  assert.match(weird.note ?? "", /does not understand/);

  const crossRef = parseDutyRate("See 9903.88.03");
  assert.equal(crossRef.parsed, false);

  const empty = parseDutyRate(null);
  assert.equal(empty.parsed, false);
});

test("ad valorem duty computes and shows its arithmetic", () => {
  const rate = parseDutyRate("8.8%");
  const duty = computeDuty(rate, { value: 400_000 });
  assert.equal(duty.amount, 35_200);
  assert.match(duty.basis.join(" "), /8\.80% × USD 400,000/);
});

test("Free computes to zero, and zero here means zero", () => {
  const duty = computeDuty(parseDutyRate("Free"), { value: 400_000 });
  assert.equal(duty.amount, 0);
  assert.match(duty.basis.join(" "), /Free/);
});

test("a compound rate without a quantity refuses to report the ad valorem half", () => {
  // "4.4¢/kg + 8.5%" read as "8.5%" is the dangerous failure: a confident,
  // materially under-stated duty. It must decline instead.
  const rate = parseDutyRate("4.4¢/kg + 8.5%");
  assert.equal(rate.parsed, true);
  assert.equal(rate.adValorem, 0.085);
  assert.equal(rate.specificAmount, 0.044);

  const noQuantity = computeDuty(rate, { value: 100_000 });
  assert.equal(noQuantity.amount, null, "must not report only the ad valorem part");
  assert.match(noQuantity.basis.join(" "), /under-state/);

  const withQuantity = computeDuty(rate, { value: 100_000, quantity: 12_000, unit: "kg" });
  // 100000 × 0.085 = 8500, plus 12000 × 0.044 = 528
  assert.equal(withQuantity.amount, 9_028);
  assert.match(withQuantity.basis.join(" "), /Specific/);
});

test("a mismatched quantity unit does not silently apply", () => {
  const rate = parseDutyRate("2.5¢/kg");
  const wrongUnit = computeDuty(rate, { value: 1_000, quantity: 50, unit: "pcs" });
  assert.equal(wrongUnit.amount, null);
});

test("an ad valorem rate with no shipment value cannot be computed", () => {
  const duty = computeDuty(parseDutyRate("8.8%"), { value: null });
  assert.equal(duty.amount, null);
  assert.match(duty.basis.join(" "), /no shipment value/);
});
