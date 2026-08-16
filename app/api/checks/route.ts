import { NextResponse } from "next/server";
import { runCheck } from "@/lib/checks/run";
import { getDefaultCustomerId, getRunHistory } from "@/lib/db/queries";
import { normalizeProviderChoice, PROVIDER_COOKIE } from "@/lib/llm";
import { normalizeJurisdiction } from "@/lib/countries";

export const runtime = "nodejs";
// The judgment stage shells out to the Claude Code CLI and can run for
// minutes. Never statically evaluate this route.
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** GET /api/checks — run history for a customer. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? (await getDefaultCustomerId());
  const jurisdiction = normalizeJurisdiction(url.searchParams.get("country"));
  if (!customerId) {
    return NextResponse.json({ error: "No customers. Run `npm run db:seed`." }, { status: 404 });
  }
  return NextResponse.json({
    customerId,
    jurisdiction,
    runs: await getRunHistory(customerId, 30, jurisdiction),
  });
}

/** POST /api/checks — trigger a check run. A scheduler can call this unchanged. */
export async function POST(request: Request) {
  let customerId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    customerId = body.customerId ?? (await getDefaultCustomerId());
    if (!customerId) {
      return NextResponse.json({ error: "No customers. Run `npm run db:seed`." }, { status: 404 });
    }

    const cookieProvider = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === PROVIDER_COOKIE)?.[1];
    const providerChoice = normalizeProviderChoice(body.provider ?? cookieProvider);
    const jurisdiction = normalizeJurisdiction(body.country);

    const { runId } = await runCheck(customerId, providerChoice, jurisdiction);
    return NextResponse.json({ ok: true, runId, jurisdiction });
  } catch (err) {
    // The run row is already marked failed with this message by runCheck; the
    // response says so plainly rather than returning a bare 500.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
