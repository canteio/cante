import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type Finding, type FindingAction } from "@/lib/db/schema";

/**
 * The action workflow — item 4.
 *
 * Deliberately a separate table from `findings`. A finding is what the monitor
 * observed on a given day and has to stay immutable evidence; this is the
 * mutable human response to it. Merging them would let a workflow click rewrite
 * the monitoring record, and "what did we know on the 14th" would stop being
 * answerable.
 *
 * The state machine is small and one-way-ish on purpose. Every transition
 * records who and when, because the value of this table is the audit trail, not
 * the current state.
 */

export type ActionState =
  | "new"
  | "acknowledged"
  | "assigned"
  | "forwarded_to_broker"
  | "evidence_requested"
  | "irrelevant"
  | "closed";

// Exported as an ordered array (not just the Set below) so lib/workflow/openapi.ts
// can build the /api/workqueue OpenAPI enum/summary schema from the single
// source of truth instead of hand-duplicating the state list a second time —
// the exact drift risk the monitor's openapi.ts header already warns about.
export const STATES_LIST: ActionState[] = [
  "new",
  "acknowledged",
  "assigned",
  "forwarded_to_broker",
  "evidence_requested",
  "irrelevant",
  "closed",
];

const STATES = new Set<ActionState>(STATES_LIST);

/** Terminal states cannot be left except by explicitly reopening. */
const TERMINAL = new Set<ActionState>(["irrelevant", "closed"]);

export class WorkflowError extends Error {
  readonly status = 400;
}

export interface TransitionInput {
  findingId: string;
  customerId: string;
  state: ActionState;
  assignee?: string | null;
  forwardedTo?: string | null;
  dueAt?: string | null;
  brokerDecision?: string | null;
  note?: string | null;
  /** Allow leaving a terminal state; requires an explicit caller decision. */
  reopen?: boolean;
}

export async function getAction(findingId: string): Promise<FindingAction | undefined> {
  const supabase = await createClient();
  return (cloudResult<typeof Schema.findingActions.$inferSelect | null>(
    await supabase
      .from("finding_actions")
      .select("*")
      .eq("finding_id", findingId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
}

export async function transition(input: TransitionInput): Promise<FindingAction> {
  const supabase = await createClient();
  if (!STATES.has(input.state)) {
    // Agent-usability audit: an AI client guessing at the state enum only
    // learns it guessed wrong, not what the right values are. List them so
    // the caller can self-correct without reading source, matching the
    // "describe the expected shape" pattern already used by the JSON-body
    // guards on /api/workqueue and /api/llm.
    throw new WorkflowError(
      `Unknown state "${input.state}". Valid states: ${Array.from(STATES).join(", ")}.`,
    );
  }
  const finding = (cloudResult<typeof Schema.findings.$inferSelect | null>(
    await supabase
      .from("findings")
      .select("*")
      .eq("id", input.findingId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!finding) throw new WorkflowError("Finding not found.");
  if (finding.customerId !== input.customerId) {
    throw new WorkflowError("That finding belongs to a different customer.");
  }
  if (input.state === "assigned" && !input.assignee?.trim()) {
    throw new WorkflowError("Assigning requires an assignee.");
  }
  if (input.state === "forwarded_to_broker" && !input.forwardedTo?.trim()) {
    throw new WorkflowError("Forwarding requires a recipient.");
  }
  if (input.state === "irrelevant" && !input.note?.trim()) {
    // Dismissal is the one transition that destroys information, so it costs a
    // sentence. Without this, "irrelevant" becomes the default click and the
    // reason it was irrelevant is lost.
    throw new WorkflowError("Marking a finding irrelevant requires a reason.");
  }

  const now = new Date().toISOString();
  const existing = await getAction(input.findingId);

  if (existing && TERMINAL.has(existing.state as ActionState) && !input.reopen) {
    throw new WorkflowError(
      `This finding is already ${existing.state}. Pass reopen to change it.`,
    );
  }

  const values = {
    state: input.state,
    assignee: input.assignee?.trim() ?? existing?.assignee ?? null,
    forwardedTo: input.forwardedTo?.trim() ?? existing?.forwardedTo ?? null,
    dueAt: input.dueAt ?? existing?.dueAt ?? null,
    brokerDecision: input.brokerDecision?.trim() ?? existing?.brokerDecision ?? null,
    brokerDecidedAt: input.brokerDecision?.trim()
      ? now
      : (existing?.brokerDecidedAt ?? null),
    note: input.note?.trim() ?? existing?.note ?? null,
    closedAt: TERMINAL.has(input.state) ? now : null,
    updatedAt: now,
  };

  if (existing) {
    cloudResult(
      await supabase
        .from("finding_actions")
        .update(snakeRow(values))
        .eq("id", existing.id),
    );
    return { ...existing, ...values };
  }

  const row = {
    id: randomUUID(),
    findingId: input.findingId,
    customerId: input.customerId,
    ...values,
    createdAt: now,
  };
  cloudResult(
    await supabase
      .from("finding_actions")
      .insert(snakeRow(row)),
  );
  return row as FindingAction;
}

export interface FindingWithAction {
  finding: Finding;
  action: FindingAction | null;
  /** Effective state — an untouched finding is `new`, not "no row". */
  state: ActionState;
  overdue: boolean;
}

/**
 * The work queue. Findings the monitor flagged, joined to whatever a human has
 * done about them, with untouched ones surfacing as `new` rather than absent.
 */
export async function listWorkQueue(
  customerId: string,
  options: { includeResolved?: boolean; now?: Date; } = {},
): Promise<FindingWithAction[]> {
  const supabase = await createClient();
  const now = options.now ?? new Date();
  const rows = cloudResult<Array<typeof Schema.findings.$inferSelect>>(
    await supabase
      .from("findings")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
  )
    .filter((f) => f.relevance === "flagged" || f.relevance === "noted");

  const actions = new Map(
    cloudResult<Array<typeof Schema.findingActions.$inferSelect>>(
      await supabase
        .from("finding_actions")
        .select("*")
        .eq("customer_id", customerId),
    )
      .map((a) => [a.findingId, a]),
  );

  return rows
    .map((finding) => {
      const action = actions.get(finding.id) ?? null;
      const state = (action?.state ?? "new") as ActionState;
      return {
        finding,
        action,
        state,
        overdue: Boolean(
          action?.dueAt && !TERMINAL.has(state) && new Date(action.dueAt).getTime() < now.getTime(),
        ),
      };
    })
    .filter((row) => options.includeResolved || !TERMINAL.has(row.state));
}

/** Counts for the dashboard, including the untouched backlog. */
export async function workQueueSummary(customerId: string): Promise<Record<ActionState, number>> {
  const summary: Record<ActionState, number> = {
    new: 0,
    acknowledged: 0,
    assigned: 0,
    forwarded_to_broker: 0,
    evidence_requested: 0,
    irrelevant: 0,
    closed: 0,
  };
  for (const row of await listWorkQueue(customerId, { includeResolved: true })) {
    summary[row.state] += 1;
  }
  return summary;
}

/** Findings a given person owns right now. */
export async function listAssignedTo(customerId: string, assignee: string): Promise<FindingWithAction[]> {
  return (await listWorkQueue(customerId)).filter(
    (row) => row.action?.assignee?.toLowerCase() === assignee.toLowerCase(),
  );
}

export async function deleteAction(customerId: string, findingId: string): Promise<boolean> {
  const supabase = await createClient();
  const existing = (cloudResult<typeof Schema.findingActions.$inferSelect | null>(
    await supabase
      .from("finding_actions")
      .select("*")
      .eq("customer_id", customerId)
      .eq("finding_id", findingId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!existing) return false;
  cloudResult(
    await supabase
      .from("finding_actions")
      .delete()
      .eq("id", existing.id),
  );
  return true;
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
