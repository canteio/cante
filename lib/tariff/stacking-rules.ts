import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@/lib/supabase/server";
import { easternIsoDate } from "@/lib/tariff/date";

/**
 * Project Mission One (see MISSION_ONE_PLAN.md).
 *
 * Deterministic, shipment-time application of stacking-exclusion rules.
 * Zero model calls live in this file -- a regulation is interpreted by AI
 * and confirmed by a human at authoring time. Drafts live in a separate table. Applying a
 * rule to one shipment or one hundred thousand is the same deterministic
 * code path below.
 *
 * Scope gating (the fix for the "thousands of ordinary imports wrongly
 * flagged" regression caught in review): a measure absent from the flagged-measure
 * registry is "unflagged" and this module does nothing --
 * stack.ts's existing default (additive stacking) is untouched. Only a
 * measure something has already flagged as carrying a possible exclusion
 * in that registry is actually evaluated here.
 */

export type StackingFacts = Record<string, boolean | string | undefined>;

export interface StackingRuleRow {
  id: string;
  action: "exclude" | "include" | "cap_at";
  capRatePercent: number | null;
  conditions: Record<string, unknown>;
  priority: number;
  citation: string;
  ruleText: string;
  effectiveDate: string | null;
  expiresDate: string | null;
  precedenceOver: string | null;
  precedenceReason: string | null;
}

export interface StackingRuleMatch {
  ruleId: string;
  action: "exclude" | "include" | "cap_at";
  capRatePercent: number | null;
  citation: string;
  explanation: string;
}

export type StackingResolution =
  | { status: "unflagged" }
  | { status: "resolved"; match: StackingRuleMatch }
  | { status: "needs_review"; reason: string };

export class StackingRulesLookupError extends Error {}

function conditionsMatch(conditions: Record<string, unknown>, facts: StackingFacts): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    if (key === "hts_prefix") {
      if (typeof facts[key] !== "string" || typeof expected !== "string" || !facts[key]!.toString().startsWith(expected)) return false;
    } else if (facts[key] !== expected) return false;
  }
  return true;
}

/**
 * Pure matching/conflict logic over already-fetched candidate rows -- no
 * network, no database, fully unit-testable. `applyStackingRules` below is
 * the only thing that talks to Supabase; everything that decides an
 * outcome lives here, where it's cheap to test exhaustively.
 */
export function resolveStackingRule(
  rows: StackingRuleRow[],
  facts: StackingFacts,
  asOfDate: string | null,
): StackingResolution {
  if (rows.length === 0) return { status: "unflagged" };

  const date = asOfDate ?? easternIsoDate();
  const active = rows.filter(
    (row) =>
      (!row.effectiveDate || row.effectiveDate <= date) &&
      (!row.expiresDate || row.expiresDate > date),
  );
  const matching = active
    .filter((row) => conditionsMatch(row.conditions, facts))
    .sort((a, b) => a.priority - b.priority);

  if (matching.length === 0) {
    return { status: "needs_review", reason: "This measure is flagged as possibly excluded, but no confirmed rule resolves this shipment's facts." };
  }

  const distinctActions = new Set(matching.map((row) => `${row.action}:${row.capRatePercent ?? ""}`));
  let winner: StackingRuleRow;
  if (distinctActions.size === 1) {
    winner = matching[0];
  } else {
    // Conflicting confirmed rules. Only acceptable if one explicitly names
    // another (already in this matching set) via precedence_over -- never
    // resolved by priority order alone. See MISSION_ONE_PLAN.md section 4,
    // "Conflict handling is a promotion-time gate, not a runtime guess."
    // A winner must dominate EVERY different outcome, through an explicit
    // acyclic precedence chain. One arbitrary link cannot settle 3+ rules.
    const dominates = (row: StackingRuleRow, other: StackingRuleRow) => {
      const visited = new Set<string>([row.id]);
      let next = row.precedenceOver;
      while (next) {
        if (visited.has(next)) return false;
        visited.add(next);
        if (next === other.id) return true;
        const parent = matching.find(candidate => candidate.id === next);
        if (!parent?.precedenceReason) return false;
        next = parent.precedenceOver;
      }
      return false;
    };
    const resolvers = matching.filter(row => row.precedenceReason && matching.every(other =>
      other.id === row.id || `${row.action}:${row.capRatePercent ?? ""}` === `${other.action}:${other.capRatePercent ?? ""}` || dominates(row, other)));
    const resolver = resolvers.length === 1 ? resolvers[0] : null;
    if (!resolver) {
      return {
        status: "needs_review",
        reason: "Multiple confirmed rules matched this measure with different outcomes without a single explicit precedence winner. Data integrity review is required.",
      };
    }
    winner = resolver;
  }

  const uncertain = active.filter(row => Object.keys(row.conditions).some(key => facts[key] === undefined)
    && Object.entries(row.conditions).every(([key, value]) => facts[key] === undefined || conditionsMatch({ [key]: value }, facts)));
  if (uncertain.some(row => `${row.action}:${row.capRatePercent ?? ""}` !== `${winner.action}:${winner.capRatePercent ?? ""}`)) {
    return { status: "needs_review", reason: "A potentially applicable rule requires shipment facts that were not supplied." };
  }
  return {
    status: "resolved",
    match: {
      ruleId: winner.id,
      action: winner.action,
      capRatePercent: winner.capRatePercent,
      citation: winner.citation,
      explanation: winner.precedenceReason
        ? `${winner.ruleText} (takes precedence over a conflicting rule: ${winner.precedenceReason})`
        : winner.ruleText,
    },
  };
}

interface RawRow {
  id: string;
  action: "exclude" | "include" | "cap_at";
  cap_rate_percent: number | string | null;
  conditions: Record<string, unknown>;
  priority: number;
  citation: string;
  rule_text: string;
  effective_date: string | null;
  expires_date: string | null;
  precedence_over: string | null;
  precedence_reason: string | null;
}

function toRuleRow(raw: RawRow): StackingRuleRow {
  return {
    id: raw.id,
    action: raw.action,
    capRatePercent: raw.cap_rate_percent === null ? null : Number(raw.cap_rate_percent),
    conditions: raw.conditions ?? {},
    priority: raw.priority,
    citation: raw.citation,
    ruleText: raw.rule_text,
    effectiveDate: raw.effective_date,
    expiresDate: raw.expires_date,
    precedenceOver: raw.precedence_over,
    precedenceReason: raw.precedence_reason,
  };
}

/**
 * Production entrypoint: fetch confirmed rules for one measure, then
 * resolve deterministically via resolveStackingRule above. A database
 * failure throws (never silently "unflagged") -- the caller must treat
 * that as unresolved, the same discipline lookupSection232Live already
 * follows for the same reason.
 */
export async function applyStackingRules(
  targetMeasure: string,
  facts: StackingFacts,
  asOfDate: string | null,
): Promise<StackingResolution> {
  let client;
  try {
    client = await createClient();
  } catch (error) {
    throw new StackingRulesLookupError(
      `Could not reach the stacking-rules store: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const fetchRules = async (): Promise<RawRow[]> => {
    const rows: RawRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("tariff_stacking_rules")
        .select("id,action,cap_rate_percent,conditions,priority,citation,rule_text,tier,effective_date,expires_date,precedence_over,precedence_reason")
        .eq("target_measure", targetMeasure).in("tier", ["human", "document"]).is("superseded_by", null)
        .order("id").range(offset, offset + 999);
      if (error) throw new StackingRulesLookupError(`Stacking-rules lookup failed: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) break;
    }
    return rows;
  };
  const scope = stackingScope.getStore();
  let pending = scope?.rules.get(targetMeasure);
  if (!pending) { pending = fetchRules(); scope?.rules.set(targetMeasure, pending); }
  const data = await pending;
  if (!data.length && (await loadStackingFlags()).has(targetMeasure)) {
    return { status: "needs_review", reason: "This measure is flagged, but no confirmed rule resolves it yet." };
  }
  return resolveStackingRule((data ?? []).map(toRuleRow), facts, asOfDate);
}

export type StackingRulesLookupFn = typeof applyStackingRules;

// A consistent reference snapshot per portfolio evaluation. Each measure
// reads its rules once per upload; another request sees fresh confirmations.
const stackingScope = new AsyncLocalStorage<{ flags?: Promise<Set<string>>; rules: Map<string, Promise<RawRow[]>> }>();
export function withStackingRulesCache<T>(work: () => Promise<T>): Promise<T> {
  if (stackingScope.getStore()) return work();
  return stackingScope.run({ rules: new Map() }, work);
}
export async function loadStackingFlags(): Promise<Set<string>> {
  const scope = stackingScope.getStore();
  if (scope?.flags) return scope.flags;
  const read = async () => {
    const client = await createClient();
    const flags = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("tariff_stacking_flagged_measures")
        .select("target_measure").order("target_measure").range(offset, offset + 999);
      if (error) throw new StackingRulesLookupError(`Flagged-measure registry failed: ${error.message}`);
      for (const row of data ?? []) flags.add(row.target_measure);
      if ((data?.length ?? 0) < 1000) break;
    }
    return flags;
  };
  const pending = read();
  if (scope) scope.flags = pending;
  return pending;
}
