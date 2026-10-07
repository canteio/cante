import { createRequestClient, getAuthenticatedWorkspace } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const workspace = await getAuthenticatedWorkspace();
    if (!workspace) return Response.json({ error: "Authentication required." }, { status: 401 });
    const client = await createRequestClient();
    // Immutable signals have no resolved state. List retained signals, newest first;
    // running an analysis does not prove that a finding has been resolved.
    const candidates: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("tariff_monitor_candidates")
        .select("id,finding_id,product_id,match_kind,match_reason,created_at")
        .eq("customer_id", workspace.customerId).not("product_id", "is", null)
        .order("created_at", { ascending: false }).order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      candidates.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    return Response.json({ candidates });
  } catch {
    return Response.json({ error: "Unable to load tariff monitor signals." }, { status: 500 });
  }
}
