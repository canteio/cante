import { createHash } from "node:crypto";
import { parseWorkspaceUpload } from "@/app/api/tariff/workspace-data";
import { runLiveCheck, type LiveSource, type LiveCheckResult } from "@/app/api/tariff/live-check/check";
import { attachCheckComparison } from "@/app/api/tariff/live-check/comparison";
import { readLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import type { createRequestClient } from "@/lib/supabase/server";
import type { createServiceClient } from "@/lib/supabase/service";
type Db=Awaited<ReturnType<typeof createRequestClient>>;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
/** Both signed clicks and leased daily checks use this exact calculation and
 * worker-output comparison. The caller supplies its authorized atomic writer. */
export async function executeVerifiedCheck(db:Db,service:ReturnType<typeof createServiceClient>,customerId:string,checkId:string,saved:NonNullable<Awaited<ReturnType<typeof readLiveCheckArchive>>>,signal:AbortSignal,progress:(message:string)=>void,observeSources:(sources:LiveSource[])=>void,save:(result:LiveCheckResult)=>Promise<string>){
        const products = parseWorkspaceUpload(saved.record.input_csv).map(product => ({ ...product, remedyFacts: {
          ...(saved.record.confirmations.standardCommercial === true ? { standardCommercial: true } : {}),
          ...(saved.record.confirmations.noOther232 === true ? { other232Heading: "none" } : {}), ...product.remedyFacts,
        } }));
        for (const product of products) if (!Object.keys(product.remedyFacts).length) delete (product as { remedyFacts?: unknown }).remedyFacts;
        const result = await runLiveCheck(products, signal, progress, observeSources);
        signal.throwIfAborted();
        const { data, error } = await db.from("tariff_check_records").select("id").eq("customer_id", customerId).lt("created_at", saved.record.created_at).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
        if (error) result.coverageNotes.push("Previous check unavailable; no saved comparison is claimed.");
        let previous = null;
        try { previous = !error && data?.[0] ? await readLiveCheckArchive(db, customerId, data[0].id) : null; }
        catch { result.coverageNotes.push("The previous archive could not be verified; no cost change is claimed."); }
        attachCheckComparison(result, previous);
        progress("Saving and verifying the calculation and official evidence…");
        const eventId = await save(result);
        // Verify what was committed against OUR newly fetched/recomputed output.
        // Never attest an existing/member-authored result merely because hashes match.
        const committed = await readLiveCheckArchive(db, customerId, checkId);
        const terminal = committed?.events.find(e => e.id === eventId && e.kind === "completed");
        if (!committed || !terminal) throw Error("Committed calculation could not be verified.");
        const payload = JSON.parse(terminal.payload_text);
        const { sources: ownSources, ...ownReport } = result;
        const clean = (source: Record<string, unknown>) => Object.fromEntries(Object.entries(source).filter(([key]) => key !== "body" && key !== "versionId"));
        if (canonical(payload.report) !== canonical(ownReport) || canonical(payload.sources.map(clean)) !== canonical(ownSources.map(s => clean(s as unknown as Record<string, unknown>))) || committed.record.input_sha256 !== createHash("sha256").update(saved.record.input_csv).digest("hex")) throw Error("Committed calculation differs from worker output.");
        signal.throwIfAborted();
        const { error: proofError } = await service.from("tariff_check_attestations").insert({ check_id: checkId, customer_id: customerId, terminal_event_id: eventId, input_sha256: committed.record.input_sha256, event_sha256: terminal.payload_sha256, verifier_version: "official-live-check-worker-v1" });
        if (proofError) throw Error("Execution proof could not be saved.");

return result;
}
