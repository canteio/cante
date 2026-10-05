import "./load-env";
import { createServiceClient } from "@/lib/supabase/service";

// Legacy entry point retained for scheduler/package command compatibility.
// Supabase is the only store now: this checks access/counts, not local parity,
// and never claims to have copied data or verified historical migration IDs.
const TABLES = [
  "customers", "sources", "source_packs", "customer_profiles", "jurisdiction_profiles", "kbli_records", "check_runs", "source_results", "source_documents", "findings", "alerts", "conversations", "chat_messages", "memories", "checklist_items", "products", "product_classifications", "suppliers", "trade_lanes", "supplier_documents", "trade_documents", "document_findings", "regulation_links", "product_components", "substances", "component_substances", "restricted_substance_lists", "restricted_substance_entries", "finding_actions", "impact_assessments", "screening_results", "document_chunks", "import_monitor_state",
];

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) {
    if (!["--dry-run", "--verify", "--pull-inputs"].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const slug = process.env.CANTE_SUPABASE_CUSTOMER_SLUG?.trim();
  if (!slug) throw new Error("Set CANTE_SUPABASE_CUSTOMER_SLUG to the intended tenant before verification.");
  const cloud = createServiceClient();
  const { data: customer, error } = await cloud.from("customers").select("id").eq("slug", slug).single();
  if (error) throw new Error(`Could not resolve tenant: ${error.message}`);
  console.log("Supabase-only read verification. No data is copied; local migration parity is not checked.");
  if (args.has("--pull-inputs")) console.log("Pull is obsolete: customer inputs already reside in Supabase.");
  // Tables without customer_id are shared or owned indirectly through a parent.
  const tenantTables = new Set([
    "customer_profiles", "jurisdiction_profiles", "kbli_records", "check_runs",
    "source_documents", "findings", "alerts", "conversations", "memories", "checklist_items", "products",
    "suppliers", "trade_lanes", "trade_documents", "regulation_links",
    "finding_actions", "impact_assessments", "screening_results", "document_chunks",
    "import_monitor_state",
  ]);
  for (const table of TABLES) {
    let query = cloud.from(table).select("*", { count: "exact", head: true });
    if (tenantTables.has(table)) query = query.eq("customer_id", customer.id);
    if (table === "customers") query = query.eq("id", customer.id);
    const { count, error } = await query;
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    console.log(`${table}: ${count ?? 0} (${tenantTables.has(table) || table === "customers" ? "tenant" : "global"})`);
  }
  console.log("Supabase reads verified. No writes performed.");
}

main().catch((error) => {
  console.error(`Supabase verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
