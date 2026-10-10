export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MVP: disabled, not deleted. This route backed the removed MissionOneHub
 * banner (components/tariff/mission-one-hub.tsx, no longer rendered from
 * app/tariff/page.tsx) and had two fabrication problems, found by audit:
 * it silently substituted a hardcoded six-SKU fake catalogue
 * (ENG-ROTOR-01, "Precision Machining Corp", etc.) whenever the real signed-in
 * tenant had no classified products, and the underlying calculateNoticeExposure()
 * (lib/tariff/federal-register-monitor.ts) applies a flat invented 25% rate and
 * pads a zero result to a fake $42,000/SKU for "enterprise demo" purposes. Both
 * were presented in the UI with full confidence ("Last verified against
 * official schedule: Today"). See CLAUDE.md's "Mission One rollback" entry.
 * Do not re-enable until it only ever uses the real tenant's real catalogue
 * and real import data (reuse lib/tariff/stack.ts, already audited honest),
 * and distinguishes a live government fetch from a cached/fallback one.
 */
export async function GET() {
  return Response.json({ error: "Disabled: this route could substitute a fabricated sample catalogue and an invented duty rate. See CLAUDE.md." }, { status: 410 });
}

export async function POST() {
  return GET();
}
