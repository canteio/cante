import { randomUUID } from "node:crypto";
import type { Finding } from "@/lib/db/schema";
import { codesMentionedIn, matchProducts } from "@/lib/impact/assess";
import { createClient } from "@/lib/supabase/server";

type MonitorFinding = Pick<Finding, "id" | "title" | "summaryEn" | "reasoning" | "regulationRef" | "relevance">;

/** A code-overlap signal only. Never persist LLM prose or infer rates or impact. */
export async function queueTariffMonitorCandidates(customerId: string, finding: MonitorFinding): Promise<void> {
  if (!["flagged", "noted"].includes(finding.relevance) || codesMentionedIn(finding).length === 0) return;
  const matches = (await matchProducts(customerId, finding))
    .filter(match => match.kind === "exact_code" || match.kind === "code_prefix");
  if (!matches.length) return;
  const client = await createClient();
  // The worker can use a service client: validate the finding's tenant here too.
  const { data, error: lookupError } = await client.from("findings").select("id")
    .eq("id", finding.id).eq("customer_id", customerId).in("relevance", ["flagged", "noted"]).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!data) throw new Error("Monitor finding is outside this workspace or not actionable.");
  const { error } = await client.from("tariff_monitor_candidates").upsert(matches.map(match => ({
    id: randomUUID(), customer_id: customerId, finding_id: finding.id, product_id: match.product.id,
    match_kind: match.kind,
    // Fixed wording prevents any finding-derived rate/prose from entering this ledger.
    match_reason: match.kind === "exact_code"
      ? "A code named in the finding matches a catalogue classification. Verify applicability and current published rates."
      : "A code named in the finding overlaps a catalogue classification prefix. Confirm the full code and current published rates.",
  })), { onConflict: "finding_id,product_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
