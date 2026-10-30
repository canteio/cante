import { loadWorkspaceSnapshot } from "../workspace-data";
import { withRequestLimit } from "@/app/api/request-limits";
import {
  createRequestClient,
  getAuthenticatedWorkspace,
} from "@/lib/supabase/server";
import {
  beginLiveCheckArchive,
  readLiveCheckArchive,
  failLiveCheckArchive,
} from "@/lib/tariff/business-impact-store";
import { type LiveSource } from "../live-check/check";
import { executeArchivedCheck } from "../live-check/execute";
import { checkWorkerConfigured } from "../live-check/worker-client";
import remedyContract from "@/config/tariff-remedy-contract.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "cache-control": "private, no-store" };

/** A click refreshes the latest original file, including its missing facts.
 * It never substitutes a sample, older upload, or a separate impact snapshot. */
export async function POST(request: Request) {
  return withRequestLimit(request, "check", 1024, async (bounded) => {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace)
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (workspace.role === "viewer")
      return Response.json(
        { error: "Write access required." },
        { status: 403 },
      );
    const db = await createRequestClient();
    let snapshot;
    try {
      snapshot = await loadWorkspaceSnapshot(db, workspace.customerId);
    } catch (failure) {
      return Response.json(
        {
          error:
            failure instanceof Error
              ? failure.message
              : "Could not load saved products.",
        },
        { status: 503 },
      );
    }
    if (!snapshot.count)
      return Response.json(
        {
          error: "Add products to your dashboard first.",
          uploadRequired: true,
        },
        { status: 409 },
      );
    let checkId: string;
    try {
      checkId = await beginLiveCheckArchive(
        db,
        workspace.customerId,
        snapshot.csv,
        "Saved products.csv",
        {},
        {
          contract: remedyContract,
          workflow: "workspace-refresh-v1",
          build:
            process.env.VERCEL_GIT_COMMIT_SHA ??
            process.env.CANTE_BUILD_REVISION ??
            "unversioned-working-tree",
        },
      );
    } catch {
      return Response.json(
        { error: "Could not save the product snapshot. No check ran." },
        { status: 503 },
      );
    }
    const products = snapshot.products;
    const abort = new AbortController();
    const signal = AbortSignal.any([
      bounded.signal,
      abort.signal,
      AbortSignal.timeout(275_000),
    ]);
    const encoder = new TextEncoder();
    let cancelled = false;
    let sources: LiveSource[] = [];
    return new Response(
      new ReadableStream({
        async start(controller) {
          const send = (event: unknown) => {
            if (!cancelled)
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          };
          try {
            send({ type: "started", checkId });
            const result = await executeArchivedCheck(
              db,
              workspace.customerId,
              checkId,
              products,
              signal,
              (message) => send({ type: "progress", message }),
              (captured) => {
                sources = captured;
              },
            );
            signal.throwIfAborted();
            send({ type: "done", checkId, result, archived: true });
          } catch {
            let message =
              "The check did not finish. No completed result is claimed.";
            try {
              await failLiveCheckArchive(
                db,
                workspace.customerId,
                checkId,
                message,
                sources,
              );
            } catch {
              message += " Review the saved status in history.";
            }
            send({ type: "error", checkId, error: message });
          } finally {
            if (!cancelled) controller.close();
          }
        },
        cancel() {
          cancelled = true;
          abort.abort();
        },
      }),
      { headers: { "content-type": "application/x-ndjson", ...headers } },
    );
  });
}

export async function GET() {
  const workspace = await getAuthenticatedWorkspace();
  if (!workspace)
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers },
    );
  const db = await createRequestClient();
  const { data, error } = await db
    .from("tariff_check_records")
    .select("id,filename,created_at")
    .eq("customer_id", workspace.customerId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error)
    return Response.json(
      { error: "Could not read the latest file check." },
      { status: 503, headers },
    );
  const [catalogue, legacy] = await Promise.all([
    db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", workspace.customerId)
      .eq("active", true),
    db
      .from("check_runs")
      .select("id,status,started_at,completed_at")
      .eq("customer_id", workspace.customerId)
      .eq("jurisdiction", "United States")
      .order("started_at", { ascending: false })
      .limit(50),
  ]);
  if (catalogue.error)
    return Response.json(
      { error: "Could not load your saved products." },
      { status: 503, headers },
    );
  const latest = data?.[0] ?? null;
  const oldFindings = legacy.data?.[0]
    ? await db
        .from("findings")
        .select("id,title,url,summary_en,relevance")
        .eq("customer_id", workspace.customerId)
        .eq("check_run_id", legacy.data[0].id)
        .in("relevance", ["flagged", "noted"])
        .order("id")
        .limit(50)
    : { data: [], error: null };
  try {
    const saved = latest
      ? await readLiveCheckArchive(db, workspace.customerId, latest.id)
      : null;
    const terminal = saved?.events.find(
      (e) => e.kind === "completed" || e.kind === "failed",
    );
    return Response.json(
      {
        latest,
        status: terminal?.kind ?? (latest ? "incomplete" : "no_upload"),
        canWrite: workspace.role !== "viewer",
        productCount: catalogue.count ?? 0,
        legacyChecks: legacy.data ?? [],
        legacyFindings: oldFindings.data ?? [],
        legacyError:
          legacy.error || oldFindings.error
            ? "Previous notice-check evidence could not be fully loaded."
            : null,
        checkingAvailable:
          Boolean(catalogue.count) && workspace.role !== "viewer",
        verified: saved?.provenance.status === "verified",
        result: saved?.verifiedResult ?? null,
        workerConfigured: checkWorkerConfigured(),
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Could not verify the latest saved check." },
      { status: 503, headers },
    );
  }
}
