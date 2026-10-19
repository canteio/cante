import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runCheck } from "@/lib/checks/run";
import { recalculateForCustomer } from "@/lib/tariff/recalculate-customer-impacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The manual "Check for updates" button — the replacement for a cron job
 * while there's one pilot customer. Same two real stages a schedule would
 * run, just triggered by a click instead of a timer:
 *   1. runCheck() fetches official US sources and judges them (lib/checks/run.ts) —
 *      deployable here because CANTE_LLM=api routes this through the hosted
 *      provider, not the local Claude Code CLI /api/checks was blocked on.
 *   2. recalculateForCustomer() matches any new finding against this
 *      customer's real catalogue and records the real, non-fabricated impact
 *      (lib/tariff/monitor-company-impact.ts) — the same engine the
 *      dashboard already renders.
 * Scoped to the signed-in customer only; a real schedule across many
 * customers is a later decision, not this one.
 *
 * Streams newline-delimited JSON instead of one silent wait: each line is
 * written right before/after a real await below, so every message marks an
 * actual stage boundary that happened in that order — not a fake animated
 * progress bar. runCheck() itself has no internal progress hook (it wasn't
 * built with one, and adding one means touching widely-used, already-tested
 * code), so this is coarse — two real stages, not per-source granularity.
 */
export async function POST(request: Request) {
  const workspace = await getAuthenticatedWorkspace();
  if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (workspace.role === "viewer") return Response.json({ error: "Write access required." }, { status: 403 });

  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Official-source checking requires the trusted worker, which is not connected to this deployment. No check was run." }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        send({ type: "progress", message: "Checking official U.S. sources (Federal Register, CBP, USITC, USTR)…" });
        const { runId, coverageCaveats } = await runCheck(workspace.customerId, undefined, "United States");
        if (request.signal.aborted) { send({ type: "error", error: "Check cancelled." }); controller.close(); return; }
        send({ type: "progress", message: "Matching results against your products…" });
        const recalc = await recalculateForCustomer(createServiceClient(), workspace.customerId, { signal: request.signal });
        send({
          type: "done",
          checkedAt: new Date().toISOString(),
          runId,
          coverageCaveats,
          findingsEvaluated: recalc.findingsEvaluated,
          eventsCreated: recalc.eventsCreated,
          notifyDetail: recalc.notifyDetail,
        });
      } catch (error) {
        send({ type: "error", error: request.signal.aborted ? "Check cancelled." : error instanceof Error ? error.message : "Could not check for updates." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}


/** Last real check, its findings and coverage evidence, scoped to this workspace. */
export async function GET() {
  const workspace = await getAuthenticatedWorkspace();
  if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
  const db = await createRequestClient();
  const { data: run, error } = await db.from("check_runs").select("id,status,started_at,completed_at")
    .eq("customer_id", workspace.customerId).eq("jurisdiction", "United States")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return Response.json({ error: "Could not read the latest check." }, { status: 502 });
  const checkingAvailable = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) && workspace.role !== "viewer";
  if (!run) return Response.json({ run: null, findings: [], coverageNotes: null, checkingAvailable });
  const [findings, alerts, sources] = await Promise.all([
    db.from("findings").select("id,title,url,summary_en,relevance,reasoning")
      .eq("customer_id", workspace.customerId).eq("check_run_id", run.id).in("relevance", ["flagged", "noted"])
      .order("id").limit(51),
    db.from("alerts").select("body").eq("customer_id", workspace.customerId).eq("check_run_id", run.id).limit(1).maybeSingle(),
    db.from("source_results").select("success,error_message,entries_parsed,parse_warning")
      .eq("check_run_id", run.id).limit(1000),
  ]);
  if (findings.error || alerts.error || sources.error) return Response.json({ error: "Could not read check evidence." }, { status: 502 });
  const body: string = alerts.data?.body ?? "";
  const marker = "Coverage notes:\n";
  const start = body.lastIndexOf(marker);
  return Response.json({
    checkingAvailable, run, findings: findings.data?.slice(0, 50) ?? [], moreFindings: (findings.data?.length ?? 0) > 50,
    coverageNotes: start < 0 ? null : body.slice(start + marker.length),
    failedSources: sources.data?.filter(row => !row.success).length ?? 0,
    emptySources: sources.data?.filter(row => row.success && row.entries_parsed === 0).length ?? 0,
    sourceCount: sources.data?.length ?? 0,
  });
}
