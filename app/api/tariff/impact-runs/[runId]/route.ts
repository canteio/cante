import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { getImpactRun } from "@/lib/tariff/business-impact-store";
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    const run = await getImpactRun(workspace.customerId, (await context.params).runId);
    return run ? Response.json(run) : Response.json({ error: "Run not found." }, { status: 404 });
  } catch { return Response.json({ error: "Unable to read tariff impact run." }, { status: 500 }); }
}
