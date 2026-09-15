import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import * as schema from "@/lib/db/schema";
import { sqliteMonitorStore, supabaseMonitorStore } from "./store";
import { refreshMonitor } from "./refresh";

// Use a real SQLite engine without the repository's broken native addon.
// This tiny test-only statement bridge implements precisely the better-sqlite3
// calls Drizzle uses; production continues to use the existing DB connection.
function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    INSERT INTO customers VALUES ('a'), ('b');
    CREATE TABLE import_monitor_state (customer_id TEXT PRIMARY KEY REFERENCES customers(id), revision INTEGER NOT NULL, payload TEXT NOT NULL);`);
  const bridge = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const wrapper = {
        raw() { stmt.setReturnArrays(true); return wrapper; },
        run(...args: SQLInputValue[]) { return stmt.run(...args); },
        get(...args: SQLInputValue[]) { return stmt.get(...args); },
        all(...args: SQLInputValue[]) { return stmt.all(...args); },
      };
      return wrapper;
    },
  };
  return { sqlite, db: drizzle(bridge as unknown as Database.Database, { schema }) };
}

test("SQLite persists an atomic snapshot, isolates tenants and rejects stale writes and unknown tenants", async () => {
  const { sqlite, db } = testDatabase();
  try {
    const store = await sqliteMonitorStore(db);
    const first = await refreshMonitor("a", store, { now: "2026-09-14T12:00:00.000Z", recalls: async () => [] });
    // Create a fresh repository object to prove this reads persisted SQL data.
    const reopened = await sqliteMonitorStore(db);
    assert.deepEqual(await reopened.read("a"), first.state);
    assert.equal(await reopened.read("b"), null);
    await assert.rejects(reopened.save("a", first.state, 0));
    const second = { ...first.state, revision: 2 };
    await reopened.save("a", second, 1);
    await assert.rejects(reopened.save("a", second, 1), /Concurrent/);
    assert.equal((await reopened.read("a"))?.revision, 2);
    await assert.rejects(reopened.save("unknown-tenant", first.state, 0), /FOREIGN KEY/);
  } finally { sqlite.close(); }
});

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
