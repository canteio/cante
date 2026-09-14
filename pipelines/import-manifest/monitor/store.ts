import { and, eq } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importMonitorState } from "@/lib/db/schema";
import type { MonitorState } from "./model";
import type { MonitorStore } from "./refresh";

// Load SQLite lazily: hosted reads must never load its native binding.
export async function sqliteMonitorStore(database?: typeof import("@/lib/db/client").db): Promise<MonitorStore> {
  const db = database ?? (await import("@/lib/db/client")).db;
  return {
    async read(customerId) {
      return db.select().from(importMonitorState).where(eq(importMonitorState.customerId, customerId)).get()?.payload ?? null;
    },
    async save(customerId, payload, previousRevision) {
      if (previousRevision === 0) {
        db.insert(importMonitorState).values({ customerId, revision: payload.revision, payload }).run();
      } else {
        const result = db.update(importMonitorState).set({ revision: payload.revision, payload })
          .where(and(eq(importMonitorState.customerId, customerId), eq(importMonitorState.revision, previousRevision))).run();
        if (result.changes !== 1) throw new Error("Concurrent import refresh; retry on the next schedule");
      }
    },
  };
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
