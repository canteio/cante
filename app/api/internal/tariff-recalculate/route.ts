import { createServiceClient } from "@/lib/supabase/service";
import { recalculateTariffImpacts, recalculationFailed } from "@/lib/tariff/recalculate-customer-impacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared-secret entrypoint on the trusted Next.js worker. Supabase's Edge
 * trigger targets this worker, never Vercel: the service key remains local.
 * Uses the same calculation path as the dashboard and reports incomplete work
 * as a failed scheduled pass. Set TARIFF_RECALC_SHARED_SECRET on the worker
 * and the Edge Function's outbound configuration. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.TARIFF_RECALC_SHARED_SECRET;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !timingSafeEqual(provided, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // The service secret belongs to the trusted worker, never the hosted app.
  if (process.env.VERCEL) {
    return Response.json({ error: "Recalculation runs on the trusted worker. Configure the scheduler's target URL for that worker." }, { status: 409 });
  }

  try {
    const client = createServiceClient();
    const summary = await recalculateTariffImpacts({ client, signal: request.signal });
    // Deliberately omit the per-customer `results` array (customerId +
    // activity) from the HTTP response: this endpoint is reachable from
    // the public internet behind a single shared secret, so a leaked
    // secret must only ever yield aggregate counts, never a cross-tenant
    // customer-ID + activity listing for the whole platform. Full
    // per-customer detail is still logged server-side by the calling
    // script/Edge Function via console.log, for operational visibility.
    console.log("tariff-recalculate results:", JSON.stringify(summary.customerResults));
    if (request.signal.aborted) return Response.json({ error: "Recalculation request was cancelled." }, { status: 499 });
    const failures = summary.customerResults.filter(recalculationFailed).length;
    return Response.json({
      customersEvaluated: summary.customersEvaluated,
      eventsCreated: summary.customerResults.reduce((sum, r) => sum + r.eventsCreated, 0),
      failures,
    }, { status: failures ? 503 : 200 });
  } catch (error) {
    if (request.signal.aborted) {
      return Response.json({ error: "Recalculation request was cancelled." }, { status: 499 });
    }
    console.error("tariff-recalculate internal route failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Recalculation failed." }, { status: 500 });
  }
}
