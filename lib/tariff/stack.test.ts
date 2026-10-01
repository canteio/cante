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

test("a China row with no Chapter 99 cross-reference reports no Section 301 applies", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "Free" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "CN",
      value: 5_000,
    });
    assert.ok(result);
    assert.equal(result!.components.length, 1);
    assert.equal(result!.totalRatePercent, 0);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("no Chapter 99 cross-reference")));
  } finally {
    restore();
  }
});

test("a suspended measure (List 4B) is explained but excluded from the total, never guessed", async () => {
  const restore = stubFetch([
    { htsno: "6109.10.00.00", general: "16.5%", additionalDuties: "9903.88.04" },
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

test("Mexico or Canada origin with no claimed programme gets an explicit USMCA qualification caveat", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
    });
    assert.ok(result);
    assert.ok(result!.stackingExplanation.some((line) => line.includes("USMCA") && line.includes("Mexico")));
  } finally {
    restore();
  }
});

test("Mexico origin WITH a claimed programme does not repeat the USMCA qualification caveat", async () => {
  const restore = stubFetch([{ htsno: "0101.21.00.10", general: "2%", special: "Free (S)" }]);
  try {
    const result = await computeStackedDuty({
      htsCode: "0101.21.00.10",
      countryOfOrigin: "MX",
      value: 1_000,
      claimedProgramme: "S",
    });
    assert.ok(result);
    assert.ok(!result!.stackingExplanation.some((line) => line.includes("Run the goods through the USMCA")));
  } finally {
    restore();
  }
});
