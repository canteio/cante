import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
import { getImpactRun } from "@/lib/tariff/business-impact-store";
import { comparePublishedBaseRates, type ImpactRow } from "@/lib/tariff/business-impact";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    const client = await createRequestClient();
    const { data: health, error } = await client.from("tariff_sync_status").select("*").eq("source", "usitc_hts").maybeSingle();
    if (error) throw error;
    const runId = new URL(request.url).searchParams.get("runId");
    const run = runId ? await getImpactRun(workspace.customerId, runId) : null;
    if (runId && !run) return Response.json({ error: "Run not found." }, { status: 404 });
    const rows: ImpactRow[] = run?.rows ?? [];
    const codes = [...new Set(rows.filter(row => row.product_id && row.hts).map(row => row.hts!.replace(/\./g, "")))];
    const changes = [];
    if (codes.length) {
      const formatted = codes.map(code => code.length === 10 ? `${code.slice(0,4)}.${code.slice(4,6)}.${code.slice(6,8)}.${code.slice(8)}` : code);
      const { data, error: changeError } = await client.from("hts_rate_changes").select("*").in("hts_code", formatted).order("detected_at", { ascending: false }).limit(101);
      if (changeError) throw changeError;
      if ((data?.length ?? 0) > 100) return Response.json({ error: "More than 100 schedule changes match this run. Narrow the import history to review all changes." }, { status: 422 });
      for (const change of data ?? []) {
        const matched = rows.filter(row => row.product_id && row.hts?.replace(/\./g, "") === change.hts_code.replace(/\./g, ""));
        changes.push({ ...change, comparison: comparePublishedBaseRates(matched, change.before_rates, change.after_rates) });
      }
    }
    return Response.json({ health, changes, checkedAt: new Date().toISOString(), coverage: "USITC published schedule changes. Full Chapter 99 applicability and legal effective dates require separate review." });
  } catch {
    return Response.json({ error: "Monitoring status is unavailable. No all-clear determination was made." }, { status: 503 });
  }
}
