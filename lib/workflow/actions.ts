import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { findingActions, findings, type Finding, type FindingAction } from "@/lib/db/schema";

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

const STATES = new Set<ActionState>([
  "new",
  "acknowledged",
  "assigned",
  "forwarded_to_broker",
  "evidence_requested",
  "irrelevant",
  "closed",
]);

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

export function getAction(findingId: string): FindingAction | undefined {
  return db.select().from(findingActions).where(eq(findingActions.findingId, findingId)).get();
}

export function transition(input: TransitionInput): FindingAction {
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
  const finding = db.select().from(findings).where(eq(findings.id, input.findingId)).get();
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
  const existing = getAction(input.findingId);

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
    db.update(findingActions).set(values).where(eq(findingActions.id, existing.id)).run();
    return { ...existing, ...values };
  }

  const row = {
    id: randomUUID(),
    findingId: input.findingId,
    customerId: input.customerId,
    ...values,
    createdAt: now,
  };
  db.insert(findingActions).values(row).run();
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
export function listWorkQueue(
  customerId: string,
  options: { includeResolved?: boolean; now?: Date } = {},
): FindingWithAction[] {
  const now = options.now ?? new Date();
  const rows = db
    .select()
    .from(findings)
    .where(eq(findings.customerId, customerId))
    .orderBy(desc(findings.createdAt))
    .all()
    .filter((f) => f.relevance === "flagged" || f.relevance === "noted");

  const actions = new Map(
    db
      .select()
      .from(findingActions)
      .where(eq(findingActions.customerId, customerId))
      .all()
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
export function workQueueSummary(customerId: string): Record<ActionState, number> {
  const summary: Record<ActionState, number> = {
    new: 0,
    acknowledged: 0,
    assigned: 0,
    forwarded_to_broker: 0,
    evidence_requested: 0,
    irrelevant: 0,
    closed: 0,
  };
  for (const row of listWorkQueue(customerId, { includeResolved: true })) {
    summary[row.state] += 1;
  }
  return summary;
}

/** Findings a given person owns right now. */
export function listAssignedTo(customerId: string, assignee: string): FindingWithAction[] {
  return listWorkQueue(customerId).filter(
    (row) => row.action?.assignee?.toLowerCase() === assignee.toLowerCase(),
  );
}

export function deleteAction(customerId: string, findingId: string): boolean {
  const existing = db
    .select()
    .from(findingActions)
    .where(and(eq(findingActions.customerId, customerId), eq(findingActions.findingId, findingId)))
    .get();
  if (!existing) return false;
  db.delete(findingActions).where(eq(findingActions.id, existing.id)).run();
  return true;
}
