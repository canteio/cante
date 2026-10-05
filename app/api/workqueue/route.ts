import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

import { getCustomerWithProfile, resolveCustomerId } from "@/lib/db/queries";
import {
  listWorkQueue,
  transition,
  workQueueSummary,
  WorkflowError,
  type ActionState,
} from "@/lib/workflow/actions";
import {
  assessImpact,
  enrichDraftsWithTariff,
  listImpactForFinding,
  storeImpact,
} from "@/lib/impact/assess";
import { generateActionDrafts } from "@/lib/workflow/draft";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The action workflow (item 4) joined to impact (item 5) and action drafts.
 *
 * They are served together because that is how the question is actually asked:
 * "what needs doing, how much does it matter, and what do I say to my broker/supplier".
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeResolvedParam = url.searchParams.get("includeResolved");
  // A mistyped filter must not silently hide resolved tasks from an agent.
  if (includeResolvedParam !== null && includeResolvedParam !== "true" && includeResolvedParam !== "false") {
    return Response.json(
      { error: "includeResolved must be 'true' or 'false'; omit it to hide resolved tasks." },
      { status: 400 },
    );
  }
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  if (!customerId) return Response.json({ queue: [], summary: {} });

  const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
  const target = await getCustomerWithProfile(customerId);
  const includeResolved = includeResolvedParam === "true";
  const queue = await Promise.all((await listWorkQueue(customerId, { includeResolved })).map(async (row) => ({
    ...row,
    impact: await listImpactForFinding(row.finding.id),
    drafts: generateActionDrafts(
      {
        customerName: target?.customer.name ?? "Customer",
        productDescription: target?.profile.productDescription ?? "Industrial Manufacturing",
        regulationRef: row.finding.regulationRef ?? row.finding.title,
        title: row.finding.title,
        sideOfTrade: (target?.profile.sideOfTrade as any) ?? "import",
      },
      jurisdiction,
    ),
  })));

  return Response.json({ queue, summary: await workQueueSummary(customerId) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  // Valid JSON can still be null or a scalar; reject it before customer lookup
  // so agent clients receive a repairable 400 instead of an unhandled 500.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "Request body must be a JSON object containing findingId and state, or findingId and action: 'assess'." },
      { status: 400 },
    );
  }
  const payload = body as Record<string, unknown>;
  const customerId = await resolveCustomerId(payload.customerId as string | undefined);
  // Human/agent-fixable-error audit (final sweep): tell the caller exactly what
  // to pass instead of a bare "No customer." — matches products/lanes/suppliers/etc.
  if (!customerId) {
    return Response.json(
      { error: "No customer could be resolved. Pass a valid `customerId` in the JSON request body, or omit it to use the default customer if one exists." },
      { status: 400 }
    );
  }

  const findingId = payload.findingId as string;
  if (!findingId) return Response.json({ error: "findingId is required." }, { status: 400 });

  if (payload.action === "assess") {
    const supabase = await createClient();
    const finding = (cloudResult<typeof Schema.findings.$inferSelect | null>(
      await supabase
        .from("findings")
        .select("*")
        .eq("id", findingId)
        .limit(1)
        .maybeSingle(),
    ) ?? undefined);
    if (!finding) return Response.json({ error: "Finding not found." }, { status: 404 });
    if (finding.customerId !== customerId) {
      return Response.json({ error: "That finding belongs to a different customer." }, { status: 403 });
    }

    const duty = payload.duty as { before?: number; after?: number; } | undefined;
    const drafts = await assessImpact({
      finding,
      customerId,
      effectiveOn: (payload.effectiveOn as string) ?? finding.enactedOn ?? null,
      duty: duty ? { before: duty.before ?? null, after: duty.after ?? null } : undefined,
    });
    // Resolve real duty rates before storing, so the queue shows the money.
    const enriched = await enrichDraftsWithTariff(drafts);
    return Response.json({ impact: await storeImpact(customerId, findingId, enriched) });
  }

  try {
    const action = await transition({
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

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
