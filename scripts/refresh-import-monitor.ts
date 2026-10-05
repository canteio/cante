import "./load-env";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseMonitorStore } from "@/pipelines/import-manifest/monitor/store";
import { refreshMonitor } from "@/pipelines/import-manifest/monitor/refresh";

/** Schedule this repo-owned entry point on the existing trusted worker. No
 * messages are sent: new importer discoveries are persisted and printed for
 * operator review, and exposed to the signed-in customer's monitoring page. */
async function main() {
  const customerId = process.env.CANTE_IMPORT_CUSTOMER_ID;
  if (!customerId) throw new Error("CANTE_IMPORT_CUSTOMER_ID is required");
  const store = supabaseMonitorStore(createServiceClient());
  const { state, healthy, errors } = await refreshMonitor(customerId, store, { file: process.env.CANTE_IMPORT_SHIPMENTS_FILE });
  console.log(JSON.stringify({ updatedAt: state.updatedAt, sources: state.sources,
    newImporters: state.leads.filter(l => state.newLeadIds.includes(l.id)) }, null, 2));
  for (const error of errors) console.error(error);
  // Monitoring infrastructure must see missing/stale coverage as non-success.
  process.exitCode = healthy ? 0 : 2;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
