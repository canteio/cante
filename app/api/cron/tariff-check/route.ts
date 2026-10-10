export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MVP: disabled, not deleted. vercel.json's crons array is empty, so nothing
 * invokes this on a schedule, and the GET handler below refuses to run even
 * if called directly. The previous implementation (kept in git history)
 * computed exposure against a hardcoded sample catalogue (ENG-ROTOR-01 etc.,
 * no real customer) and padded a zero result to a fake $42,000/SKU for demo
 * purposes — see lib/tariff/federal-register-monitor.ts and CLAUDE.md's
 * "Mission One rollback" entry. Do not re-enable until it reads the real
 * signed-in tenant's catalogue and stops the synthetic padding.
 */
export async function GET() {
  return Response.json({ error: "Disabled: this route computed exposure against a hardcoded sample catalogue, not real customer data. See CLAUDE.md." }, { status: 410 });
}
