import assert from "node:assert/strict";
import test from "node:test";
import {
  TariffLookupError,
  compareDuty,
  lookupTariff,
  quoteDuty,
  resetTariffCacheForTests,
} from "./rates";

/**
 * lib/tariff/rates.ts talks to the live USITC HTS endpoint, which this test
 * file never calls — real network I/O in a unit test is slow and flaky, and
 * this module had zero coverage despite being the only source of duty
 * figures for every US assessment in lib/impact/assess.ts. Instead we stub
 * `global.fetch` per test and restore it afterwards, so the parsing,
 * caching and programme-eligibility logic here is verified deterministically.
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

test("lookupTariff picks the most specific overlapping row and parses its rates", async () => {
  const restore = stubFetch([
    { htsno: "6306.12", description: "Heading level", general: "8.8%", special: "Free (S)", other: "40%" },
    {
      htsno: "6306.12.00.00",
      description: "Tarpaulins, of synthetic fibers",
      units: ["kg", "no."],
      general: "8.8%",
      special: "Free (AU,S)",
      other: "40%",
      additionalDuties: "9903.88.15",
    },
  ]);
  try {
    const row = await lookupTariff("6306.12.00.00", { now: 1_000 });
    assert.ok(row);
    assert.equal(row!.htsCode, "6306.12.00.00");
    assert.equal(row!.description, "Tarpaulins, of synthetic fibers");
    assert.deepEqual(row!.specialProgrammes, ["AU", "S"]);
    assert.equal(row!.general.adValorem, 0.088);
    assert.equal(row!.additionalDuties, "9903.88.15");
  } finally {
    restore();
  }
});

test("lookupTariff returns null (not a throw) when nothing overlaps the code", async () => {
  const restore = stubFetch([{ htsno: "9999.99.99.99", description: "Unrelated", general: "Free" }]);
  try {
    const row = await lookupTariff("6306.12.00.00", { now: 1_000 });
    assert.equal(row, null);
  } finally {
    restore();
  }
});

test("lookupTariff prefers a more-specific row that carries a rate over an emptier, more-specific statistical-breakdown child", async () => {
  // Real USITC shape (confirmed live against 8501.10.40/.20): a legal tariff
  // line like 8501.10.40 carries the actual rate, while its own statistical-
  // suffix children (splitting it by AC/DC/brushless, say) are non-dutiable
  // breakdown rows that publish empty general/special/other by design — the
  // real rate is inherited from the parent, never re-stated on the leaf.
  // Blindly taking the longest/most-specific match used to pick the empty
  // leaf and silently report "no duty rate was published for this row" for
  // a code that genuinely has a published 4.4% rate.
  const restore = stubFetch([
    { htsno: "8501.10.40", description: "Other", general: "4.4%", special: "Free (A,AU,B)", other: "35%" },
    { htsno: "8501.10.40.20", description: "AC", general: "", special: "", other: "" },
  ]);
  try {
    const row = await lookupTariff("8501.10.40.20", { now: 1_000 });
    assert.ok(row);
    // Reports the parent row that actually carries the rate — the leaf
    // breakdown row's own code is a non-dutiable statistical split, not a
    // separate legal rate, so promoting its htsCode too would misrepresent
    // which published line the figure actually comes from.
    assert.equal(row!.htsCode, "8501.10.40.20");
    assert.equal(row!.inheritedFromHtsCode, "8501.10.40");
    assert.equal(row!.general.adValorem, 0.044);
    assert.equal(row!.general.parsed, true);
  } finally {
    restore();
  }
});

test("lookupTariff still returns the bare most-specific match, with its honest empty rate, when nothing in the overlap set has a rate", async () => {
  // The genuine "no rate published" case (e.g. querying a heading-only row)
  // must not be masked by the fix above — only promote a parent's rate when
  // SOME candidate in the set actually has one.
  const restore = stubFetch([
    { htsno: "8501.10", description: "Heading, no rate published at this level", general: "", special: "", other: "" },
  ]);
  try {
    const row = await lookupTariff("8501.10", { now: 1_000 });
    assert.ok(row);
    assert.equal(row!.general.parsed, false);
    assert.equal(row!.general.note, "No duty rate was published for this row.");
  } finally {
    restore();
  }
});

test("lookupTariff caches a hit and a miss, so a second call skips fetch entirely", async () => {
  let calls = 0;
  const original = global.fetch;
  global.fetch = (async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => [{ htsno: "6306.12.00.00", general: "Free" }] };
  }) as unknown as typeof global.fetch;
  try {
    const first = await lookupTariff("6306.12.00.00", { now: 1_000 });
    const second = await lookupTariff("6306.12.00.00", { now: 1_000 + 60_000 });
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
  } finally {
    global.fetch = original;
  }
});

test("lookupTariff raises TariffLookupError on a non-OK response instead of returning a fake row", async () => {
  const restore = stubFetch([], 500);
  try {
    await assert.rejects(() => lookupTariff("6306.12.00.00", { now: 1_000 }), TariffLookupError);
  } finally {
    restore();
  }
});

test("lookupTariff rejects a code with no digits before ever calling fetch", async () => {
  await assert.rejects(() => lookupTariff("not-a-code"), TariffLookupError);
});

test("quoteDuty defaults to the general column and flags that no FTA was claimed", async () => {
  const restore = stubFetch([
    { htsno: "6306.12.00.00", general: "8.8%", special: "Free (S)", other: "40%" },
  ]);
  try {
    const quote = await quoteDuty({ htsCode: "6306.12.00.00", value: 1000 });
    assert.ok(quote);
    assert.equal(quote!.column, "general");
    assert.equal(quote!.computation.amount, 88);
    assert.match(quote!.caveats[0], /FTA preference was not claimed/);
  } finally {
    restore();
  }
});

test("quoteDuty applies the special rate only for a claimed programme this row actually lists", async () => {
  const restore = stubFetch([
    { htsno: "6306.12.00.00", general: "8.8%", special: "Free (S)", other: "40%" },
  ]);
  try {
    const eligible = await quoteDuty({
      htsCode: "6306.12.00.00",
      value: 1000,
      claimedProgramme: "s",
    });
    assert.equal(eligible!.column, "special");
    assert.equal(eligible!.computation.amount, 0);
    assert.match(eligible!.caveats[0], /has NOT verified/);

    resetTariffCacheForTests();
    const ineligible = await quoteDuty({
      htsCode: "6306.12.00.00",
      value: 1000,
      claimedProgramme: "P",
    });
    assert.equal(ineligible!.column, "general");
    assert.match(ineligible!.caveats[0], /not listed among this row's special programmes/);
  } finally {
    restore();
  }
});

test("compareDuty reports the expected-minus-declared difference with both bases explained", async () => {
  const original = global.fetch;
  global.fetch = (async (url: string | URL) => {
    const asked = new URL(url as string).searchParams.get("keyword");
    const rows =
      asked === "6306.12.00.00"
        ? [{ htsno: "6306.12.00.00", general: "8.8%" }]
        : [{ htsno: "6306.19.00.00", general: "10%" }];
    return { ok: true, status: 200, json: async () => rows };
  }) as unknown as typeof global.fetch;
  try {
    const delta = await compareDuty({
      declaredCode: "6306.12.00.00",
      expectedCode: "6306.19.00.00",
      value: 1000,
    });
    assert.equal(delta.difference, 12); // (10% - 8.8%) * 1000
    assert.equal(delta.basis.some((line) => line.includes("Declared 6306.12.00.00")), true);
    assert.equal(delta.basis.some((line) => line.includes("Expected 6306.19.00.00")), true);
  } finally {
    global.fetch = original;
  }
});

test("compareDuty reports null difference and says why when a code has no published row", async () => {
  const restore = stubFetch([{ htsno: "6306.12.00.00", general: "8.8%" }]);
  try {
    const delta = await compareDuty({
      declaredCode: "6306.12.00.00",
      expectedCode: "0000.00.00.00",
      value: 1000,
    });
    assert.equal(delta.difference, null);
    assert.equal(delta.basis.some((line) => line.includes("No published HTS row")), true);
  } finally {
    restore();
  }
});

const housingLeaf = { htsno: "8538.90.81.80", indent: "5", general: "", special: "", other: "" };
const housingSubtree = [
  { htsno: "8538.90.81", indent: "3", description: "Other", general: "3.5%", special: "Free (A,AU)", other: "35%" },
  ...["20", "40", "60", "80"].map(suffix => ({ ...housingLeaf, htsno: `8538.90.81.${suffix}`, indent: suffix === "20" ? "4" : "5" })),
  { htsno: "8538.90.82", general: "99%" }, // Never inherit a sibling's rate.
];

for (const ratedPrefix of ["8538.90.81", "8538.90", "8538", null]) {
  test(`housing ancestor retry is bounded and auditable (rated prefix ${ratedPrefix})`, async () => {
    const original = global.fetch;
    const queries: string[] = [];
    global.fetch = (async (url, init) => {
      const keyword = new URL(String(url)).searchParams.get("keyword")!;
      queries.push(keyword);
      assert.ok(init?.signal);
      return new Response(JSON.stringify(keyword === ratedPrefix ? housingSubtree : [housingLeaf]));
    }) as typeof fetch;
    try {
      const row = await lookupTariff("8538.90.8180");
      const quote = await quoteDuty({ htsCode: "8538.90.8180", value: 8000 });
      const prefixes = ["8538.90.8180", "8538.90.81", "8538.90", "8538"];
      assert.deepEqual(queries, ratedPrefix ? prefixes.slice(0, prefixes.indexOf(ratedPrefix) + 1) : prefixes);
      if (ratedPrefix) {
        assert.equal(row?.htsCode, "8538.90.8180");
        assert.equal(row?.inheritedFromHtsCode, "8538.90.81");
        assert.equal(row?.general.adValorem, 0.035);
        assert.equal(quote?.computation.amount, 280);
        assert.ok(quote?.caveats.some(note => /inherited.*8538\.90\.81/.test(note)));
      } else {
        assert.equal(row?.general.parsed, false);
        assert.equal(quote?.computation.amount, null);
        assert.equal(row?.inheritedFromHtsCode, undefined);
      }
    } finally { global.fetch = original; }
  });
}

test("ancestor retry fails closed on network failure and respects cancellation", async () => {
  const original = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    controller.abort();
    return new Response(JSON.stringify([housingLeaf]));
  }) as typeof fetch;
  try {
    await assert.rejects(lookupTariff("8538.90.8180", { signal: controller.signal }), TariffLookupError);
    assert.equal(calls, 1);
    global.fetch = (async () => { throw new Error("private network detail"); }) as typeof fetch;
    await assert.rejects(lookupTariff("8538.90.8180"), { message: "Could not reach the USITC HTS service." });
  } finally { global.fetch = original; }
});

test("housing inherited rate flows through business impact with published List 1 coverage", async () => {
  const { evaluateBusinessImpact, parseBusinessImpact } = await import("./business-impact");
  const original = global.fetch;
  global.fetch = (async (url) => new Response(JSON.stringify(
    new URL(String(url)).searchParams.get("keyword") === "8538.90.8180" ? [housingLeaf] : housingSubtree,
  ))) as typeof fetch;
  try {
    const [row] = await evaluateBusinessImpact(parseBusinessImpact(
      "sku,hts,origin,supplier,annual_import_value_usd,current_duty_rate,evaluation_date\nHOUSING,8538.90.8180,CN,Connector supplier,8000,3.5,2026-10-01",
    ));
    assert.equal(row.status, "unresolved");
    assert.equal(row.computed_annual_duty_usd, null);
    assert.equal(row.annual_delta_usd, null);
    assert.ok(row.stack_result!.unresolvedMeasures.length > 0);
    assert.equal(row.stack_result?.components.find(c => c.type === "section301")?.ratePercent, 0.25);
    assert.ok(row.stack_result?.components.some(c => /inherited.*8538\.90\.81/.test(c.explanation)));
  } finally { global.fetch = original; }
});

test("an unpublished full statistical code cannot borrow a real ancestor's rate", async () => {
  const restore = stubFetch([{ htsno: "8501.10.40", general: "4.4%" }]);
  try { assert.equal(await lookupTariff("8501.10.40.99"), null); }
  finally { restore(); }
});
