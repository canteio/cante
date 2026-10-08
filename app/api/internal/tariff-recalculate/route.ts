import { createServiceClient } from "@/lib/supabase/service";
import { recalculateTariffImpacts } from "@/lib/tariff/recalculate-customer-impacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal, non-interactive entrypoint for the proactive tariff-impact
 * recalculation pass (lib/tariff/recalculate-customer-impacts.ts), invoked
 * by the tariff-impact-recalculate Edge Function on a recurring schedule
 * (see supabase/functions/tariff-impact-recalculate/index.ts and
 * supabase/migrations/*_tariff_impact_recalculate_cron.sql).
 *
 * This route exists, rather than porting the recalculation logic itself to
 * Deno, because that logic chains through computeStackedDuty's full
 * already-reviewed duty-calculation stack (live Section 232 lookups,
 * static-table fallback, Section 301/338 stacking) — reimplementing that in
 * Deno would risk the exact kind of drift the HTS Edge Function's own
 * comments warn against for ingestion logic, except here the stakes are a
 * silently wrong dollar figure, not a stale schedule. Running the real,
 * already-tested Node code through an authenticated HTTP bridge keeps
 * exactly one implementation of the calculation path, in both the
 * dashboard and the scheduled notification job.
 *
 * Auth: a constant-time shared-secret header, matching the pattern already
 * established and reviewed for hts-revision-check's Edge Function — NOT
 * cookie/session auth, since this is called by Supabase's pg_cron/pg_net,
 * not a logged-in browser. The secret is read from
 * TARIFF_RECALC_SHARED_SECRET and must be set as both a Vercel environment
 * variable and a Supabase Vault secret (see the migration's comments); a
 * missing or mismatched secret fails closed with 401, never silently skips
 * auth.
 */
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
    return Response.json({
      customersEvaluated: summary.customersEvaluated,
      eventsCreated: summary.customerResults.reduce((sum, r) => sum + r.eventsCreated, 0),
      failures: summary.customerResults.filter((r) => r.skippedReason === "error").length,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return Response.json({ error: "Recalculation request was cancelled." }, { status: 499 });
    }
    console.error("tariff-recalculate internal route failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Recalculation failed." }, { status: 500 });
  }
}
