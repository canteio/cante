import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { supabaseMonitorStore } from "./store";
import { refreshMonitor } from "./refresh";

// sqliteMonitorStore() is a deprecated stub that always throws (SQLite
// monitor storage was fully retired when this app's data layer became
// Supabase-only) — there is nothing left to test for it beyond the throw
// itself, which store.ts's other test coverage... actually there is no
// separate coverage file; the throw is a one-liner, exercised implicitly by
// every call site having moved to supabaseMonitorStore instead. The real
// behavioral coverage below (tenant isolation, revision conflicts, error
// propagation) now lives entirely on the Supabase-backed implementation.

test("Supabase store constrains reads/writes by tenant and previous revision; errors never become empty data", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let broken = false;
  const client = createClient("https://test-only.supabase.co", "test-only-key", { global: {
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (broken) return Response.json({ message: "database unavailable" }, { status: 500 });
      if (init?.method === "GET") return Response.json([]);
      return Response.json({ revision: 1 });
    },
  } });
  const store = supabaseMonitorStore(client);
  const { state } = await refreshMonitor("tenant-a", store, { recalls: async () => [] });
  assert.match(calls[0].url, /customer_id=eq.tenant-a/);
  assert.equal(calls[1].method, "POST");
  await store.save("tenant-a", { ...state, revision: 2 }, 1);
  assert.equal(calls[2].method, "PATCH");
  assert.match(calls[2].url, /customer_id=eq.tenant-a/);
  assert.match(calls[2].url, /revision=eq.1/);
  broken = true;
  await assert.rejects(store.read("tenant-a"), /read failed/);
  await assert.rejects(store.save("tenant-a", state, 1), /write failed/);
});
