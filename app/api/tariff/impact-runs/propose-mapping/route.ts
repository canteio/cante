import { getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { ImpactInputError, ImpactBodyTooLarge, readImpactBody, parseImpactTable } from "@/lib/tariff/business-impact";
import { suggestColumnMapping, proposeColumnMapping, canonicalFields } from "@/lib/tariff/column-mapping";
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

    const hasIdentifier = Boolean(proposal.mapping.sku || proposal.mapping.entry_id);
    const hasHts = Boolean(proposal.mapping.hts);
    const hasOrigin = Boolean(proposal.mapping.origin);
    const hasValue = Boolean(proposal.mapping.customs_value_usd || proposal.mapping.annual_import_value_usd);

    if (!hasIdentifier || !hasHts || !hasOrigin || !hasValue) {
      try {
        const llmProposal = await proposeColumnMapping(table.headers, sampleRows);
        for (const field of canonicalFields) {
          if (!proposal.mapping[field] && llmProposal.mapping[field]) {
            proposal.mapping[field] = llmProposal.mapping[field];
            proposal.confidence[field] = llmProposal.confidence[field] ?? 0.8;
          }
        }
      } catch (e) {
        console.warn("LLM column mapping fallback skipped:", e);
      }
    }

    return Response.json({ ...proposal, headers: table.headers, sampleRows });
  } catch (error) {
    if (error instanceof ImpactBodyTooLarge) return Response.json({ error: "CSV exceeds the 2 MiB upload limit." }, { status: 413 });
    if (error instanceof ImpactInputError) return Response.json({ error: "Invalid CSV. Supply unique headers and 1–500 rows within structural limits." }, { status: 400 });
    return Response.json({ error: "Unable to propose column mapping. Please retry." }, { status: 500 });
  }
}
