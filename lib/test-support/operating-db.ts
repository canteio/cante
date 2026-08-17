import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Throwaway SQLite matching the operating-data half of lib/db/schema.ts.
 *
 * The existing tests hand-write their tables, which is fine for one table and
 * unmanageable for eleven. Kept in one place so a schema change breaks every
 * affected test at once rather than letting them drift apart quietly.
 *
 * These statements must mirror `schema.ts`. The unique indexes especially: a
 * test harness without them cannot catch a constraint bug, which is exactly how
 * a collision bug survives a green suite.
 */
export const OPERATING_SCHEMA_SQL = `
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, country TEXT, city TEXT, created_at TEXT);
CREATE TABLE sources (id TEXT PRIMARY KEY, country TEXT, name TEXT, domain TEXT, url TEXT, regulation_type TEXT, reliability_status TEXT, view TEXT, notes TEXT, last_success_at TEXT);
CREATE TABLE check_runs (id TEXT PRIMARY KEY, customer_id TEXT, jurisdiction TEXT, status TEXT, started_at TEXT, completed_at TEXT, sources_checked INTEGER, sources_failed INTEGER, findings_count INTEGER, error_message TEXT);
CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  check_run_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  source_id TEXT,
  regulation_ref TEXT,
  title TEXT NOT NULL,
  url TEXT,
  enacted_on TEXT,
  summary_id TEXT,
  summary_en TEXT,
  relevance TEXT NOT NULL,
  reasoning TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  materials TEXT NOT NULL DEFAULT '[]',
  origin_country TEXT,
  unit_of_measure TEXT,
  unit_value REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  product_class TEXT NOT NULL DEFAULT 'unknown',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX products_customer_sku_unique ON products(customer_id, sku);
CREATE TABLE product_classifications (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  system TEXT NOT NULL,
  jurisdiction TEXT,
  code TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'lead',
  basis TEXT NOT NULL,
  supporting_refs TEXT NOT NULL DEFAULT '[]',
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  approved_by TEXT,
  approved_at TEXT,
  superseded_at TEXT,
  superseded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  address TEXT,
  contact_email TEXT,
  role TEXT NOT NULL DEFAULT 'supplier',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE trade_lanes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  product_id TEXT,
  direction TEXT NOT NULL DEFAULT 'export',
  origin_country TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  transit_countries TEXT NOT NULL DEFAULT '[]',
  supplier_id TEXT,
  broker_name TEXT,
  broker_contact TEXT,
  incoterm TEXT,
  shipment_frequency TEXT NOT NULL DEFAULT 'unknown',
  annual_shipments INTEGER,
  annual_value REAL,
  annual_volume REAL,
  volume_unit TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  next_shipment_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE supplier_documents (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  product_id TEXT,
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_requested',
  requested_at TEXT,
  received_at TEXT,
  expires_at TEXT,
  file_ref TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE trade_documents (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  document_number TEXT,
  document_date TEXT,
  parse_status TEXT NOT NULL DEFAULT 'unparsed',
  parse_note TEXT,
  extracted TEXT,
  raw_text TEXT,
  uploaded_at TEXT NOT NULL
);
CREATE TABLE document_findings (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  product_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  document_value TEXT,
  expected_value TEXT,
  expectation_tier TEXT NOT NULL DEFAULT 'lead',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE finding_actions (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  assignee TEXT,
  forwarded_to TEXT,
  due_at TEXT,
  broker_decision TEXT,
  broker_decided_at TEXT,
  note TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX finding_actions_finding_unique ON finding_actions(finding_id);
CREATE TABLE impact_assessments (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product_id TEXT,
  lane_id TEXT,
  match_reason TEXT NOT NULL,
  match_kind TEXT NOT NULL,
  effective_on TEXT,
  next_affected_shipment_at TEXT,
  duty_rate_before REAL,
  duty_rate_after REAL,
  estimated_annual_exposure REAL,
  estimated_monthly_exposure REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  delay_risk TEXT NOT NULL DEFAULT 'none',
  basis TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT 'indicative',
  created_at TEXT NOT NULL
);
CREATE TABLE screening_results (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  supplier_id TEXT,
  screened_name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'csl',
  outcome TEXT NOT NULL,
  match_count INTEGER NOT NULL DEFAULT 0,
  matches TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  list_version TEXT,
  screened_at TEXT NOT NULL
);
`;

/**
 * One database per test *file*, one customer per test *case*.
 *
 * `lib/db/client.ts` resolves CANTE_DB_PATH once at import time and the module
 * is cached, so a second `createOperatingDb()` in the same file would build a
 * database nothing ever reads — every test after the first would silently share
 * the first one's rows. That is not a hypothetical: it made two tests here pass
 * against leftover state before this helper existed.
 *
 * Isolating by customer instead is both correct and useful — every test now
 * exercises the multi-tenant scoping the schema claims.
 */
let sharedDb: { dbPath: string; dir: string } | null = null;

export async function operatingDb(): Promise<{ dbPath: string; customerId: string }> {
  if (!sharedDb) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cante-operating-test-"));
    const dbPath = path.join(dir, "test.db");
    process.env.CANTE_DB_PATH = dbPath;
    const sqlite = new Database(dbPath);
    sqlite.exec(OPERATING_SCHEMA_SQL);
    sqlite.close();
    sharedDb = { dbPath, dir };
  }

  const customerId = `customer-${randomUUID()}`;
  const sqlite = new Database(sharedDb.dbPath);
  sqlite
    .prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?)")
    .run(customerId, "Test Co", "Indonesia", "Surabaya", "2026-08-16T00:00:00Z");
  sqlite.close();
  return { dbPath: sharedDb.dbPath, customerId };
}

/** Insert a finding directly, for workflow and impact tests. */
export function seedFinding(
  dbPath: string,
  customerId: string,
  finding: { id: string; title: string; relevance?: string; summaryEn?: string | null },
): void {
  const sqlite = new Database(dbPath);
  const runId = `run-${customerId}`;
  sqlite
    .prepare("INSERT OR IGNORE INTO check_runs (id, customer_id, jurisdiction, status) VALUES (?, ?, ?, ?)")
    .run(runId, customerId, "Indonesia", "complete");
  sqlite
    .prepare(
      "INSERT INTO findings (id, check_run_id, customer_id, title, summary_en, relevance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      finding.id,
      runId,
      customerId,
      finding.title,
      finding.summaryEn ?? null,
      finding.relevance ?? "flagged",
      "2026-08-16T00:00:00Z",
    );
  sqlite.close();
}
