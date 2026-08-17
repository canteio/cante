import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { findings } from "@/lib/db/schema";
import { getDefaultCustomerId } from "@/lib/db/queries";
import {
  listWorkQueue,
  transition,
  workQueueSummary,
  WorkflowError,
  type ActionState,
} from "@/lib/workflow/actions";
import { assessImpact, listImpactForFinding, storeImpact } from "@/lib/impact/assess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The action workflow (item 4) joined to impact (item 5).
 *
 * They are served together because that is how the question is actually asked:
 * "what needs doing, and how much does it matter". Impact is attached
 * per-finding so a queue row carries its own exposure figures and their basis.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ queue: [], summary: {} });

  const includeResolved = url.searchParams.get("includeResolved") === "true";
  const queue = listWorkQueue(customerId, { includeResolved }).map((row) => ({
    ...row,
    impact: listImpactForFinding(row.finding.id),
  }));

  return Response.json({ queue, summary: workQueueSummary(customerId) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const customerId = (payload.customerId as string) ?? (await getDefaultCustomerId());
  if (!customerId) return Response.json({ error: "No customer." }, { status: 400 });

  const findingId = payload.findingId as string;
  if (!findingId) return Response.json({ error: "findingId is required." }, { status: 400 });

  if (payload.action === "assess") {
    const finding = db.select().from(findings).where(eq(findings.id, findingId)).get();
    if (!finding) return Response.json({ error: "Finding not found." }, { status: 404 });
    if (finding.customerId !== customerId) {
      return Response.json({ error: "That finding belongs to a different customer." }, { status: 403 });
    }

    const duty = payload.duty as { before?: number; after?: number } | undefined;
    const drafts = assessImpact({
      finding,
      customerId,
      effectiveOn: (payload.effectiveOn as string) ?? finding.enactedOn ?? null,
      duty: duty ? { before: duty.before ?? null, after: duty.after ?? null } : undefined,
    });
    return Response.json({ impact: storeImpact(customerId, findingId, drafts) });
  }

  try {
    const action = transition({
      findingId,
      customerId,
      state: payload.state as ActionState,
      assignee: payload.assignee as string | null,
      forwardedTo: payload.forwardedTo as string | null,
      dueAt: payload.dueAt as string | null,
      brokerDecision: payload.brokerDecision as string | null,
      note: payload.note as string | null,
      reopen: payload.reopen === true,
    });
    return Response.json({ action });
  } catch (error) {
    if (error instanceof WorkflowError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not update the finding." }, { status: 500 });
  }
}
