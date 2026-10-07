import assert from "node:assert/strict";
import test from "node:test";
import { lookupTariff } from "./rates";
import { extractChapter99Refs, lookupSection301Measure } from "./section301";

// Deliberately live: a network failure is a failure, never a mocked success or skip.
// Membership evidence: USTR 84 FR 43304, Annex A (4A) and Annex C (4B).
for (const code of ["6404.11", "8518.22", "8517.13"]) {
  test(`live USITC Chapter 99 resolution for ${code}`, { timeout: 35_000 }, async () => {
    const row = await lookupTariff(code, { signal: AbortSignal.timeout(30_000) });
    assert.ok(row, `USITC must return a real row for ${code}`);
    const refs = extractChapter99Refs(row.additionalDuties);
    const active = refs.map(lookupSection301Measure).filter(
      (measure) => measure?.status === "active",
    );
    if (code === "8517.13") assert.deepEqual(active, [], "smartphones are not active List 4A");
    for (const measure of active) {
      assert.ok(measure);
      assert.ok(refs.includes(measure.chapter99Code));
      assert.ok(measure.federalRegisterCitations.length > 0);
      assert.ok(measure.ratePercent !== null && measure.ratePercent > 0);
      if (code === "8518.22") {
        assert.equal(measure.chapter99Code, "9903.88.15");
        assert.equal(measure.ratePercent, 0.075);
      }
    }
    if (!refs.length) {
      assert.deepEqual(active, []);
      assert.equal(lookupSection301Measure(code), null);
      // Missing additionalDuties is missing evidence, not proof of exemption.
    }
  });
}


import { computeStackedDuty } from "./stack";
import { resetTariffCacheForTests } from "./rates";

test("live USITC filament stack includes List 2 duty", { timeout: 35_000 }, async () => {
  resetTariffCacheForTests();
  const result = await computeStackedDuty({
    htsCode: "3916.90.30.00", countryOfOrigin: "CN", value: 1000,
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(result);
  const measure = result.components.find(c => c.type === "section301");
  assert.ok(measure);
  assert.match(measure.label, /List 2/);
  assert.equal(measure.ratePercent, 0.25);
  assert.equal(measure.amount, 250);
  assert.ok(!result.unresolvedMeasures.some(m => /Section 301|9903\.88\.02/.test(m)));
});
