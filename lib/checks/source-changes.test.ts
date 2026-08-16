import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import type { RegulationEntry } from "@/lib/sources/fetch";

function entry(index: number, title = `Rule ${index}`): RegulationEntry {
  return {
    sourceId: "source-a",
    sourceName: "Source A",
    domain: "example.go.id",
    regulationType: "national",
    label: `Rule ${index}`,
    number: String(index),
    year: 2026,
    listingTitle: title,
    truncated: false,
    fullTitle: title,
    url: `https://example.go.id/rules/${index}`,
    foundInViews: ["national"],
  };
}

test("source ledger baselines first inventory then emits only new or changed records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cante-source-ledger-test-"));
  const dbPath = path.join(dir, "test.db");
  process.env.CANTE_DB_PATH = dbPath;
  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, country TEXT, city TEXT, created_at TEXT);
    CREATE TABLE sources (id TEXT PRIMARY KEY, country TEXT, name TEXT, domain TEXT, url TEXT, regulation_type TEXT, reliability_status TEXT, view TEXT, notes TEXT, last_success_at TEXT);
    CREATE TABLE source_documents (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      source_id TEXT NOT NULL,
      identity TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_changed_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX source_documents_customer_source_identity_unique
      ON source_documents(customer_id, jurisdiction, source_id, identity);
  `);
  sqlite.prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?)").run(
    "customer-a",
    "Customer A",
    "Indonesia",
    "Surabaya",
    "2026-08-16T00:00:00Z",
  );
  sqlite.prepare("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "source-a",
    "Indonesia",
    "Source A",
    "example.go.id",
    "https://example.go.id",
    "national",
    "working",
    "national",
    null,
    null,
  );
  sqlite.close();

  try {
    const { selectSourceChanges } = await import("@/lib/checks/source-changes");
    const first = selectSourceChanges(
      "customer-a",
      "Indonesia",
      Array.from({ length: 12 }, (_, index) => entry(index + 1)),
      [],
      "2026-08-16T00:00:00Z",
    );
    assert.equal(first.regulations.length, 10);
    assert.equal(first.baselinedCount, 2);

    const unchanged = selectSourceChanges(
      "customer-a",
      "Indonesia",
      Array.from({ length: 12 }, (_, index) => entry(index + 1)),
      [],
      "2026-08-17T00:00:00Z",
    );
    assert.equal(unchanged.regulations.length, 0);

    const changed = selectSourceChanges(
      "customer-a",
      "Indonesia",
      [...Array.from({ length: 12 }, (_, index) => entry(index + 1, index === 0 ? "Updated Rule 1" : undefined)), entry(13)],
      [],
      "2026-08-18T00:00:00Z",
    );
    assert.equal(changed.regulations.length, 2);
    assert.equal(changed.newCount, 1);
    assert.equal(changed.changedCount, 1);
    assert.match(changed.regulations[0].url, /#cante-revision-/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
