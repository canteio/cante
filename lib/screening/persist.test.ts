import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { operatingDb } from "@/lib/test-support/operating-db";

/**
 * Coverage for lib/screening/persist.ts — this file previously had zero
 * tests despite being the piece that turns a screening answer into an
 * auditable, dated event and the piece that decides whether a failed
 * upstream call is ever allowed to render as "clear" (it must not be).
 *
 * We stub global.fetch per test (rather than mocking the module) so the
 * real screenExactNames() parsing/caching logic in csl.ts runs for real —
 * only the network boundary is faked.
 */

function cslResponse(records: unknown[]) {
  return new Response(JSON.stringify({ results: records, total: records.length }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function insertSupplier(dbPath: string, customerId: string, name: string) {
  const sqlite = new Database(dbPath);
  const id = `supplier-${randomUUID()}`;
  const now = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO suppliers (id, customer_id, name, country, address, contact_email, role, active, notes, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, 'supplier', 1, NULL, ?, ?)",
    )
    .run(id, customerId, name, now, now);
  sqlite.close();
  return id;
}

test("screenName records a clear outcome and reports clear: true", async () => {
  const { dbPath, customerId } = await operatingDb();
  const { resetCslCacheForTests } = await import("@/lib/screening/csl");
  const { screenName } = await import("@/lib/screening/persist");
  resetCslCacheForTests();

  const originalFetch = global.fetch;
  global.fetch = (async () => cslResponse([])) as typeof fetch;
  try {
    const { row, clear } = await screenName(customerId, "Nobody Of Concern LLC");
    assert.equal(clear, true);
    assert.equal(row.outcome, "clear");
    assert.equal(row.matchCount, 0);
    assert.equal(row.errorMessage, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("screenName records a match outcome with source details, never clear", async () => {
  const { dbPath, customerId } = await operatingDb();
  const { resetCslCacheForTests } = await import("@/lib/screening/csl");
  const { screenName } = await import("@/lib/screening/persist");
  resetCslCacheForTests();

  const originalFetch = global.fetch;
  global.fetch = (async () =>
    cslResponse([
      {
        name: "SANCTIONED PARTY LTD",
        alt_names: [],
        source: "Entity List (EL) - Bureau of Industry and Security",
        source_list_url: "https://www.bis.gov/entity-list",
        source_information_url: "https://www.bis.gov/",
        addresses: [
          { address: "1 Test Rd", city: "Testville", state: null, postal_code: "00000", country: "XX" },
        ],
      },
    ])) as typeof fetch;
  try {
    const { row, clear } = await screenName(customerId, "Sanctioned Party Ltd");
    assert.equal(clear, false);
    assert.equal(row.outcome, "match");
    assert.equal(row.matchCount, 1);
    assert.equal(row.matches[0]?.source, "Entity List (EL) - Bureau of Industry and Security");
  } finally {
    global.fetch = originalFetch;
  }
});

test("screenName on upstream failure stores outcome: error and is never clear", async () => {
  const { customerId } = await operatingDb();
  const { resetCslCacheForTests } = await import("@/lib/screening/csl");
  const { screenName } = await import("@/lib/screening/persist");
  resetCslCacheForTests();

  const originalFetch = global.fetch;
  global.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  try {
    const { row, clear } = await screenName(customerId, "Some Supplier");
    assert.equal(clear, false, "an upstream error must never be reported clear");
    assert.equal(row.outcome, "error");
    assert.ok(row.errorMessage && row.errorMessage.length > 0);
    assert.equal(row.matchCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("screenSupplier resolves the supplier name then screens it, and rejects unknown ids", async () => {
  const { dbPath, customerId } = await operatingDb();
  const { resetCslCacheForTests } = await import("@/lib/screening/csl");
  const { screenSupplier } = await import("@/lib/screening/persist");
  resetCslCacheForTests();

  const supplierId = insertSupplier(dbPath, customerId, "Known Supplier Co");

  const originalFetch = global.fetch;
  global.fetch = (async () => cslResponse([])) as typeof fetch;
  try {
    const { row } = await screenSupplier(customerId, supplierId);
    assert.equal(row.screenedName, "Known Supplier Co");
    assert.equal(row.supplierId, supplierId);

    await assert.rejects(
      () => screenSupplier(customerId, "not-a-real-id"),
      /Supplier not found/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("screeningCoverage separates never-screened, matched, errored, and stale suppliers", async () => {
  const { dbPath, customerId } = await operatingDb();
  const { resetCslCacheForTests } = await import("@/lib/screening/csl");
  const { screenSupplier, screeningCoverage } = await import("@/lib/screening/persist");
  resetCslCacheForTests();

  const clearId = insertSupplier(dbPath, customerId, "Clear Supplier");
  const matchId = insertSupplier(dbPath, customerId, "Flagged Supplier");
  const erroredId = insertSupplier(dbPath, customerId, "Errored Supplier");
  insertSupplier(dbPath, customerId, "Never Screened Supplier");

  const originalFetch = global.fetch;

  // Each screenSupplier call below simulates a *different* upstream state
  // (clear / match / error). screenExactNames caches the CSL snapshot for
  // CACHE_TTL_MS (15 min) so consecutive calls in production don't hammer
  // Trade.gov — but that same caching means, without a reset here, calls 2
  // and 3 would silently reuse call 1's cached (empty) snapshot instead of
  // hitting their own mocked fetch response, masking the "error" outcome
  // this test exists to verify. Reset before each call so every mock is
  // actually exercised.
  global.fetch = (async () => cslResponse([])) as typeof fetch;
  await screenSupplier(customerId, clearId);

  resetCslCacheForTests();
  global.fetch = (async () =>
    cslResponse([
      {
        name: "FLAGGED SUPPLIER",
        alt_names: [],
        source: "Entity List (EL) - Bureau of Industry and Security",
        source_list_url: "https://www.bis.gov/entity-list",
        source_information_url: "https://www.bis.gov/",
        addresses: [],
      },
    ])) as typeof fetch;
  await screenSupplier(customerId, matchId);

  resetCslCacheForTests();
  global.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  await screenSupplier(customerId, erroredId);

  global.fetch = originalFetch;

  const coverage = screeningCoverage(customerId, { now: new Date() });
  assert.equal(coverage.totalSuppliers, 4);
  assert.deepEqual(coverage.neverScreened, ["Never Screened Supplier"]);
  assert.deepEqual(coverage.erroredScreenings, ["Errored Supplier"]);
  assert.equal(coverage.currentMatches.length, 1);
  assert.equal(coverage.currentMatches[0]?.name, "Flagged Supplier");
});

test("screeningCoverage flags a screening older than staleAfterDays", async () => {
  const { dbPath, customerId } = await operatingDb();
  const { resetCslCacheForTests } = await import("@/lib/screening/csl");
  const { screenSupplier, screeningCoverage } = await import("@/lib/screening/persist");
  resetCslCacheForTests();

  const supplierId = insertSupplier(dbPath, customerId, "Aging Supplier");
  const originalFetch = global.fetch;
  global.fetch = (async () => cslResponse([])) as typeof fetch;
  try {
    await screenSupplier(customerId, supplierId);
  } finally {
    global.fetch = originalFetch;
  }

  const farFuture = new Date(Date.now() + 200 * 86_400_000);
  const coverage = screeningCoverage(customerId, { now: farFuture, staleAfterDays: 90 });
  assert.equal(coverage.staleScreenings.length, 1);
  assert.equal(coverage.staleScreenings[0]?.name, "Aging Supplier");
  assert.ok(coverage.staleScreenings[0]!.ageDays >= 200);
});
