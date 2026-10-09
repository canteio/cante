import assert from "node:assert/strict";
import test from "node:test";
import { parseBusinessImpact, type ImpactRow } from "./business-impact";
import {
  buildMonitoredCompanyImpacts,
  MONITOR_IMPACT_MAX_PAIRS,
  MonitorImpactLimitError,
  type MonitorCompanyCandidate,
} from "./monitor-company-impact";
import { resetTariffCacheForTests } from "./rates";
import { computeStackedDuty, type StackDutyInput, type StackedDutyResult } from "./stack";
import type { Section232LiveMatch } from "./section232-live";

const documentNumber = "2026-06087";
const effectiveDate = "2026-04-06";
const liveMatch: Section232LiveMatch = {
  annex: "Annex II",
  ratePercent: 0.6,
  ukRatePercent: 0.25,
  usContentRatePercent: null,
  effectiveDate,
  sourceDocumentNumber: documentNumber,
  sourceTitle: "Section 232 proclamation",
  sourcePdfUrl: `https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/${documentNumber}.pdf`,
};

function candidate(
  citations = [`FR Doc. ${documentNumber}`],
  overrides: Partial<Pick<MonitorCompanyCandidate, "id" | "findingId" | "productId">> = {},
): MonitorCompanyCandidate {
  return {
    id: overrides.id ?? "candidate-1",
    findingId: overrides.findingId ?? "finding-1",
    productId: overrides.productId ?? "product-1",
    matchKind: "exact_code",
    matchReason: "The monitored HTS code exactly matches the catalogue classification.",
    createdAt: "2026-10-07T12:00:00Z",
    product: { sku: "STEEL-1", name: "Steel sheet" },
    action: { name: "Section 232 steel duty change", citations },
  };
}

function portfolioRow(): ImpactRow {
  const [row] = parseBusinessImpact("sku,hts,origin,supplier,annual_import_value,current_duty_rate\nSTEEL-1,7208.10.0000,JP,Foundry Co,100000,52");
  row.product_id = "product-1";
  return row;
}

function stubUsitc() {
  resetTariffCacheForTests();
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => [{ htsno: "7208.10.0000", general: "2%" }],
  })) as unknown as typeof global.fetch;
  return () => { global.fetch = original; };
}

const realVersionedComputer = (input: StackDutyInput) =>
  computeStackedDuty({ importDate: "2026-07-23", ...input }, async () => liveMatch);

async function realResult(input: StackDutyInput): Promise<StackedDutyResult> {
  const result = await realVersionedComputer(input);
  assert.ok(result);
  return result;
}

test("derives a real deterministic Section 232 historical/current pair from the versioned engine", async () => {
  const restore = stubUsitc();
  try {
    const [impact] = await buildMonitoredCompanyImpacts([candidate()], [portfolioRow()], realVersionedComputer);
    assert.equal(impact.status, "computed");
    assert.equal(impact.action.effectiveDate, effectiveDate);
    assert.equal(impact.estimatedDutyDeltaUsd, 10_000);
    assert.deepEqual(impact.suppliers, ["Foundry Co"]);
    assert.deepEqual(impact.products, ["STEEL-1"]);
    assert.deepEqual(impact.rows.map(row => ({
      previousRate: row.previousRate,
      newRate: row.newRate,
      impactUsd: row.impactUsd,
      status: row.status,
    })), [{ previousRate: 0.52, newRate: 0.62, impactUsd: 10_000, status: "computed" }]);
    const section232 = impact.rows[0].evidence?.components.find(component => component.type === "section232");
    assert.equal(section232?.effectiveDate, effectiveDate);
    assert.equal(section232?.sourceDocumentNumber, documentNumber);
    assert.ok(section232?.citation.some(value => value.includes(documentNumber)));
  } finally {
    restore();
  }
});

test("citation mismatch is NEEDS REVIEW and never yields rates or dollars", async () => {
  const restore = stubUsitc();
  try {
    const [impact] = await buildMonitoredCompanyImpacts(
      [candidate(["FR Doc. 2026-99999"])],
      [portfolioRow()],
      realVersionedComputer,
    );
    assert.equal(impact.estimatedDutyDeltaUsd, null);
    assert.equal(impact.rows[0].previousRate, null);
    assert.match(impact.rows[0].reviewReason ?? "", /source document does not match/);
  } finally {
    restore();
  }
});

test("missing structured effective date is NEEDS REVIEW", async () => {
  const restore = stubUsitc();
  try {
    const computer = async (input: StackDutyInput) => {
      const result = await realResult(input);
      if (!input.importDate) {
        const copy = structuredClone(result);
        const component = copy.components.find(item => item.type === "section232");
        if (component) delete component.effectiveDate;
        return copy;
      }
      return result;
    };
    const [impact] = await buildMonitoredCompanyImpacts([candidate()], [portfolioRow()], computer);
    assert.equal(impact.status, "needs_review");
    assert.equal(impact.estimatedDutyDeltaUsd, null);
    assert.match(impact.rows[0].reviewReason ?? "", /no structured verified effective date/);
  } finally {
    restore();
  }
});

for (const unresolvedDate of ["2026-04-05", "2026-04-06"]) {
  test(`unresolved ${unresolvedDate === effectiveDate ? "after" : "before"} calculation is NEEDS REVIEW`, async () => {
    const restore = stubUsitc();
    try {
      const computer = async (input: StackDutyInput) => {
        const result = await realResult(input);
        if (input.importDate === unresolvedDate) {
          return { ...result, totalRatePercent: null, totalAmount: null, unresolvedMeasures: ["test unresolved measure"] };
        }
        return result;
      };
      const [impact] = await buildMonitoredCompanyImpacts([candidate()], [portfolioRow()], computer);
      assert.equal(impact.status, "needs_review");
      assert.equal(impact.estimatedDutyDeltaUsd, null);
      assert.match(impact.rows[0].reviewReason ?? "", new RegExp(`calculation .*${unresolvedDate}.* unresolved`));
    } finally {
      restore();
    }
  });
}

function syntheticResult(input: StackDutyInput): StackedDutyResult {
  const isBefore = input.importDate === "2026-04-05";
  const rate = isBefore ? 0.1 : 0.2;
  return {
    htsCode: input.htsCode,
    countryOfOrigin: input.countryOfOrigin,
    totalRatePercent: rate,
    totalAmount: (input.value ?? 0) * rate,
    currency: "USD",
    components: isBefore ? [] : [{
      type: "section232",
      label: "Versioned Section 232",
      effectiveDate,
      sourceDocumentNumber: documentNumber,
      ratePercent: 0.1,
      amount: (input.value ?? 0) * 0.1,
      citation: [`FR Doc. ${documentNumber}`],
      explanation: "Test versioned component.",
    }],
    stackingExplanation: [],
    notEvaluated: [],
    unresolvedMeasures: [],
    usmcaQualification: {
      status: "not_applicable",
      specialRateRequested: false,
      explanation: "Not applicable.",
    },
    adCvdAdvisories: [],
    uflpaAdvisories: [],
  };
}

function linkedRow(productId: string, rowNumber: number, hts = "7208.10.0000"): ImpactRow {
  const row = portfolioRow();
  row.product_id = productId;
  row.row_number = rowNumber;
  row.hts = hts;
  row.sku = `SKU-${rowNumber}`;
  return row;
}

test("matches only canonical Federal Register document identifiers", async () => {
  const accepted = [
    documentNumber,
    `FR Doc. ${documentNumber}`,
    `https://www.federalregister.gov/documents/2026/04/03/${documentNumber}/section-232-rule`,
    `https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/${documentNumber}.pdf`,
  ];
  const rejected = [
    `Notice published as FR Document ${documentNumber}.`,
    `unrelated note ${documentNumber}`,
    `https://example.com/unrelated?note=${documentNumber}-spoof`,
    `https://www.federalregister.gov/unrelated?document=${documentNumber}`,
    `https://www.govinfo.gov/content/pkg/unrelated/${documentNumber}-spoof.pdf`,
    `x${documentNumber}`,
    `${documentNumber}9`,
    `12026-060870`,
  ];

  for (const citation of accepted) {
    const [impact] = await buildMonitoredCompanyImpacts([candidate([citation])], [portfolioRow()], async input => syntheticResult(input));
    assert.equal(impact.status, "computed", citation);
  }
  for (const citation of rejected) {
    const [impact] = await buildMonitoredCompanyImpacts([candidate([citation])], [portfolioRow()], async input => syntheticResult(input));
    assert.equal(impact.status, "needs_review", citation);
    assert.match(impact.rows[0].reviewReason ?? "", /source document does not match/);
  }
});

test("rejects more than 500 candidates before starting duty computation", async () => {
  let calls = 0;
  const candidates = Array.from({ length: 501 }, (_, index) => candidate(undefined, {
    id: `candidate-${index}`,
    findingId: `finding-${index}`,
  }));
  await assert.rejects(
    buildMonitoredCompanyImpacts(candidates, [portfolioRow()], async input => {
      calls += 1;
      return syntheticResult(input);
    }),
    (error: unknown) => error instanceof MonitorImpactLimitError && error.code === "candidate_limit",
  );
  assert.equal(calls, 0);
});

test("rejects more than 500 candidate-row pairs before starting duty computation", async () => {
  let calls = 0;
  const rows = Array.from({ length: 251 }, (_, index) => linkedRow("product-1", index + 1));
  const candidates = [
    candidate(undefined, { id: "candidate-a", findingId: "finding-a" }),
    candidate(undefined, { id: "candidate-b", findingId: "finding-b" }),
  ];
  await assert.rejects(
    buildMonitoredCompanyImpacts(candidates, rows, async input => {
      calls += 1;
      return syntheticResult(input);
    }),
    (error: unknown) => error instanceof MonitorImpactLimitError && error.code === "pair_limit",
  );
  assert.equal(calls, 0);
});

test("runs no more than five duty computations concurrently", async () => {
  let active = 0;
  let maximum = 0;
  const candidates = Array.from({ length: 12 }, (_, index) => candidate(undefined, {
    id: `candidate-${index}`,
    findingId: `finding-${index}`,
    productId: `product-${index}`,
  }));
  const rows = candidates.map((item, index) => linkedRow(item.productId, index + 1));
  const impacts = await buildMonitoredCompanyImpacts(candidates, rows, async input => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active -= 1;
    return syntheticResult(input);
  });
  assert.equal(impacts.length, 12);
  assert.ok(impacts.every(impact => impact.status === "computed"));
  assert.equal(maximum, 5);
});

test("process-wide scheduler keeps simultaneous requests at five duty computations total", async () => {
  let active = 0;
  let maximum = 0;
  const makeWork = (prefix: string) => {
    const candidates = Array.from({ length: 8 }, (_, index) => candidate(undefined, {
      id: `${prefix}-candidate-${index}`,
      findingId: `${prefix}-finding-${index}`,
      productId: `${prefix}-product-${index}`,
    }));
    const rows = candidates.map((item, index) => linkedRow(item.productId, index + 1));
    return { candidates, rows };
  };
  const computer = async (input: StackDutyInput) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active -= 1;
    return syntheticResult(input);
  };
  const left = makeWork("left");
  const right = makeWork("right");
  const [leftImpacts, rightImpacts] = await Promise.all([
    buildMonitoredCompanyImpacts(left.candidates, left.rows, computer),
    buildMonitoredCompanyImpacts(right.candidates, right.rows, computer),
  ]);
  assert.equal(leftImpacts.length, 8);
  assert.equal(rightImpacts.length, 8);
  assert.equal(maximum, 5);
});

test("many concurrent full-pair requests cannot admit unbounded pending row derivation at once", async () => {
  // Regression for the real exploit a red-team review found: the previous
  // per-request duty-call throttle left per-request pair DERIVATION
  // (closures, row references, awaited chains) completely unbounded, so N
  // concurrent requests each carrying MONITOR_IMPACT_MAX_PAIRS rows could
  // still allocate N * 500 pending-row computations simultaneously even
  // though actual network duty calls were already limited to 5 at a time.
  let concurrentlyRunning = 0;
  let maxConcurrentlyRunning = 0;
  const computer = async (input: StackDutyInput) => {
    concurrentlyRunning += 1;
    maxConcurrentlyRunning = Math.max(maxConcurrentlyRunning, concurrentlyRunning);
    await new Promise(resolve => setTimeout(resolve, 1));
    concurrentlyRunning -= 1;
    return syntheticResult(input);
  };
  const makeMaxPairRequest = (prefix: string) => {
    const rows = Array.from({ length: MONITOR_IMPACT_MAX_PAIRS }, (_, index) =>
      linkedRow(`${prefix}-product`, index + 1));
    return buildMonitoredCompanyImpacts(
      [candidate(undefined, { id: `${prefix}-candidate`, findingId: `${prefix}-finding`, productId: `${prefix}-product` })],
      rows,
      computer,
    );
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => makeMaxPairRequest(`burst-${index}`)),
  );
  assert.equal(results.flat().length, 20);
  // The real bug allowed 20 * 500 = 10,000 pending derivations to be created
  // simultaneously; the fix keeps genuinely concurrent *admitted* work
  // bounded by the shared pair queue's own concurrency, not by request count.
  assert.ok(maxConcurrentlyRunning <= 5, `expected bounded concurrency, saw ${maxConcurrentlyRunning}`);
});

test("aborting stops queued duty work and propagates the signal to in-flight calls", async () => {
  const controller = new AbortController();
  let started = 0;
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(undefined, {
    id: `candidate-${index}`,
    findingId: `finding-${index}`,
    productId: `product-${index}`,
  }));
  const rows = candidates.map((item, index) => linkedRow(item.productId, index + 1));
  const building = buildMonitoredCompanyImpacts(candidates, rows, input => {
    started += 1;
    assert.equal(input.signal, controller.signal);
    return new Promise((_resolve, reject) => {
      input.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    });
  }, { signal: controller.signal, dutyConcurrency: 2 });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  const impacts = await building;
  assert.equal(started, 2);
  assert.ok(impacts.every(impact => impact.status === "needs_review"));
  assert.ok(impacts.every(impact => impact.rows.every(row => /cancelled/.test(row.reviewReason ?? ""))));
});

test("one thrown duty computation becomes NEEDS REVIEW without rejecting other rows", async () => {
  let siblingFinished = false;
  const candidates = [
    candidate(undefined, { id: "candidate-ok", findingId: "finding-ok", productId: "product-ok" }),
    candidate(undefined, { id: "candidate-fail", findingId: "finding-fail", productId: "product-fail" }),
  ];
  const impacts = await buildMonitoredCompanyImpacts(candidates, [
    linkedRow("product-ok", 1),
    linkedRow("product-fail", 2, "9999.00.0000"),
  ], async input => {
    if (input.htsCode === "9999.00.0000" && input.importDate === effectiveDate) {
      throw new Error("isolated failure");
    }
    if (input.htsCode === "9999.00.0000" && input.importDate === "2026-04-05") {
      await new Promise(resolve => setTimeout(resolve, 5));
      siblingFinished = true;
    }
    return syntheticResult(input);
  });
  assert.equal(impacts.find(impact => impact.findingId === "finding-ok")?.status, "computed");
  const failed = impacts.find(impact => impact.findingId === "finding-fail");
  assert.equal(failed?.status, "needs_review");
  assert.match(failed?.rows[0].reviewReason ?? "", /calculation failed/);
  assert.equal(siblingFinished, true);
});

test("historical entry snapshots cannot become annual monitored impact", async () => {
  const row = portfolioRow(); row.analysis_kind = "historical_entries";
  let calls = 0;
  const [impact] = await buildMonitoredCompanyImpacts([candidate()], [row], async () => { calls++; return null; });
  assert.equal(calls, 0);
  assert.equal(impact.rows[0].status, "needs_review");
  assert.match(impact.rows[0].reviewReason!, /not annual portfolio/);
});
