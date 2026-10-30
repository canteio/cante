import {DUTY_CALCULATION_VERSION,combineDutyAmounts} from "@/lib/tariff/duty-expression";
import type { LiveCheckResult } from "./check";

export type ProductDutyChange = {
  sku: string;
  hts: string;
  origin: string;
  before: number | null;
  after: number | null;
  difference: number | null;
  status: "changed" | "rate_changed" | "same_calculated_duty" | "unresolved";
  rateBefore?: number | null;
  rateAfter?: number | null;
  rateDifference?: number | null;
  reason: string;
};
export type DutyComparison = {
  status: "compared" | "unavailable";
  reason: string;
  beforeCheckedAt: string | null;
  changedProducts: number | null;
  fullDutyDifference: number | null;
  baseDutyDifference: number | null;
  topChanges: {
    sku: string;
    hts: string;
    origin: string;
    before: number;
    after: number;
    difference: number;
  }[];
  rows: ProductDutyChange[];
};
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
export const tariffFactsFingerprint = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

const canonical = tariffFactsFingerprint;

/** Callers may supply only a worker-attested archive or a fresh in-process result.
 * This compares calculated money on identical facts; it is not legal approval. */
export function currentCalculationResult(result:LiveCheckResult|null):LiveCheckResult|null {return result?.calculationVersion===DUTY_CALCULATION_VERSION?result:null;}

export function compareSavedChecks(
  previous: LiveCheckResult | null,
  current: LiveCheckResult,
): DutyComparison {
  const unavailable: DutyComparison = {
    status: "unavailable",
    reason:
      "No verified previous check is available. Run a first check to establish a baseline.",
    beforeCheckedAt: previous?.checkedAt ?? null,
    changedProducts: null,
    fullDutyDifference: null,
    baseDutyDifference: null,
    topChanges: [],
    rows: [],
  };
  if (
    !previous ||
    !Array.isArray(previous.rows) ||
    previous.rows.some(
      (row) =>
        !row?.product ||
        typeof row.product.sku !== "string" ||
        typeof row.product.hts !== "string" ||
        typeof row.product.origin !== "string",
    )
  )
    return unavailable;
  if(previous.calculationVersion!==current.calculationVersion)return{...unavailable,reason:"The calculation method changed. The new check establishes a fresh numerical baseline; this difference is not a regulatory change."};
  if (!previous.consistentRevision || !current.consistentRevision)
    return {
      ...unavailable,
      reason:
        "A stable government revision was not established for both checks.",
    };
  if (
    previous.basis !== current.basis &&
    (previous.valuationBasis ?? previous.basis) !==
      (current.valuationBasis ?? current.basis)
  )
    return {
      ...unavailable,
      reason:
        "The checks do not have the same calculation basis or product groups.",
    };
  const calculationFacts = (p: LiveCheckResult["rows"][number]["product"]) => {
    const { history, inputBasis, valueBasis, ...facts } = p;
    return {
      ...facts,
      valueBasis:
        valueBasis ?? (history ? "historical" : inputBasis ? null : "annual"),
    };
  };
  const key = (row: LiveCheckResult["rows"][number]) =>
    JSON.stringify([row.product.sku, row.product.hts, row.product.origin]);
  const old = new Map(previous.rows.map((row) => [key(row), row]));
  if (
    old.size !== previous.rows.length ||
    new Set(current.rows.map(key)).size !== current.rows.length
  )
    return {
      ...unavailable,
      reason:
        "Uploaded values, products or qualification facts differ; no duty difference is claimed.",
    };
  let full = finite(previous.totalDuty) && finite(current.totalDuty);
  let base = true;
  const beforeBase:number[]=[],afterBase:number[]=[];
  const rows: ProductDutyChange[] = [];
  for (const row of current.rows) {
    const before = old.get(key(row));
    if (
      !before ||
      canonical(calculationFacts(before.product)) !==
        canonical(calculationFacts(row.product))
    ) {
      full = false;
      base = false;
      rows.push({
        sku: row.product.sku,
        hts: row.product.hts,
        origin: row.product.origin,
        before: null,
        after: null,
        difference: null,
        status: "unresolved",
        reason:
          "New or edited product facts. Run another check on these saved facts to establish a comparable difference.",
      });
      continue;
    }
    const a = before.stack?.totalAmount,
      b = row.stack?.totalAmount;
    let resolved =
      finite(a) &&
      finite(b) &&
      !before.error &&
      !row.error &&
      before.verification?.status !== "failed" &&
      row.verification?.status !== "failed" &&
      !before.stack?.unresolvedMeasures?.length &&
      !row.stack?.unresolvedMeasures?.length;
    const rateA = before.stack?.totalRatePercent,
      rateB = row.stack?.totalRatePercent;
    const rateResolved =
      finite(rateA) &&
      finite(rateB) &&
      !before.error &&
      !row.error &&
      !before.stack?.unresolvedMeasures?.length &&
      !row.stack?.unresolvedMeasures?.length;
    const rateDifference = rateResolved
      ? Number((rateB - rateA).toFixed(6))
      : null;
    const difference = resolved
      ? combineDutyAmounts([b!],[a!])
      : null;
    resolved = resolved && difference!==null;
    if (!resolved) full = false;
    rows.push({
      sku: row.product.sku,
      hts: row.product.hts,
      origin: row.product.origin,
      before: resolved ? a! : null,
      after: resolved ? b! : null,
      difference,
      rateBefore: rateResolved ? rateA : null,
      rateAfter: rateResolved ? rateB : null,
      rateDifference,
      status: resolved
        ? difference === 0
          ? "same_calculated_duty"
          : "changed"
        : rateDifference !== null && rateDifference !== 0
          ? "rate_changed"
          : "unresolved",
      reason: resolved
        ? "Same uploaded facts; this numerical comparison does not establish that every applicable law was evaluated."
        : (row.error ??
          row.stack?.unresolvedMeasures?.[0] ??
          before.error ??
          before.stack?.unresolvedMeasures?.[0] ??
          "A complete duty calculation is unavailable in one or both checks."),
    });
    const oldBase = before.quote?.computation.amount,
      newBase = row.quote?.computation.amount;
    if (
      !finite(oldBase) ||
      !finite(newBase) ||
      before.quote?.column !== row.quote?.column ||
      before.verification?.status === "failed" ||
      row.verification?.status === "failed"
    )
      base = false;
    else {afterBase.push(newBase);beforeBase.push(oldBase);}
  }
  const fullDifference=full?combineDutyAmounts(rows.map(r=>r.after!),rows.map(r=>r.before!)):null;
  if(fullDifference===null)full=false;
  const baseDifference=base?combineDutyAmounts(afterBase,beforeBase):null;
  const changed = rows.filter((row) => row.status === "changed");
  return {
    ...unavailable,
    status: "compared",
    reason: full
      ? "Same inputs and qualification facts; numerical duty differences are not an independent legal-applicability decision."
      : "Full duty difference is unresolved; incomplete amounts are never treated as zero.",
    changedProducts: full ? changed.length : null,
    fullDutyDifference: fullDifference,
    baseDutyDifference: baseDifference,
    rows,
    topChanges: changed
      .sort(
        (a, b) =>
          Math.abs(b.difference!) - Math.abs(a.difference!) ||
          a.sku.localeCompare(b.sku),
      )
      .slice(0, 5)
      .map((r) => ({
        sku: r.sku,
        hts: r.hts,
        origin: r.origin,
        before: r.before!,
        after: r.after!,
        difference: r.difference!,
      })),
  };
}

export type CheckRefresh = DutyComparison & {
  sourceCheckId: string;
  checkedDay: string;
  todayNotices: {
    title: string;
    url: string;
    date: string | null;
    source: string;
  }[];
  todayNoticesOmitted: number;
};
/** Attach comparison/news metadata BEFORE archive completion, so chat and the
 * dashboard reopen exactly the same calculation rather than mutating a saved result. */
export function attachCheckComparison(
  result: LiveCheckResult,
  baseline: {
    record: { id: string };
    verifiedResult: LiveCheckResult | null;
  } | null,
) {
  result.baselineCheckId = baseline?.verifiedResult ? baseline.record.id : null;
  result.comparison = compareSavedChecks(
    baseline?.verifiedResult ?? null,
    result,
  );
  if (baseline) {
    const today = result.entryDate;
    const notices = result.notices.filter((notice) => {
      if (!notice.date) return false;
      if (/^\d{4}-\d{2}-\d{2}$/.test(notice.date)) return notice.date === today;
      const date = new Date(notice.date);
      return (
        Number.isFinite(date.getTime()) &&
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(date) === today
      );
    });
    result.chatRecheck = {
      ...result.comparison,
      sourceCheckId: baseline.record.id,
      checkedDay: today,
      todayNotices: notices.slice(0, 10),
      todayNoticesOmitted: Math.max(0, notices.length - 10),
    };
  }
}
