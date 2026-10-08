// Supabase Edge Function: scheduled proactive tariff-impact recalculation.
//
// Thin trigger only: calls the authenticated Next.js API route
// app/api/internal/tariff-recalculate/route.ts, which runs the real,
// already-reviewed lib/tariff/recalculate-customer-impacts.ts logic. Unlike
// hts-revision-check, this function does NOT reimplement the business
// logic in Deno — recalculation chains through the full duty-calculation
// stack (live Section 232 lookups, Section 301/338 stacking, the bounded
// per-customer/per-candidate queues reviewed in monitor-company-impact.ts),
// and re-deriving that in Deno would risk real calculation drift between
// the dashboard and the scheduled job. One implementation, called two ways.
//
// Invoked on a recurring cadence by a pg_cron job (see
// supabase/migrations/*_tariff_impact_recalculate_cron.sql) via pg_net's
// http_post, so this never depends on a human or coding agent remembering
// to run `npm run tariff:recalculate`.
//
// Auth to the Next.js route: a shared secret (TARIFF_RECALC_SHARED_SECRET)
// sent as `Authorization: Bearer ...`, matching the exact pattern the
// Next.js route itself documents and hts-revision-check already
// established for its own upstream call. The pg_cron job reads that same
// secret out of Supabase Vault, never hardcoding it in migration SQL.

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  try {
    const expected = Deno.env.get("TARIFF_RECALC_CRON_SHARED_SECRET");
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    if (!expected || !timingSafeEqual(provided, expected)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = Deno.env.get("TARIFF_RECALC_TARGET_URL");
    const targetSecret = Deno.env.get("TARIFF_RECALC_SHARED_SECRET");
    if (!targetUrl || !targetSecret) {
      throw new Error("TARIFF_RECALC_TARGET_URL and TARIFF_RECALC_SHARED_SECRET secrets are required");
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${targetSecret}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(110_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Recalculation route HTTP ${response.status}: ${body.slice(0, 500)}`);

    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("tariff-impact-recalculate failed:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
