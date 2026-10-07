import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { getImpactRun } from "@/lib/tariff/business-impact-store";
import { exportBusinessImpact } from "@/lib/tariff/business-impact";
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    const run = await getImpactRun(workspace.customerId, (await context.params).runId);
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
    return new Response(exportBusinessImpact(run.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="tariff-impact.csv"', "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Unable to export tariff impact run." }, { status: 500 }); }
}
