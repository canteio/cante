import { runLiveCheck, type LiveProduct, type LiveSource } from "./check";
import { checkWorkerConfigured, dispatchCheck } from "./worker-client";
import { finishLiveCheckArchive, readLiveCheckArchive } from "@/lib/tariff/business-impact-store";
import type { createRequestClient } from "@/lib/supabase/server";
import { attachCheckComparison } from "./comparison";

/** One execution path for uploads, dashboard refresh and chat. No model calls,
 * schedules, delivery, or service credentials in the hosted request path. */
export async function executeArchivedCheck(db: Awaited<ReturnType<typeof createRequestClient>>, customerId: string, checkId: string, products: LiveProduct[], signal: AbortSignal, progress: (message: string) => void, observeSources?: (sources: LiveSource[]) => void) {
  if (checkWorkerConfigured()) return dispatchCheck(checkId, customerId, signal, progress);
  if (process.env.CANTE_CHECK_WORKER_URL || process.env.CANTE_CHECK_DISPATCH_SECRET) throw Error("The check worker configuration is incomplete. No local substitute was run.");
  const result = await runLiveCheck(products, signal, progress, observeSources);
  signal.throwIfAborted();
  const { data, error } = await db.from("tariff_check_records").select("id").eq("customer_id", customerId).neq("id", checkId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (error) result.coverageNotes.push("Previous check could not be read; no saved comparison is available.");
  let baseline = null;
  try { baseline = !error && data?.[0] ? await readLiveCheckArchive(db, customerId, data[0].id) : null; }
  catch { result.coverageNotes.push("The previous archive could not be verified; no cost change is claimed."); }
  attachCheckComparison(result, baseline);
  progress("Saving inputs, government evidence and calculation…");
  await finishLiveCheckArchive(db, customerId, checkId, result);
  return result;
}
