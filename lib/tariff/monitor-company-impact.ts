import { historicalPilotDuty, type ImpactRow } from "./business-impact";
import pilot from "@/config/tariff-pilot.json";
import {
  computeStackedDuty,
  type StackDutyInput,
  type StackedDutyComponent,
  type StackedDutyResult,
} from "./stack";

export interface MonitorCompanyCandidate {
  id: string;
  findingId: string;
  productId: string;
  matchKind: "exact_code" | "code_prefix";
  matchReason: string;
  createdAt: string;
  product: { sku: string; name: string } | null;
  action: {
    name: string;
    citations: string[];
    sourceKind?: "monitored" | "reviewed_reference";
  };
}

export interface CompanyImpactRow {
  productId: string;
  sku: string;
  hts: string | null;
  origin: string | null;
  supplier: string | null;
  previousRate: number | null;
  newRate: number | null;
  impactUsd: number | null;
  status: "computed" | "needs_review";
  reviewReason: string | null;
  evidence: ImpactRow["stack_result"];
  beforeEvidence?: ImpactRow["stack_result"];
  entryId?: string | null;
  lineNumber?: string | null;
  basisValueUsd?: number | null;
}

export interface MonitoredCompanyImpact {
  findingId: string;
  action: {
    name: string;
    effectiveDate: string | null;
    citations: string[];
    sourceKind?: "monitored" | "reviewed_reference";
  };
  affectedProductCount: number;
  estimatedDutyDeltaUsd: number | null;
  status: "computed" | "needs_review";
  reviewReason: string | null;
  suppliers: string[];
  products: string[];
  rows: CompanyImpactRow[];
  basis?: { kind: "historical_basket" | "annual_portfolio"; valueUsd: number | null; entryCount: number; periodStart: string | null; periodEnd: string | null; explanation: string };
}

type DutyComputer = (input: StackDutyInput) => Promise<StackedDutyResult | null>;
type ResolvedDutyResult = StackedDutyResult & { totalRatePercent: number; totalAmount: number };
type VersionedComponent = StackedDutyComponent & { effectiveDate: string; sourceDocumentNumber: string };

export const MONITOR_IMPACT_MAX_CANDIDATES = 500;
export const MONITOR_IMPACT_MAX_FINDINGS = 500;
export const MONITOR_IMPACT_MAX_PAIRS = 500;
export const MONITOR_IMPACT_DUTY_CONCURRENCY = 5;
export const MONITOR_IMPACT_GLOBAL_QUEUE_LIMIT = 500;

export type MonitorImpactLimitCode = "candidate_limit" | "finding_limit" | "pair_limit";

export class MonitorImpactLimitError extends Error {
  constructor(
    readonly code: MonitorImpactLimitCode,
    readonly limit: number,
  ) {
    super(`Monitor impact ${code.replace("_", " ")} exceeded (${limit}).`);
  }
}

export interface MonitorImpactBuildOptions {
  signal?: AbortSignal;
  dutyConcurrency?: number;
}

type DerivedRow = CompanyImpactRow & { effectiveDate: string | null };

function needsReview(
  candidate: MonitorCompanyCandidate,
  portfolioRow: ImpactRow | undefined,
  reason: string,
  evidence: ImpactRow["stack_result"] = null,
  effectiveDate: string | null = null,
): DerivedRow {
  return {
    productId: candidate.productId,
    sku: portfolioRow?.sku ?? candidate.product?.sku ?? "Unknown product",
    hts: portfolioRow?.hts ?? null,
    origin: portfolioRow?.origin ?? null,
    supplier: portfolioRow?.supplier ?? null,
    previousRate: null,
    newRate: null,
    impactUsd: null,
    status: "needs_review",
    reviewReason: reason,
    evidence,
    effectiveDate,
    entryId: portfolioRow?.entry_id,
    lineNumber: portfolioRow?.line_number,
    basisValueUsd: portfolioRow?.analysis_kind === "historical_entries" ? portfolioRow.customs_value_usd : portfolioRow?.annual_import_value_usd,
  };
}

function previousIsoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const FEDERAL_REGISTER_DOCUMENT_TOKEN = /(?<![A-Za-z0-9-])(\d{4}-\d{5})(?![A-Za-z0-9-])/g;
const TRUSTED_FEDERAL_REGISTER_HOSTS = ["federalregister.gov", "govinfo.gov"];

function canonicalDocumentNumbers(citation: string): string[] {
  const value = citation.trim();
  if (!value) return [];

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    const trusted = TRUSTED_FEDERAL_REGISTER_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
    return trusted ? [...url.pathname.matchAll(FEDERAL_REGISTER_DOCUMENT_TOKEN)].map(match => match[1]) : [];
  } catch {
    // Plain-text finding metadata is accepted only when the entire field is a
    // canonical Federal Register identifier. Arbitrary prose containing a
    // discrete-looking number is not source identity.
    const plain = /^(?:FR\s+Doc(?:ument)?\.?\s*)?(\d{4}-\d{5})$/i.exec(value);
    return plain ? [plain[1]] : [];
  }
}

function canonicalSourceDocumentNumber(documentNumber: string): string | null {
  const value = documentNumber.trim();
  const plain = /^(?:FR\s+Doc(?:ument)?\.?\s*)?(\d{4}-\d{5})$/i.exec(value);
  if (plain) return plain[1];
  try {
    new URL(value);
  } catch {
    return null;
  }
  const fromUrl = canonicalDocumentNumbers(value);
  return fromUrl.length === 1 ? fromUrl[0] : null;
}

function documentMatchesFinding(documentNumber: string, citations: string[]): boolean {
  const sourceNumber = canonicalSourceDocumentNumber(documentNumber);
  return sourceNumber !== null
    && citations.some(citation => canonicalDocumentNumbers(citation).includes(sourceNumber));
}

function isFullyResolved(result: StackedDutyResult | null): result is ResolvedDutyResult {
  return result !== null
    && result.totalRatePercent !== null
    && result.totalAmount !== null
    && result.unresolvedMeasures.length === 0;
}

function versionedComponents(result: StackedDutyResult): VersionedComponent[] {
  return result.components.filter((component): component is VersionedComponent =>
    component.type !== "base"
    && typeof component.effectiveDate === "string"
    && typeof component.sourceDocumentNumber === "string");
}

function stackInput(row: ImpactRow, importDate?: string, signal?: AbortSignal): StackDutyInput | null {
  const value = row.analysis_kind === "historical_entries" ? row.customs_value_usd : row.annual_import_value_usd;
  if (!row.hts || !row.origin || value == null || !Number.isFinite(value) || value < 0) return null;
  return {
    htsCode: row.hts,
    countryOfOrigin: row.origin,
    value,
    quantity: row.quantity,
    unit: row.unit,
    claimedProgramme: row.special_program_claim,
    importDate,
    signal,
  };
}

async function deriveRowUnchecked(
  candidate: MonitorCompanyCandidate,
  row: ImpactRow | undefined,
  calculate: (row: ImpactRow, importDate?: string) => Promise<StackedDutyResult | null>,
): Promise<DerivedRow> {
  if (!row) {
    return needsReview(candidate, row, "No row in the selected company impact run is linked to this catalogue product.");
  }
  if (!row.input_valid || row.status === "error" || !stackInput(row)) {
    return needsReview(candidate, row, "The linked row has invalid inputs or is missing HTS, origin, or import value required for deterministic recalculation.");
  }

  if (row.analysis_kind === "historical_entries" && (!row.entry_id || !row.line_number || !row.evaluation_date || !row.qualification_verified || !row.qualification_basis?.trim())) {
    return needsReview(candidate, row, "Historical impact requires entry identity, date and reviewed qualifications. Historical values are not annual portfolio exposure.");
  }
  if (row.chapter99_codes || row.exclusion_id || row.special_program_claim) return needsReview(candidate, row, "Uploaded claims require verified applicability review.");
  // An archived, reviewed change can be replayed without substituting today's
  // schedule for the legal dates. Other changes still use the versioned engine.
  const reviewedTransition = row.analysis_kind === "historical_entries"
    && documentMatchesFinding("2026-15181", candidate.action.citations)
    ? historicalPilotDuty(row, pilot.transitionDate) : null;
  const compute = reviewedTransition ? async (input: ImpactRow, date?: string) => historicalPilotDuty(input, date ?? pilot.transitionDate) : calculate;
  const current = reviewedTransition ?? await compute(row);
  if (!current) {
    return needsReview(candidate, row, "The current deterministic duty calculation returned no tariff result.");
  }
  const versioned = versionedComponents(current);
  if (versioned.length === 0) {
    return needsReview(candidate, row, "The current rule component has no structured verified effective date and source document number.", current);
  }
  const currentComponent = versioned.find(component =>
    documentMatchesFinding(component.sourceDocumentNumber, candidate.action.citations));
  if (!currentComponent) {
    return needsReview(candidate, row, "The current rule component's authoritative source document does not match the monitored finding.", current);
  }

  const effectiveDate = currentComponent.effectiveDate;
  const beforeDate = previousIsoDate(effectiveDate);
  if (!beforeDate) {
    return needsReview(candidate, row, `The current rule component has an invalid structured effective date: ${effectiveDate}.`, current);
  }

  const [beforeResult, afterResult] = await Promise.allSettled([
    compute(row, beforeDate),
    compute(row, effectiveDate),
  ]);
  if (beforeResult.status === "rejected") throw beforeResult.reason;
  if (afterResult.status === "rejected") throw afterResult.reason;
  const before = beforeResult.value;
  const after = afterResult.value;
  if (!isFullyResolved(before)) {
    return needsReview(candidate, row, `The deterministic calculation on ${beforeDate}, immediately before ${effectiveDate}, is unresolved.`, before, effectiveDate);
  }
  if (versionedComponents(before).some(component =>
    component.sourceDocumentNumber === currentComponent.sourceDocumentNumber)) {
    return needsReview(candidate, row, `The tariff engine did not resolve a prior rule version on ${beforeDate}.`, before, effectiveDate);
  }
  if (!isFullyResolved(after)) {
    return needsReview(candidate, row, `The deterministic calculation on ${effectiveDate} is unresolved.`, after, effectiveDate);
  }
  const afterComponent = versionedComponents(after).find(component =>
    component.effectiveDate === effectiveDate
    && component.sourceDocumentNumber === currentComponent.sourceDocumentNumber);
  if (!afterComponent || !documentMatchesFinding(afterComponent.sourceDocumentNumber, candidate.action.citations)) {
    return needsReview(candidate, row, "The on-effective-date calculation does not contain the monitored authoritative rule component.", after, effectiveDate);
  }

  return {
    productId: candidate.productId,
    sku: row.sku ?? candidate.product?.sku ?? "Unknown product",
    hts: row.hts,
    origin: row.origin,
    supplier: row.supplier,
    previousRate: before.totalRatePercent,
    newRate: after.totalRatePercent,
    impactUsd: Number((after.totalAmount - before.totalAmount).toFixed(2)),
    status: "computed",
    reviewReason: null,
    evidence: after,
    beforeEvidence: before,
    entryId: row.entry_id,
    lineNumber: row.line_number,
    basisValueUsd: row.analysis_kind === "historical_entries" ? row.customs_value_usd : row.annual_import_value_usd,
    effectiveDate,
  };
}

async function deriveRow(
  candidate: MonitorCompanyCandidate,
  row: ImpactRow | undefined,
  calculate: (row: ImpactRow, importDate?: string) => Promise<StackedDutyResult | null>,
): Promise<DerivedRow> {
  try {
    return await deriveRowUnchecked(candidate, row, calculate);
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? "The deterministic duty calculation was cancelled before this row completed."
      : "The deterministic duty calculation failed for this row; no rates or dollars are shown.";
    return needsReview(candidate, row, reason);
  }
}

interface ScheduledDutyCall {
  input: StackDutyInput;
  resolve: (result: StackedDutyResult | null) => void;
  reject: (error: unknown) => void;
}

function abortError(): DOMException {
  return new DOMException("The monitor impact calculation was cancelled.", "AbortError");
}

interface GlobalDutyCall extends ScheduledDutyCall {
  computer: DutyComputer;
  signal?: AbortSignal;
}

export const MONITOR_IMPACT_GLOBAL_PAIR_LIMIT = 500;

/** Minimal generic bounded queue: schedules async thunks with a process-wide
 * concurrency and admission cap. Used both for raw duty calls (small request
 * payload) and for whole-pair derivation (so unlimited concurrent requests
 * cannot allocate unbounded pending-row state even though duty calls
 * themselves are already throttled -- the derivation closures, portfolio row
 * references, and awaited chains were still being created immediately for
 * every pair before this limiter existed). */
export function createBoundedQueue(concurrency: number, admissionLimit: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  let admitted = 0;

  function drain() {
    while (active < concurrency && queue.length) {
      const run = queue.shift();
      if (!run) return;
      active += 1;
      run();
    }
  }

  return {
    run<T>(thunk: () => Promise<T>): Promise<T> {
      if (admitted >= admissionLimit) {
        return Promise.reject(new Error("The shared company-impact derivation queue is at capacity."));
      }
      admitted += 1;
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          thunk().then(resolve, reject).finally(() => {
            active -= 1;
            admitted -= 1;
            drain();
          });
        });
        drain();
      });
    },
  };
}

const globalPairQueue = createBoundedQueue(MONITOR_IMPACT_DUTY_CONCURRENCY, MONITOR_IMPACT_GLOBAL_PAIR_LIMIT);

function deriveRowQueued(
  candidate: MonitorCompanyCandidate,
  row: ImpactRow | undefined,
  calculate: (row: ImpactRow, importDate?: string) => Promise<StackedDutyResult | null>,
): Promise<DerivedRow> {
  return globalPairQueue.run(() => deriveRow(candidate, row, calculate)).catch(() =>
    needsReview(candidate, row, "The shared company-impact derivation queue was at capacity; retry this run later."));
}


// Process-wide cap: simultaneous requests share this scheduler. Per-request
// limits alone still allow N concurrent requests to multiply upstream USITC /
// Supabase traffic by N.
const globalDutyQueue: GlobalDutyCall[] = [];
let globalDutyActive = 0;

function drainGlobalDutyQueue() {
  while (globalDutyActive < MONITOR_IMPACT_DUTY_CONCURRENCY && globalDutyQueue.length) {
    const call = globalDutyQueue.shift();
    if (!call) return;
    if (call.signal?.aborted) {
      call.reject(abortError());
      continue;
    }
    globalDutyActive += 1;
    void call.computer(call.input).then(call.resolve, call.reject).finally(() => {
      globalDutyActive -= 1;
      drainGlobalDutyQueue();
    });
  }
}

function globallyBoundedDutyComputer(computer: DutyComputer, signal?: AbortSignal): DutyComputer {
  return input => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    if (globalDutyQueue.length >= MONITOR_IMPACT_GLOBAL_QUEUE_LIMIT) {
      reject(new Error("The shared tariff calculation queue is at capacity."));
      return;
    }
    globalDutyQueue.push({ computer, input, signal, resolve, reject });
    drainGlobalDutyQueue();
  });
}

function boundedDutyComputer(
  computer: DutyComputer,
  concurrency: number,
  signal?: AbortSignal,
): DutyComputer {
  const queue: ScheduledDutyCall[] = [];
  let active = 0;

  const drain = () => {
    if (signal?.aborted) {
      while (queue.length) queue.shift()?.reject(abortError());
      return;
    }
    while (active < concurrency && queue.length) {
      const call = queue.shift();
      if (!call) return;
      active += 1;
      void computer(call.input).then(call.resolve, call.reject).finally(() => {
        active -= 1;
        drain();
      });
    }
  };

  signal?.addEventListener("abort", drain, { once: true });
  return (input) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    queue.push({ input, resolve, reject });
    drain();
  });
}

/**
 * Recompute tenant-loaded portfolio rows on both sides of an authoritative,
 * effective-dated rule. Monitor matches select rows but never supply rates.
 */
export async function buildMonitoredCompanyImpacts(
  candidates: MonitorCompanyCandidate[],
  portfolioRows: ImpactRow[],
  computer: DutyComputer = computeStackedDuty,
  options: MonitorImpactBuildOptions = {},
): Promise<MonitoredCompanyImpact[]> {
  if (candidates.length > MONITOR_IMPACT_MAX_CANDIDATES) {
    throw new MonitorImpactLimitError("candidate_limit", MONITOR_IMPACT_MAX_CANDIDATES);
  }
  const findingCount = new Set(candidates.map(candidate => candidate.findingId)).size;
  if (findingCount > MONITOR_IMPACT_MAX_FINDINGS) {
    throw new MonitorImpactLimitError("finding_limit", MONITOR_IMPACT_MAX_FINDINGS);
  }
  const concurrency = options.dutyConcurrency ?? MONITOR_IMPACT_DUTY_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MONITOR_IMPACT_DUTY_CONCURRENCY) {
    throw new RangeError(`Duty concurrency must be an integer from 1 to ${MONITOR_IMPACT_DUTY_CONCURRENCY}.`);
  }

  const candidateIdentities = new Set<string>();
  candidates = candidates.filter(candidate => {
    const key = JSON.stringify([candidate.findingId, candidate.productId]);
    if (candidateIdentities.has(key)) return false;
    candidateIdentities.add(key); return true;
  });
  const historicalIdentities = new Set<string>();
  const duplicateEntries = new Set<string>();
  for (const row of portfolioRows) if (row.analysis_kind === "historical_entries") {
    const key = JSON.stringify([row.entry_id, row.line_number]);
    if (historicalIdentities.has(key)) duplicateEntries.add(key);
    historicalIdentities.add(key);
  }
  const rowsByProduct = new Map<string, ImpactRow[]>();
  for (const row of portfolioRows) {
    if (!row.product_id) continue;
    const linked = rowsByProduct.get(row.product_id) ?? [];
    linked.push(duplicateEntries.has(JSON.stringify([row.entry_id, row.line_number]))
      ? { ...row, input_valid: false, status: "error" } : row);
    rowsByProduct.set(row.product_id, linked);
  }

  const pairCount = candidates.reduce((count, candidate) =>
    count + Math.max(rowsByProduct.get(candidate.productId)?.length ?? 0, 1), 0);
  if (pairCount > MONITOR_IMPACT_MAX_PAIRS) {
    throw new MonitorImpactLimitError("pair_limit", MONITOR_IMPACT_MAX_PAIRS);
  }

  const globalComputer = globallyBoundedDutyComputer(computer, options.signal);
  const scheduledComputer = boundedDutyComputer(globalComputer, concurrency, options.signal);
  const calculations = new Map<string, Promise<StackedDutyResult | null>>();
  const calculate = (row: ImpactRow, importDate?: string) => {
    const key = `${row.row_number}:${importDate ?? "current"}`;
    let result = calculations.get(key);
    if (!result) {
      const input = stackInput(row, importDate, options.signal);
      result = input ? scheduledComputer(input) : Promise.resolve(null);
      calculations.set(key, result);
    }
    return result;
  };

  const byFinding = new Map<string, MonitorCompanyCandidate[]>();
  for (const candidate of candidates) {
    const linked = byFinding.get(candidate.findingId) ?? [];
    linked.push(candidate);
    byFinding.set(candidate.findingId, linked);
  }

  return Promise.all([...byFinding.entries()].map(async ([findingId, findingCandidates]) => {
    const rows = (await Promise.all(findingCandidates.map(async candidate => {
      const matchedRows = rowsByProduct.get(candidate.productId);
      return matchedRows?.length
        ? Promise.all(matchedRows.map(row => deriveRowQueued(candidate, row, calculate)))
        : [await deriveRowQueued(candidate, undefined, calculate)];
    }))).flat();
    const unresolved = rows.filter(row => row.status === "needs_review");
    const delta = unresolved.length === 0
      ? Number(rows.reduce((sum, row) => sum + (row.impactUsd ?? 0), 0).toFixed(2))
      : null;
    const products = [...new Set(findingCandidates.map(candidate => candidate.product?.sku).filter((sku): sku is string => Boolean(sku)))];
    const suppliers = [...new Set(rows.map(row => row.supplier).filter((supplier): supplier is string => Boolean(supplier)))];
    const dates = [...new Set(rows.map(row => row.effectiveDate).filter((date): date is string => Boolean(date)))];
    const productIds = new Set(findingCandidates.map(candidate => candidate.productId));
    const basisRows = portfolioRows.filter(row => row.product_id && productIds.has(row.product_id));
    const historical = basisRows.some(row => row.analysis_kind === "historical_entries");
    const entryDates = basisRows.map(row => row.evaluation_date).filter((date): date is string => Boolean(date)).sort();
    const values = basisRows.map(row => row.analysis_kind === "historical_entries" ? row.customs_value_usd : row.annual_import_value_usd);
    const valueUsd = values.every(value => value != null && Number.isFinite(value))
      ? Number(values.reduce<number>((sum, value) => sum + value!, 0).toFixed(2)) : null;

    return {
      findingId,
      action: {
        ...findingCandidates[0].action,
        effectiveDate: dates.length === 1 ? dates[0] : null,
      },
      affectedProductCount: new Set(findingCandidates.map(candidate => candidate.productId)).size,
      estimatedDutyDeltaUsd: delta,
      status: unresolved.length ? "needs_review" : "computed",
      reviewReason: unresolved.length
        ? `${unresolved.length} affected row(s) need review. ${unresolved[0].reviewReason}`
        : null,
      suppliers,
      products,
      rows: rows.map(({ effectiveDate: _effectiveDate, ...row }) => row),
      basis: {
        kind: historical ? "historical_basket" : "annual_portfolio",
        valueUsd, entryCount: historical ? basisRows.length : 0,
        periodStart: historical ? entryDates[0] ?? null : null,
        periodEnd: historical ? entryDates.at(-1) ?? null : null,
        explanation: historical
          ? "Estimated change if the same uploaded goods, customs values and quantities were imported under the verified before and after rules. This is a historical-volume scenario, not an annual forecast or a refund claim. The date span does not establish that all imports in that period were uploaded."
          : "Estimated annual change using the uploaded annual portfolio values and quantities, held constant across the rule change.",
      },
    };
  }));
}


/** Show a verified historical transition for supported uploaded goods, clearly
 * distinguished from a newly detected regulatory event. No synthetic findings. */
export function reviewedHistoricalCandidates(rows: ImpactRow[]): MonitorCompanyCandidate[] {
  const products = new Map<string, ImpactRow>();
  for (const row of rows) if (row.product_id && row.analysis_kind === "historical_entries"
    && row.hts?.replace(/\D/g, "") === pilot.htsCode.replace(/\D/g, "") && pilot.origins.includes(row.origin ?? "")) products.set(row.product_id, row);
  return [...products].map(([productId, row]) => ({
    id: `reviewed-2026-15181:${productId}`, findingId: "reviewed-2026-15181", productId,
    matchKind: "exact_code", matchReason: "Exact code in the reviewed historical calculation scope.", createdAt: "",
    product: { sku: row.sku ?? productId, name: row.sku ?? productId },
    action: { name: "July 24, 2026: Section 122 expires; Section 301 forced-labor duties begin", sourceKind: "reviewed_reference", citations: [pilot.sources.forcedLabor, pilot.sources.cbp, pilot.sources.section122] },
  }));
}
