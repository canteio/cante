import { executeVerifiedCheck } from "./execute";
import { timingSafeEqual } from "node:crypto";
import { boundedRequest } from "@/app/api/request-body";
import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isArchiveId, readLiveCheckArchive, finishLiveCheckArchive, failLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import { type LiveSource } from "@/app/api/tariff/live-check/check";
import { dispatchSignature } from "@/app/api/tariff/live-check/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const active = new Set<string>();

/** This route runs only on a separate trusted worker. Every dispatch comes
 * through the hosted shared DB admission guard, is signed, and retains the
 * user's session/RLS. The service client can only add the execution proof. */
export async function POST(request: Request) {
  if ((process.env.VERCEL && process.env.CANTE_DEPLOYMENT_ROLE !== "trusted-check-worker") || process.env.CANTE_TRUSTED_CHECK_WORKER !== "true") return Response.json({ error: "This endpoint requires a separate trusted checking worker." }, { status: 409 });
  const secret = process.env.CANTE_CHECK_DISPATCH_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "Worker dispatch is not configured." }, { status: 503 });
  let body: string;
  try { body = await (await boundedRequest(request, 1024)).text(); }
  catch { return Response.json({ error: "Invalid dispatch body." }, { status: 413 }); }
  const timestamp = request.headers.get("x-cante-dispatched-at") ?? "";
  const signature = request.headers.get("x-cante-dispatch-signature") ?? "";
  const expected = dispatchSignature(secret, timestamp, body, request.headers.get("authorization") ?? request.headers.get("cookie") ?? "");
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return Response.json({ error: "Unauthorized dispatch." }, { status: 401 });
  let input: { checkId: string; customerId: string };
  try { input = JSON.parse(body); if (!isArchiveId(input.checkId) || !isArchiveId(input.customerId)) throw Error(); }
  catch { return Response.json({ error: "Invalid check identity." }, { status: 400 }); }
  const db = await createRequestClient();
  const { data: identity, error: identityError } = await db.auth.getUser();
  const workspace = await getAuthenticatedWorkspace(input.customerId);
  if (identityError || !identity.user || !workspace || workspace.userId !== identity.user.id || workspace.role === "viewer") return Response.json({ error: "Write access required." }, { status: 403 });
  const saved = await readLiveCheckArchive(db, workspace.customerId, input.checkId);
  if (!saved || saved.record.actor_id !== identity.user.id) return Response.json({ error: "Check not found." }, { status: 404 });
  if (saved.events.some(e => e.kind === "completed" || e.kind === "failed") || active.has(input.checkId)) return Response.json({ error: "Check already started or finished. Start a new check to retry." }, { status: 409 });
  if (active.size >= 3) return Response.json({ error: "Checking worker is busy." }, { status: 503 });
  let service: ReturnType<typeof createServiceClient>;
  try { service = createServiceClient(); } catch { return Response.json({ error: "Trusted verification is unavailable." }, { status: 503 }); }
  active.add(input.checkId);
  const abort = new AbortController(); const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(270_000)]);
  let cancelled = false; let sources: LiveSource[] = [];
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try {
        const result = await executeVerifiedCheck(db, service, workspace.customerId, input.checkId, saved, signal,
          message => send({ type: "progress", message }), captured => { sources = captured; },
          result => finishLiveCheckArchive(db, workspace.customerId, input.checkId, result));
        send({ type: "done", checkId: input.checkId, verified: true, result: { ...result, sources: result.sources.map(source => ({ ...source, body: null })) } });
      } catch {
        try { await failLiveCheckArchive(db, workspace.customerId, input.checkId, "Trusted check did not finish or its execution proof could not be saved. No verified result is claimed.", sources); } catch { /* A completed but unattested record remains explicitly unverified. */ }
        send({ type: "error", error: "Trusted check could not finish or be verified. Review its saved status and run a new check to retry." });
      } finally { active.delete(input.checkId); if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; abort.abort(); },
  }), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
