import { NextResponse } from "next/server";
import { getRunHistory, resolveCustomerId } from "@/lib/db/queries";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
// The judgment stage shells out to the Claude Code CLI and can run for
// minutes. Never statically evaluate this route.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/checks — run history for a customer. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = await resolveCustomerId(url.searchParams.get("customerId"));
  const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
  if (!customerId) {
    return NextResponse.json({ error: "No accessible customer workspace." }, { status: 404 });
  }
  return NextResponse.json({
    customerId,
    jurisdiction,
    runs: await getRunHistory(customerId, 30, jurisdiction),
  });
}

/** Checks remain a trusted-worker operation, independent of storage configuration. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Checks run on the trusted worker and persist results in Supabase." },
    { status: 409 },
  );
}
