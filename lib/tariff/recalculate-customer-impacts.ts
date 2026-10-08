import { randomUUID, createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getImpactRun } from "@/lib/tariff/business-impact-store";
import type { ImpactRow } from "@/lib/tariff/business-impact";
import {
  buildMonitoredCompanyImpacts,
  createBoundedQueue,
  MONITOR_IMPACT_MAX_CANDIDATES,
  MonitorImpactLimitError,
  type MonitorCompanyCandidate,
  type MonitoredCompanyImpact,
} from "@/lib/tariff/monitor-company-impact";
import { sendTelegram, telegramConfig, TelegramError, type EnvLike } from "@/lib/delivery/telegram";

/**
 * Proactive customer notification for monitored trade-rule changes.
 *
 * `monitor-candidates/route.ts` recomputes a company's impact only when
 * someone opens the dashboard with a run selected. That is the entire gap
 * this file closes: a scheduled pass (see scripts/recalculate-tariff-impacts.ts)
 * walks every customer with monitor candidates, recomputes the SAME
 * already-reviewed `buildMonitoredCompanyImpacts()` against their most
 * recent impact run, and durably records + delivers the result so a
 * customer is told, not left to notice.
 *
 * Three invariants carried over unmodified from the dashboard path:
 *   - never invent a dollar figure: a NEEDS REVIEW result always has a null
 *     delta and a specific reason (same check constraint as the migration).
 *   - never re-notify for an unchanged result: a content hash gates the
 *     insert, backed by a unique constraint in the database, not just an
 *     in-process check.
 *   - never unbounded: customer-level work shares the SAME bounded queue
 *     primitive already reviewed in monitor-company-impact.ts, and the duty
 *     calculations inside buildMonitoredCompanyImpacts share its existing
 *     process-wide duty concurrency cap regardless of how many customers run
 *     at once.
 */

export const RECALC_CUSTOMER_CONCURRENCY = 5;
export const RECALC_CUSTOMER_QUEUE_LIMIT = 500;
export const RECALC_MAX_CUSTOMERS = 2000;

type Row = Record<string, unknown>;
const stringValue = (row: Row, key: string): string | null =>
  typeof row[key] === "string" ? (row[key] as string) : null;

type DutyComputer = Parameters<typeof buildMonitoredCompanyImpacts>[2];

export interface RecalculationOptions {
  env?: EnvLike;
  signal?: AbortSignal;
  customerConcurrency?: number;
  /** Test-only injection points, mirroring buildMonitoredCompanyImpacts' own
   * `computer` parameter: production always uses the real service client
   * and real customer discovery; tests can substitute both without
   * reimplementing the bounded-queue or dedup logic under test. */
  client?: ReturnType<typeof createServiceClient>;
  customerIds?: string[];
  /** Test-only injection point, mirroring buildMonitoredCompanyImpacts' own
   * `computer` parameter. Defaults to the real computeStackedDuty. */
  computer?: DutyComputer;
}

export type CustomerRecalculationSkipReason =
  | "no_impact_run"
  | "run_not_found"
  | "no_linked_products"
  | "no_candidates"
  | "candidate_limit"
  | "error";

export interface CustomerRecalculationResult {
  customerId: string;
  findingsEvaluated: number;
  eventsCreated: number;
  notified: boolean;
  notifyDetail: string;
  skippedReason?: CustomerRecalculationSkipReason;
}

export interface RecalculationSummary {
  customersEvaluated: number;
  customerResults: CustomerRecalculationResult[];
}

/** Everything that defines whether a result is "the same" for notification
 * dedup purposes. Deliberately excludes id/createdAt/notified* bookkeeping. */
function canonicalImpactPayload(impact: MonitoredCompanyImpact) {
  return {
    action: impact.action,
    affectedProductCount: impact.affectedProductCount,
    estimatedDutyDeltaUsd: impact.estimatedDutyDeltaUsd,
    status: impact.status,
    reviewReason: impact.reviewReason,
    suppliers: impact.suppliers,
    products: impact.products,
    rows: impact.rows,
  };
}

export function impactResultHash(impact: MonitoredCompanyImpact): string {
  return createHash("sha256").update(JSON.stringify(canonicalImpactPayload(impact))).digest("hex");
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const showMoney = (value: number | null) => (value === null ? "NEEDS REVIEW" : money.format(value));

/** Mirrors the dashboard's WHAT CHANGED / ARE WE AFFECTED / HOW MUCH / WHERE
 * layout (components/tariff/monitor-candidates.tsx) so the Telegram digest
 * and the dashboard never tell two different stories about the same event. */
export function formatCustomerImpactDigest(impacts: MonitoredCompanyImpact[]): string {
  const lines: string[] = [
    `🛡️ Cante — Tariff impact update — ${new Date().toISOString().slice(0, 10)}`,
    `${impacts.length} monitored action${impacts.length === 1 ? "" : "s"} recomputed against your latest company impact snapshot.`,
  ];
  for (const impact of impacts) {
    lines.push("");
    lines.push(`WHAT CHANGED: ${impact.action.name}`);
    lines.push(`Effective date: ${impact.action.effectiveDate ?? "NEEDS REVIEW"}`);
    lines.push(impact.action.citations.length
      ? `Authoritative citation(s): ${impact.action.citations.join("; ")}`
      : "Authoritative citation(s): NEEDS REVIEW");
    lines.push(`ARE WE AFFECTED: ${impact.affectedProductCount} matched SKU/product(s)`);
    lines.push(`HOW MUCH: ${impact.status === "needs_review" ? "NEEDS REVIEW" : showMoney(impact.estimatedDutyDeltaUsd)}`);
    lines.push(`WHERE: Products: ${impact.products.length ? impact.products.join(", ") : "not identified"}; ` +
      `Suppliers: ${impact.suppliers.length ? impact.suppliers.join(", ") : "not present in selected run"}`);
    if (impact.reviewReason) {
      lines.push(`NEEDS REVIEW: ${impact.reviewReason} A monitor match alone never establishes an old rate or dollar delta.`);
    }
  }
  lines.push("");
  lines.push("👉 Open Cante Copilot — Company impact to review calculation details.");
  return lines.join("\n");
}

/** Mirrors the join logic in app/api/tariff/monitor-candidates/route.ts.
 * Not shared code with that reviewed route on purpose: the route stays
 * exactly as already reviewed, and this worker path keeps its own tenant
 * filters explicit since it uses the service-role client (RLS bypassed —
 * every filter below is load-bearing for tenant isolation, not advisory). */
async function loadCandidatesForRun(
  client: ReturnType<typeof createServiceClient>,
  customerId: string,
  run: { rows: ImpactRow[] },
): Promise<{ candidates: MonitorCompanyCandidate[]; skippedReason?: CustomerRecalculationSkipReason }> {
  const linkedProductIds = [...new Set(run.rows
    .map((row) => row.product_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (linkedProductIds.length === 0) return { candidates: [], skippedReason: "no_linked_products" };

  const { data: candidateData, error: candidateError } = await client.from("tariff_monitor_candidates")
    .select("id,finding_id,product_id,match_kind,match_reason,created_at")
    .eq("customer_id", customerId)
    .in("product_id", linkedProductIds)
    .order("created_at", { ascending: false }).order("id")
    .range(0, MONITOR_IMPACT_MAX_CANDIDATES);
  if (candidateError) throw new Error(candidateError.message);
  const candidateRows = (candidateData ?? []) as Row[];
  if (candidateRows.length > MONITOR_IMPACT_MAX_CANDIDATES) return { candidates: [], skippedReason: "candidate_limit" };
  if (candidateRows.length === 0) return { candidates: [], skippedReason: "no_candidates" };

  const findingIds = [...new Set(candidateRows.map((row) => stringValue(row, "finding_id")).filter((id): id is string => Boolean(id)))];
  const productIds = [...new Set(candidateRows.map((row) => stringValue(row, "product_id")).filter((id): id is string => Boolean(id)))];
  const [findingResult, productResult] = await Promise.all([
    client.from("findings").select("id,title,url,regulation_ref").eq("customer_id", customerId).in("id", findingIds),
    client.from("products").select("id,sku,name").eq("customer_id", customerId).in("id", productIds),
  ]);
  if (findingResult.error || productResult.error) throw new Error("Related monitor data unavailable.");

  const findings = new Map((findingResult.data ?? []).map((row: Row) => [stringValue(row, "id"), row]));
  const products = new Map((productResult.data ?? []).map((row: Row) => [stringValue(row, "id"), row]));
  const candidates: MonitorCompanyCandidate[] = candidateRows.flatMap((row) => {
    const id = stringValue(row, "id");
    const findingId = stringValue(row, "finding_id");
    const productId = stringValue(row, "product_id");
    const matchKind = stringValue(row, "match_kind");
    if (!id || !findingId || !productId || (matchKind !== "exact_code" && matchKind !== "code_prefix")) return [];
    const finding = findings.get(findingId);
    const product = products.get(productId);
    const citations = finding
      ? [...new Set([stringValue(finding, "regulation_ref"), stringValue(finding, "url")].filter((value): value is string => Boolean(value)))]
      : [];
    return [{
      id,
      findingId,
      productId,
      matchKind,
      matchReason: stringValue(row, "match_reason") ?? "Catalogue code overlap.",
      createdAt: stringValue(row, "created_at") ?? "",
      product: product ? { sku: stringValue(product, "sku") ?? productId, name: stringValue(product, "name") ?? productId } : null,
      action: { name: finding ? stringValue(finding, "title") ?? "Monitored trade action" : "Monitored trade action", citations },
    }];
  });
  return { candidates };
}

export async function recalculateForCustomer(
  client: ReturnType<typeof createServiceClient>,
  customerId: string,
  options: RecalculationOptions,
): Promise<CustomerRecalculationResult> {
  const { data: runRow, error: runError } = await client.from("tariff_impact_runs")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!runRow) {
    return {
      customerId, findingsEvaluated: 0, eventsCreated: 0, notified: false,
      notifyDetail: "No completed impact run exists for this customer; recalculation needs a prior snapshot to compute a delta.",
      skippedReason: "no_impact_run",
    };
  }
  const runId = runRow.id as string;
  const run = await getImpactRun(customerId, runId);
  if (!run) {
    return {
      customerId, findingsEvaluated: 0, eventsCreated: 0, notified: false,
      notifyDetail: "The most recent impact run could not be read.",
      skippedReason: "run_not_found",
    };
  }

  const { candidates, skippedReason } = await loadCandidatesForRun(client, customerId, run);
  if (skippedReason) {
    return {
      customerId, findingsEvaluated: 0, eventsCreated: 0, notified: false,
      notifyDetail: skippedReason === "candidate_limit"
        ? "Too many monitored candidates to calculate safely; this pass was skipped for manual review."
        : "No monitored candidate currently links to this customer's most recent impact run.",
      skippedReason,
    };
  }

  let impacts: MonitoredCompanyImpact[];
  try {
    impacts = await buildMonitoredCompanyImpacts(candidates, run.rows, options.computer, { signal: options.signal });
  } catch (error) {
    if (error instanceof MonitorImpactLimitError) {
      return {
        customerId, findingsEvaluated: 0, eventsCreated: 0, notified: false,
        notifyDetail: `Monitored company impact coverage exceeds the safe calculation limit (${error.code}).`,
        skippedReason: "candidate_limit",
      };
    }
    throw error;
  }

  const createdIds: string[] = [];
  const newEventFindingIds: string[] = [];
  for (const impact of impacts) {
    const resultHash = impactResultHash(impact);
    const payload = {
      id: randomUUID(),
      customer_id: customerId,
      finding_id: impact.findingId,
      run_id: runId,
      action_name: impact.action.name,
      effective_date: impact.action.effectiveDate,
      citations: impact.action.citations,
      affected_product_count: impact.affectedProductCount,
      estimated_duty_delta_usd: impact.estimatedDutyDeltaUsd,
      status: impact.status,
      review_reason: impact.reviewReason,
      suppliers: impact.suppliers,
      products: impact.products,
      rows: impact.rows,
      result_hash: resultHash,
    };
    // The unique (customer_id, finding_id, result_hash) constraint is the
    // real backstop: even a retried or racing pass cannot double-insert an
    // unchanged result. `.select("id")` returns nothing for a row that
    // ON CONFLICT DO NOTHING suppressed, so an empty result reliably means
    // "already notified for this exact content", not an error.
    const { data: insertedRows, error: insertError } = await client.from("tariff_impact_events")
      .upsert(payload, { onConflict: "customer_id,finding_id,result_hash", ignoreDuplicates: true })
      .select("id");
    if (insertError) throw new Error(insertError.message);
    if (insertedRows && insertedRows.length > 0) {
      createdIds.push(insertedRows[0].id as string);
      newEventFindingIds.push(impact.findingId);
    }
  }

  if (createdIds.length === 0) {
    return {
      customerId, findingsEvaluated: impacts.length, eventsCreated: 0, notified: false,
      notifyDetail: "No materially new or changed monitored impact since the last pass; nothing to notify.",
    };
  }

  const changedImpacts = impacts.filter((impact) => newEventFindingIds.includes(impact.findingId));
  const body = formatCustomerImpactDigest(changedImpacts);
  const config = telegramConfig(options.env);
  if (!config) {
    return {
      customerId, findingsEvaluated: impacts.length, eventsCreated: createdIds.length, notified: false,
      notifyDetail: "Telegram is not configured; new events are recorded but undelivered.",
    };
  }

  try {
    await sendTelegram(config, body, { signal: options.signal });
    const { error: markError } = await client.from("tariff_impact_events")
      .update({ notified: true, notified_at: new Date().toISOString() })
      .in("id", createdIds);
    if (markError) throw new Error(markError.message);
    return {
      customerId, findingsEvaluated: impacts.length, eventsCreated: createdIds.length, notified: true,
      notifyDetail: `Sent ${createdIds.length} new/changed event(s).`,
    };
  } catch (error) {
    const detail = error instanceof TelegramError ? error.message : error instanceof Error ? error.message : "Unknown delivery error.";
    return {
      customerId, findingsEvaluated: impacts.length, eventsCreated: createdIds.length, notified: false,
      notifyDetail: `Delivery failed: ${detail}`,
    };
  }
}

async function discoverCustomersWithCandidates(client: ReturnType<typeof createServiceClient>): Promise<string[]> {
  const { data, error } = await client.from("tariff_monitor_candidates")
    .select("customer_id")
    .range(0, RECALC_MAX_CUSTOMERS * 10);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => row.customer_id as string))];
}

/**
 * The scheduled entrypoint. Resource-bounded by reusing the SAME
 * `createBoundedQueue` primitive already reviewed in
 * monitor-company-impact.ts — this is not a second, unbounded loop over
 * customers; it is the identical admission-limited scheduler applied one
 * level up, while the duty calculations inside each customer's
 * buildMonitoredCompanyImpacts call continue to share that module's own
 * process-wide duty concurrency cap regardless of how many customers run
 * at once.
 */
export async function recalculateTariffImpacts(options: RecalculationOptions = {}): Promise<RecalculationSummary> {
  const client = options.client ?? createServiceClient();
  const customerIds = options.customerIds ?? await discoverCustomersWithCandidates(client);
  const concurrency = options.customerConcurrency ?? RECALC_CUSTOMER_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > RECALC_CUSTOMER_CONCURRENCY) {
    throw new RangeError(`Customer concurrency must be an integer from 1 to ${RECALC_CUSTOMER_CONCURRENCY}.`);
  }
  const queue = createBoundedQueue(concurrency, RECALC_CUSTOMER_QUEUE_LIMIT);
  const customerResults = await Promise.all(customerIds.map((customerId) =>
    queue.run(() => recalculateForCustomer(client, customerId, options)).catch((error): CustomerRecalculationResult => ({
      customerId, findingsEvaluated: 0, eventsCreated: 0, notified: false,
      notifyDetail: `Recalculation failed: ${error instanceof Error ? error.message : "unknown error"}`,
      skippedReason: "error",
    }))));
  return { customersEvaluated: customerResults.length, customerResults };
}
