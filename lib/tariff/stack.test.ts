import assert from "node:assert/strict";
import test from "node:test";
import { resetTariffCacheForTests } from "@/lib/tariff/rates";
import { computeStackedDuty } from "@/lib/tariff/stack";

/**
 * Stubs the USITC fetch the same way rates.test.ts does — stack.ts calls
 * through quoteDuty/lookupTariff, so real network I/O is never exercised here.
 */
function stubFetch(rows: unknown[], status = 200) {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => rows,
  })) as unknown as typeof global.fetch;
  return () => {
    global.fetch = original;
  };
}

test.beforeEach(() => {
  resetTariffCacheForTests();
});

test("China-origin row with a List 3 cross-reference stacks base + Section 301 additively", async () => {
  const restore = stubFetch([
    {
      htsno: "8544.42.90.00",
      general: "2.6%",
      special: "Free (S)",
      other: "35%",
      additionalDuties: "See 9903.88.03",
    },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8544.42.90.00",
      countryOfOrigin: "CN",
      value: 10_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 2);
    assert.equal(result!.components[0].type, "base");
    assert.equal(result!.components[0].ratePercent, 0.026);
    assert.equal(result!.components[1].type, "section301");
    assert.equal(result!.components[1].ratePercent, 0.25);
    assert.equal(result!.components[1].amount, 2500);

    // 2.6% + 25% = 27.6%, additive.
    assert.equal(result!.totalRatePercent, 0.276);
    // 260 (base) + 2500 (301) = 2760
    assert.equal(result!.totalAmount, 2760);

    assert.ok(result!.stackingExplanation.some((line) => line.includes("stacks additively")));
    assert.ok(result!.stackingExplanation.some((line) => line.includes("84 FR 20459")));
    assert.deepEqual(result!.unresolvedMeasures, []);
    assert.ok(result!.notEvaluated.some((line) => line.includes("Section 232")));
  } finally {
    restore();
  }
});

test("the same HTS row from Vietnam does not pick up the China-only Section 301 measure", async () => {
  const restore = stubFetch([
    {
      htsno: "8544.42.90.00",
      general: "2.6%",
      other: "35%",
      additionalDuties: "See 9903.88.03",
    },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8544.42.90.00",
      countryOfOrigin: "VN",
      value: 10_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 1);
    assert.equal(result!.totalRatePercent, 0.026);
    assert.equal(result!.totalAmount, 260);
    assert.ok(
      result!.stackingExplanation.some((line) => line.includes("not China") && line.includes("9903.88.03")),
    );
  } finally {
    restore();
  }
});

test("a China row with no supported Section 301 evidence returns NEEDS_REVIEW instead of a zero", async () => {
  const restore = stubFetch([{ htsno: "8517.62.00", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8517.62.00",
      countryOfOrigin: "CN",
      value: 5_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 1);
    assert.equal(result!.totalRatePercent, null);
    assert.equal(result!.totalAmount, null);
    assert.ok(result!.unresolvedMeasures.some((measure) => measure.includes("Section 301 applicability")));
    assert.ok(result!.stackingExplanation.some((line) => line.includes("remains unresolved")));
  } finally {
    restore();
  }
});

test("a suspended List 4B measure is explained but excluded from the total", async () => {
  const restore = stubFetch([
    { htsno: "6109.10.00.00", general: "16.5%", additionalDuties: "9903.88.16" },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "6109.10.00.00",
      countryOfOrigin: "CN",
      value: 1_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 1, "suspended measure must not add a component");
    assert.equal(result!.totalRatePercent, 0.165);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("suspended")));
  } finally {
    restore();
  }
});

test("an unrecognised Chapter 99 cross-reference is named as unresolved and voids the total rather than under-stating it", async () => {
  const restore = stubFetch([
    { htsno: "7606.12.30.30", general: "3%", additionalDuties: "See 9903.81.91" },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "7606.12.30.30",
      countryOfOrigin: "CN",
      value: 1_000,
    });
    assert.ok(result);
    assert.deepEqual(result!.unresolvedMeasures, ["9903.81.91"]);
    assert.equal(result!.totalRatePercent, null, "an unresolved measure must not be silently excluded from the total");
    assert.equal(result!.totalAmount, null);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("does not yet have verified")));
  } finally {
    restore();
  }
});

test("returns null (not a throw) when the HTS code has no published row at all", async () => {
  const restore = stubFetch([{ htsno: "9999.99.99.99", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0000.00.00.00",
      countryOfOrigin: "CN",
      value: 1_000,
    });
    assert.equal(result, null);
  } finally {
    restore();
  }
});

test("always names what Cante does not evaluate, regardless of what it does compute", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
    });
    assert.ok(result);
    assert.ok(result!.notEvaluated.length >= 4);
    assert.ok(result!.notEvaluated.some((l) => l.includes("USMCA")));
    assert.ok(result!.notEvaluated.some((l) => l.includes("AD/CVD")));
    assert.ok(result!.notEvaluated.some((l) => l.includes("forced-labor") || l.includes("Forced-labor") || l.toLowerCase().includes("forced-labor")));
  } finally {
    restore();
  }
});

test("a basic steel article from a non-UK, non-China origin picks up Section 232 at 50%, stacked on Column 1", async () => {
  const restore = stubFetch([{ htsno: "7210.70.60.60", general: "Free", other: "21.5%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "7210.70.60.60",
      countryOfOrigin: "VN",
      value: 10_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 2);
    assert.equal(result!.components[0].type, "base");
    assert.equal(result!.components[1].type, "section232");
    assert.equal(result!.components[1].ratePercent, 0.5);
    assert.equal(result!.components[1].amount, 5000);
    assert.equal(result!.totalRatePercent, 0.5);
    assert.equal(result!.totalAmount, 5000);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("Section 232") && line.includes("stacks additively")));
    assert.ok(result!.stackingExplanation.some((line) => line.includes("90 FR 24199")));
  } finally {
    restore();
  }
});

test("a basic steel article from the United Kingdom stacks Section 232 at 25%, not 50%", async () => {
  const restore = stubFetch([{ htsno: "7208.10.15.00", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "7208.10.15.00",
      countryOfOrigin: "GB",
      value: 10_000,
    });
    assert.ok(result);
    const section232 = result!.components.find((c) => c.type === "section232");
    assert.ok(section232);
    assert.equal(section232!.ratePercent, 0.25);
    assert.equal(section232!.amount, 2500);
    assert.equal(result!.totalRatePercent, 0.25);
  } finally {
    restore();
  }
});

test("a China-origin basic steel article stacks BOTH Section 301 and Section 232 additively", async () => {
  const restore = stubFetch([
    { htsno: "7208.10.15.00", general: "Free", additionalDuties: "See 9903.88.03" },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "7208.10.15.00",
      countryOfOrigin: "CN",
      value: 10_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 3, "base + section301 + section232");
    const types = result!.components.map((c) => c.type).sort();
    assert.deepEqual(types, ["base", "section232", "section301"]);
    // 0% base + 25% section301 + 50% section232 = 75%
    assert.equal(result!.totalRatePercent, 0.75);
    assert.equal(result!.totalAmount, 7500);
  } finally {
    restore();
  }
});

test("a non-steel/aluminum HTS code never picks up a Section 232 component", async () => {
  const restore = stubFetch([{ htsno: "6109.10.00.04", general: "16.5%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "6109.10.00.04",
      countryOfOrigin: "VN",
      value: 1_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 1);
    assert.equal(result!.components[0].type, "base");
  } finally {
    restore();
  }
});

test("a China-origin solar cell HTS code surfaces an AD/CVD advisory, never a computed duty component", async () => {
  const restore = stubFetch([{ htsno: "8541.42.00.10", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8541.42.00.10",
      countryOfOrigin: "CN",
      value: 10_000,
    });
    assert.ok(result);
    // AD/CVD never becomes a stacked component — only an advisory, and the total is unaffected by it.
    assert.ok(result!.components.every((c) => c.type !== ("ad_cvd" as never)));
    assert.equal(result!.adCvdAdvisories.length, 1);
    assert.equal(result!.adCvdAdvisories[0].caseNumbers[0], "A-570-979");
    assert.ok(result!.stackingExplanation.some((line) => line.includes("AD/CVD lead") && line.includes("access.trade.gov")));
  } finally {
    restore();
  }
});

test("the same solar cell HTS code from a non-China origin surfaces no AD/CVD advisory", async () => {
  const restore = stubFetch([{ htsno: "8541.42.00.10", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8541.42.00.10",
      countryOfOrigin: "VN",
      value: 10_000,
    });
    assert.ok(result);
    assert.deepEqual(result!.adCvdAdvisories, []);
  } finally {
    restore();
  }
});

test("no import date given produces an explicit caveat that today's rate was used", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "VN",
      value: 1_000,
    });
    assert.ok(result);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("No import date was given")));
  } finally {
    restore();
  }
});

test("a malformed import date is ignored with an explicit caveat, not silently accepted", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "VN",
      value: 1_000,
      importDate: "not-a-date",
    });
    assert.ok(result);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("not a usable ISO date")));
  } finally {
    restore();
  }
});

test("an import date before a Section 301 measure's effective date withholds that measure from the total", async () => {
  const restore = stubFetch([
    { htsno: "8544.42.90.00", general: "2.6%", additionalDuties: "See 9903.88.03" },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8544.42.90.00",
      countryOfOrigin: "CN",
      value: 10_000,
      importDate: "2019-01-01", // before 9903.88.03's 2019-05-10 effective date
    });
    assert.ok(result);
    assert.equal(result!.components.length, 1, "the pre-effective-date measure must not stack");
    assert.equal(result!.components[0].type, "base");
    assert.ok(
      result!.stackingExplanation.some((line) => line.includes("did not take effect until") && line.includes("2019-05-10")),
    );
  } finally {
    restore();
  }
});

test("an import date on or after a Section 301 measure's effective date still stacks it normally", async () => {
  const restore = stubFetch([
    { htsno: "8544.42.90.00", general: "2.6%", additionalDuties: "See 9903.88.03" },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8544.42.90.00",
      countryOfOrigin: "CN",
      value: 10_000,
      importDate: "2020-01-01",
    });
    assert.ok(result);
    assert.equal(result!.components.length, 2);
    assert.equal(result!.totalRatePercent, 0.276);
  } finally {
    restore();
  }
});

test("Mexico or Canada origin without a verified decision uses general and records why", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
    });
    assert.ok(result);
    assert.equal(result.components[0].ratePercent, 0.02);
    assert.equal(result.usmcaQualification.status, "not_provided");
    assert.equal(result.usmcaQualification.specialRateRequested, false);
    assert.ok(result.stackingExplanation.some((line) => line.includes("USMCA") && line.includes("Mexico")));
  } finally {
    restore();
  }
});

test("programme S alone is ignored without an explicit verified USMCA decision", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
      claimedProgramme: "S",
    });
    assert.ok(result);
    assert.equal(result.components[0].ratePercent, 0.02);
    assert.equal(result.components[0].amount, 20);
    assert.ok(result.stackingExplanation.some((line) => line.includes("Programme S was present")));
  } finally {
    restore();
  }
});

test("programme S+ alone is also ignored without an explicit verified USMCA decision", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S+)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
      claimedProgramme: "S+",
    });
    assert.ok(result);
    assert.equal(result.components[0].amount, 20);
    assert.equal(result.usmcaQualification.specialRateRequested, false);
    assert.ok(result.stackingExplanation.some((line) => line.includes("Programme S+ was present")));
  } finally {
    restore();
  }
});

test("verified qualifying USMCA decision with details requests the published S rate", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "CA",
      value: 1_000,
      usmcaQualification: {
        verified: true,
        decision: "qualifies",
        details: "Signed certification dated 2026-09-30; product-specific rule reviewed.",
      },
    });
    assert.ok(result);
    assert.equal(result.components[0].ratePercent, 0);
    assert.equal(result.components[0].amount, 0);
    assert.equal(result.usmcaQualification.status, "verified");
    assert.equal(result.usmcaQualification.specialRateRequested, true);
    assert.match(result.usmcaQualification.explanation, /Signed certification/);
  } finally {
    restore();
  }
});

test("verified qualifying decision can request the USMCA S+ symbol when the caller supplies it", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S+)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "CA",
      value: 1_000,
      claimedProgramme: "S+",
      usmcaQualification: {
        verified: true,
        decision: "qualifies",
        details: "Verified automotive appendix qualification.",
      },
    });
    assert.ok(result);
    assert.equal(result.components[0].amount, 0);
    assert.equal(result.usmcaQualification.specialRateRequested, true);
  } finally {
    restore();
  }
});

test("verified USMCA decision without supporting details stays on general", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "CA",
      value: 1_000,
      usmcaQualification: { verified: true, decision: "qualifies", details: "  " },
    });
    assert.ok(result);
    assert.equal(result.components[0].ratePercent, 0.02);
    assert.equal(result.usmcaQualification.status, "incomplete");
    assert.equal(result.usmcaQualification.specialRateRequested, false);
  } finally {
    restore();
  }
});

test("verified USMCA non-qualifying decision keeps general and preserves the audit basis", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
      usmcaQualification: {
        verified: true,
        decision: "does_not_qualify",
        details: "Product-specific tariff shift failed.",
      },
    });
    assert.ok(result);
    assert.equal(result.components[0].amount, 20);
    assert.equal(result.usmcaQualification.status, "verified");
    assert.equal(result.usmcaQualification.specialRateRequested, false);
    assert.match(result.usmcaQualification.explanation, /tariff shift failed/);
  } finally {
    restore();
  }
});

test("a listed derivative without steel content value is unresolved and withholds both totals", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8450.11.00.90",
      countryOfOrigin: "VN",
      value: 10_000,
      importDate: "2025-06-23",
    });
    assert.ok(result);
    assert.equal(result.components.length, 2);
    assert.equal(result.components[1].contentRatePercent, 0.5);
    assert.equal(result.components[1].ratePercent, null);
    assert.equal(result.components[1].amount, null);
    assert.equal(result.unresolvedMeasures.length, 1);
    assert.equal(result.totalRatePercent, null);
    assert.equal(result.totalAmount, null);
  } finally {
    restore();
  }
});

test("a listed derivative computes dollars from steel content without inventing a shipment percentage", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8450.11.00.90",
      countryOfOrigin: "VN",
      value: 10_000,
      steelContentValue: 3_000,
      importDate: "2025-06-23",
    });
    assert.ok(result);
    const derivative = result.components[1];
    assert.equal(derivative.ratePercent, null);
    assert.equal(derivative.contentRatePercent, 0.5);
    assert.equal(derivative.contentValue, 3_000);
    assert.equal(derivative.amount, 1_500);
    assert.equal(result.totalRatePercent, null);
    assert.equal(result.totalAmount, 2_000);
    assert.deepEqual(result.unresolvedMeasures, []);
  } finally {
    restore();
  }
});

test("welded wire rack computes separate steel and aluminum content duties", async () => {
  const restore = stubFetch([{ htsno: "9403.99.9020", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "9403.99.9020",
      countryOfOrigin: "VN",
      value: 10_000,
      steelContentValue: 2_000,
      aluminumContentValue: 1_000,
      importDate: "2025-06-23",
    });
    assert.ok(result);
    assert.equal(result.components.length, 3);
    assert.deepEqual(result.components.slice(1).map((component) => component.amount), [1_000, 500]);
    assert.equal(result.totalRatePercent, null);
    assert.equal(result.totalAmount, 1_500);
  } finally {
    restore();
  }
});

test("wire-rack aluminum content uses the 25% rate before the June 4 increase", async () => {
  const restore = stubFetch([{ htsno: "9403.99.9020", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "9403.99.9020",
      countryOfOrigin: "VN",
      value: 10_000,
      aluminumContentValue: 1_000,
      importDate: "2025-04-01",
    });
    assert.ok(result);
    assert.equal(result.components.length, 2, "steel tranche was not effective; base plus aluminum remain");
    assert.equal(result.components[1].contentRatePercent, 0.25);
    assert.equal(result.components[1].amount, 250);
    assert.equal(result.totalAmount, 250);
    assert.deepEqual(result.unresolvedMeasures, []);
  } finally {
    restore();
  }
});

test("derivative totals are withheld without an import date or after the 2026 regime change", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    for (const importDate of [null, "2026-04-06"]) {
      const result = await computeStackedDuty({
        htsCode: "8450.11.00.90",
        countryOfOrigin: "VN",
        value: 10_000,
        steelContentValue: 3_000,
        importDate,
      });
      assert.ok(result);
      assert.equal(result.totalRatePercent, null);
      assert.equal(result.totalAmount, null);
      assert.ok(result.unresolvedMeasures.some((measure) => measure.includes("entry-date Section 232 treatment")));
      assert.match(result.components[1].explanation, /2026|import date/i);
    }
  } finally {
    restore();
  }
});

test("Russian-origin aluminum derivatives are withheld instead of receiving the ordinary rate", async () => {
  const restore = stubFetch([{ htsno: "9403.99.9020", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "9403.99.9020",
      countryOfOrigin: "RU",
      value: 10_000,
      steelContentValue: 2_000,
      aluminumContentValue: 1_000,
      importDate: "2025-07-01",
    });
    assert.ok(result);
    assert.equal(result.totalAmount, null);
    assert.ok(result.unresolvedMeasures.some((measure) => measure.includes("Russian aluminum")));
    assert.ok(result.components.some((component) => /200%/.test(component.explanation)));
  } finally {
    restore();
  }
});

test("the June derivative measure is not applied before its effective date", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8450.11.00.90",
      countryOfOrigin: "VN",
      value: 10_000,
      steelContentValue: 3_000,
      importDate: "2025-06-22",
    });
    assert.ok(result);
    assert.equal(result.components.length, 1);
    assert.equal(result.totalRatePercent, 0.05);
    assert.equal(result.totalAmount, 500);
    assert.ok(result.stackingExplanation.some((line) => line.includes("did not take effect until 2025-06-23")));
  } finally {
    restore();
  }
});

test("an impossible ISO-shaped date is rejected by the shared strict validator", async () => {
  const restore = stubFetch([{ htsno: "8450.11.00.90", general: "5%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8450.11.00.90",
      countryOfOrigin: "VN",
      value: 10_000,
      steelContentValue: 3_000,
      importDate: "2025-02-29",
    });
    assert.ok(result);
    assert.ok(result.stackingExplanation.some((line) => line.includes("not a usable ISO date")));
    assert.equal(result.components[1].amount, null, "invalid date must not select a historical legal regime");
    assert.equal(result.totalAmount, null);
    assert.ok(result.unresolvedMeasures.some((measure) => measure.includes("entry-date Section 232 treatment")));
  } finally {
    restore();
  }
});

// --- Comprehensive USITC China Tariffs snapshot fallback ---

test("China-origin athletic footwear (6404.11) with an empty additionalDuties row still picks up the verified List 4A snapshot", async () => {
  const restore = stubFetch([{ htsno: "6404.11.90.20", general: "20%", additionalDuties: null }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "6404.11.90.20",
      countryOfOrigin: "CN",
      value: 150_000,
    });
    assert.ok(result);
    assert.equal(result.components.length, 2);
    assert.equal(result.components[0].ratePercent, 0.2);
    assert.equal(result.components[1].type, "section301");
    assert.equal(result.components[1].ratePercent, 0.075);
    assert.equal(result.components[1].amount, 11_250);
    assert.equal(result.totalRatePercent, 0.275);
    assert.equal(result.totalAmount, 41_250);
    assert.ok(result.components[1].citation.some((c) => c.includes("USITC China Tariffs")));
    assert.ok(result.stackingExplanation.some((line) => line.includes("USITC China Tariffs")));
  } finally {
    restore();
  }
});

test("China-origin speakers (8518.22) with an empty additionalDuties row still picks up the verified List 4A snapshot", async () => {
  const restore = stubFetch([{ htsno: "8518.22.00.00", general: "Free", additionalDuties: null }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "8518.22.00.00",
      countryOfOrigin: "CN",
      value: 50_000,
    });
    assert.ok(result);
    assert.equal(result.components.length, 2);
    assert.equal(result.components[0].amount, 0);
    assert.equal(result.components[1].type, "section301");
    assert.equal(result.components[1].ratePercent, 0.075);
    assert.equal(result.components[1].amount, 3_750);
    assert.equal(result.totalRatePercent, 0.075);
    assert.equal(result.totalAmount, 3_750);
  } finally {
    restore();
  }
});

test("the snapshot table is never consulted when the HTS row already has its own Chapter 99 text", async () => {
  const restore = stubFetch([
    { htsno: "6404.11.90.20", general: "20%", additionalDuties: "See 9903.88.03" },
  ]);
  try {
    const result = await computeStackedDuty({
      htsCode: "6404.11.90.20",
      countryOfOrigin: "CN",
      value: 150_000,
    });
    assert.ok(result);
    // Should resolve via the row's own cross-reference (List 3, 25%), not the snapshot (List 4A, 7.5%).
    assert.equal(result.components[1].ratePercent, 0.25);
    assert.ok(!result.components[1].label.includes("snapshot"));
  } finally {
    restore();
  }
});

test("the snapshot table does not apply to a non-China origin", async () => {
  const restore = stubFetch([{ htsno: "6404.11.90.20", general: "20%", additionalDuties: null }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "6404.11.90.20",
      countryOfOrigin: "VN",
      value: 150_000,
    });
    assert.ok(result);
    assert.equal(result.components.length, 1);
  } finally {
    restore();
  }
});

// --- Section 338 Canada duties (new Aug 22, 2026) ---

test("Canada-origin whisky (2208.30) gets the verified 50% Section 338 alcohol duty", async () => {
  const restore = stubFetch([{ htsno: "2208.30.60.85", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "2208.30.60.85",
      countryOfOrigin: "CA",
      value: 20_000,
      importDate: "2026-09-01",
    });
    assert.ok(result);
    const s338 = result.components.find((c) => c.type === "section338");
    assert.ok(s338);
    assert.equal(s338!.ratePercent, 0.5);
    assert.equal(s338!.amount, 10_000);
    assert.ok(s338!.citation.some((c) => c.includes("2026-14991")));
    assert.ok(result.stackingExplanation.some((line) => line.includes("19 U.S.C. 1338")));
  } finally {
    restore();
  }
});

test("Canada-origin dairy (0402.10) gets the verified 50% Section 338 dairy duty", async () => {
  const restore = stubFetch([{ htsno: "0402.10.05.00", general: "10%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0402.10.05.00",
      countryOfOrigin: "CA",
      value: 8_000,
      importDate: "2026-09-01",
    });
    assert.ok(result);
    const s338 = result.components.find((c) => c.type === "section338");
    assert.ok(s338);
    assert.equal(s338!.ratePercent, 0.5);
    assert.equal(s338!.amount, 4_000);
  } finally {
    restore();
  }
});

test("Section 338 is not applied before its verified first-collection date of 2026-08-22", async () => {
  const restore = stubFetch([{ htsno: "2208.30.60.85", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "2208.30.60.85",
      countryOfOrigin: "CA",
      value: 20_000,
      importDate: "2026-08-01",
    });
    assert.ok(result);
    const s338 = result.components.find((c) => c.type === "section338");
    assert.ok(s338);
    assert.equal(s338!.amount, null);
    assert.ok(result.unresolvedMeasures.some((m) => m.includes("before Section 338 effective date")));
    assert.equal(result.totalAmount, null);
  } finally {
    restore();
  }
});

test("Section 338 does not apply to a non-Canada origin even on a listed HTS code", async () => {
  const restore = stubFetch([{ htsno: "2208.30.60.85", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "2208.30.60.85",
      countryOfOrigin: "FR",
      value: 20_000,
      importDate: "2026-09-01",
    });
    assert.ok(result);
    assert.ok(!result.components.some((c) => c.type === "section338"));
  } finally {
    restore();
  }
});

test("Section 338 is skipped when a Section 232 basic-article measure already matched the same code", async () => {
  // A hypothetical Canada-origin steel code that also happens to be covered
  // by this calculator's own Section 232 basic-article table (7208 is on
  // the verified steel list) — Section 232 should win; Section 338 must not
  // double-stack on top of it, mirroring each proclamation's own carve-out.
  const restore = stubFetch([{ htsno: "7208.10.15.00", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "7208.10.15.00",
      countryOfOrigin: "CA",
      value: 10_000,
      importDate: "2026-09-01",
    });
    assert.ok(result);
    assert.ok(result.components.some((c) => c.type === "section232"));
    assert.ok(!result.components.some((c) => c.type === "section338"));
  } finally {
    restore();
  }
});

// --- Section 338 import-ban conversion (Sept 29, 2026) ---

test("Section 338 is withheld as unresolved, not a confident 50%, for goods imported on the Sept 29, 2026 ban-conversion date", async () => {
  // Uses 2203.00.00 (beer/wine), a verified alcohol Annex II line
  // unaffected by the Sept 15, 2026 amendment's removal of 2208.30.60/
  // 2208.70.00 — see TARIFF_AUDIT.md and section338.ts for why those two
  // specific lines are unresolved on/after Sept 15, independent of the
  // Sept 29 ban-conversion date this test targets.
  const restore = stubFetch([{ htsno: "2203.00.00.00", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "2203.00.00.00",
      countryOfOrigin: "CA",
      value: 20_000,
      importDate: "2026-09-29",
    });
    assert.ok(result);
    const s338 = result.components.find((c) => c.type === "section338");
    assert.ok(s338);
    assert.equal(s338!.ratePercent, null);
    assert.equal(s338!.amount, null);
    assert.ok(result.unresolvedMeasures.some((m) => m.includes("ban-conversion date")));
    assert.equal(result.totalAmount, null);
    assert.equal(result.totalRatePercent, null);
    assert.ok(s338!.citation.some((c) => c.includes("2026-18835")));
    assert.ok(result.stackingExplanation.some((line) => line.includes("import ban") && line.includes("9903.03.12")));
  } finally {
    restore();
  }
});

test("Section 338 still resolves confidently at 50% for an import date just before the ban-conversion date", async () => {
  const restore = stubFetch([{ htsno: "2203.00.00.00", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "2203.00.00.00",
      countryOfOrigin: "CA",
      value: 20_000,
      importDate: "2026-09-28",
    });
    assert.ok(result);
    const s338 = result.components.find((c) => c.type === "section338");
    assert.ok(s338);
    assert.equal(s338!.ratePercent, 0.5);
    assert.equal(s338!.amount, 10_000);
  } finally {
    restore();
  }
});

test("Section 338 ban-conversion unresolved state correctly cites the dairy basket's own ban proclamation (11062), not the alcohol one", async () => {
  const restore = stubFetch([{ htsno: "0402.10.05.00", general: "10%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0402.10.05.00",
      countryOfOrigin: "CA",
      value: 8_000,
      importDate: "2026-10-01",
    });
    assert.ok(result);
    const s338 = result.components.find((c) => c.type === "section338");
    assert.ok(s338);
    assert.ok(s338!.citation.some((c) => c.includes("2026-18836")));
    assert.ok(!s338!.citation.some((c) => c.includes("2026-18835")));
  } finally {
    restore();
  }
});
