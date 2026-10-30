import { boundedRequest, RequestLimitError } from "@/app/api/request-body";
import { localAuditTestAvailable, runAuditFixture, sampleCsv } from "../fixture";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store", "x-cante-result-mode": "synthetic-test" };
export async function GET() {
  if (!localAuditTestAvailable()) return new Response(null, { status: 404 });
  return Response.json({ csv: sampleCsv(), filename: "SYNTHETIC-120-import-entries.csv" }, { headers });
}
export async function POST(request:Request) {
  if (!localAuditTestAvailable()) return new Response(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin request rejected." }, { status: 403, headers });
  try {
    // Local, stateless computation only; no customer quota, database or LLM call.
    const bounded = await boundedRequest(request, 4 * 1024 * 1024);
    return Response.json(runAuditFixture(await bounded.json()), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Test run unavailable." }, { status: error instanceof RequestLimitError ? error.status : 400, headers });
  }
}
