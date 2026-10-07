import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { parseBusinessImpact, evaluateBusinessImpact, ImpactInputError, ImpactBodyTooLarge, readImpactBody } from "@/lib/tariff/business-impact";
import { createImpactRun, listImpactRuns } from "@/lib/tariff/business-impact-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (workspace.role === "viewer") return Response.json({ error: "Write access required." }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/csv") return Response.json({ error: "Content-Type must be text/csv." }, { status: 415 });
    const input = await readImpactBody(request);
    const rows = await evaluateBusinessImpact(parseBusinessImpact(input), undefined, request.signal);
    if (request.signal.aborted) return Response.json({ error: "Request cancelled." }, { status: 499 });
    const run = await createImpactRun(workspace.customerId, input, request.headers.get("x-filename"), rows);
    return Response.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof ImpactBodyTooLarge) return Response.json({ error: "CSV exceeds the 2 MiB upload limit." }, { status: 413 });
    if (error instanceof ImpactInputError) return Response.json({ error: "Invalid CSV. Supply unique headers and 1–500 rows within structural limits." }, { status: 400 });
    return Response.json({ error: "Unable to create tariff impact run." }, { status: 500 });
  }
}
export async function GET() {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    return Response.json({ runs: await listImpactRuns(workspace.customerId) });
  } catch { return Response.json({ error: "Unable to read tariff impact runs." }, { status: 500 }); }
}
