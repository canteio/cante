import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { ImpactInputError, ImpactBodyTooLarge, readImpactBody, parseImpactTable } from "@/lib/tariff/business-impact";
import { suggestColumnMapping } from "@/lib/tariff/column-mapping";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (workspace.role === "viewer") return Response.json({ error: "Write access required." }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/csv") return Response.json({ error: "Content-Type must be text/csv." }, { status: 415 });
    const table = parseImpactTable(await readImpactBody(request), true);
    const sampleRows = table.rows.slice(0, 5);
    const proposal = suggestColumnMapping(table.headers);
    return Response.json({ ...proposal, headers: table.headers, sampleRows });
  } catch (error) {
    if (error instanceof ImpactBodyTooLarge) return Response.json({ error: "CSV exceeds the 2 MiB upload limit." }, { status: 413 });
    if (error instanceof ImpactInputError) return Response.json({ error: "Invalid CSV. Supply unique headers and 1–500 rows within structural limits." }, { status: 400 });
    return Response.json({ error: "Unable to propose column mapping. Please retry." }, { status: 500 });
  }
}
