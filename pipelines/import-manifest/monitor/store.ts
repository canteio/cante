import type { SupabaseClient } from "@supabase/supabase-js";
import type { MonitorState } from "./model";
import type { MonitorStore } from "./refresh";

/** @deprecated Compatibility export for callers awaiting migration. Never opens a local database. */
export async function sqliteMonitorStore(_database?: unknown): Promise<MonitorStore> {
  throw new Error("SQLite monitor storage has been removed. Use supabaseMonitorStore with a Supabase client.");
}
export function supabaseMonitorStore(client: SupabaseClient): MonitorStore {
  return {
    async read(customerId) {
      const { data, error } = await client.from("import_monitor_state").select("payload").eq("customer_id", customerId).maybeSingle();
      if (error) throw new Error(`Import monitor read failed: ${error.message}`);
      return data?.payload as MonitorState ?? null;
    },
    async save(customerId, payload, previousRevision) {
      const row = { customer_id: customerId, revision: payload.revision, payload };
      const query = previousRevision === 0 ? client.from("import_monitor_state").insert(row) :
        client.from("import_monitor_state").update(row).eq("customer_id", customerId).eq("revision", previousRevision);
      const { data, error } = await query.select("revision").single();
      if (error || !data) throw new Error(`Import monitor write failed (possibly concurrent refresh): ${error?.message ?? "no row"}`);
    },
  };
}
