import assert from "node:assert/strict";
import test from "node:test";
import type { RegulationEntry } from "@/lib/sources/fetch";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";

function entry(sourceId: string, index: number, title = `Rule ${index}`): RegulationEntry {
  return {
    sourceId,
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
  const { customerId } = await operatingDb();
  const sourceId = `source-${customerId}`;
  const { error: sourceError } = await createServiceClient().from("sources").insert({
    id: sourceId, country: "Indonesia", name: "Source A", domain: "example.go.id",
    url: "https://example.go.id", regulation_type: "national", reliability_status: "working", view: "national",
  });
  if (sourceError) throw new Error(sourceError.message);

  const { selectSourceChanges } = await import("@/lib/checks/source-changes");
  const first = await selectSourceChanges(
    customerId,
    "Indonesia",
    Array.from({ length: 12 }, (_, index) => entry(sourceId, index + 1)),
    [],
    "2026-08-16T00:00:00Z",
  );
  assert.equal(first.regulations.length, 10);
  assert.equal(first.baselinedCount, 2);

  const unchanged = await selectSourceChanges(
    customerId,
    "Indonesia",
    Array.from({ length: 12 }, (_, index) => entry(sourceId, index + 1)),
    [],
    "2026-08-17T00:00:00Z",
  );
  assert.equal(unchanged.regulations.length, 0);

  const changed = await selectSourceChanges(
    customerId,
    "Indonesia",
    [...Array.from({ length: 12 }, (_, index) => entry(sourceId, index + 1, index === 0 ? "Updated Rule 1" : undefined)), entry(sourceId, 13)],
    [],
    "2026-08-18T00:00:00Z",
  );
  assert.equal(changed.regulations.length, 2);
  assert.equal(changed.newCount, 1);
  assert.equal(changed.changedCount, 1);
  assert.match(changed.regulations[0].url, /#cante-revision-/);
});

test("source ledger pages past PostgREST's 1000-row default select limit without miscounting existing inventory as new", async () => {
  // Real bug, confirmed live: a source whose existing inventory for one
  // customer exceeded 1000 rows (USITC import-injury alone reached 1940) had
  // every row past the first 1000 silently dropped by the prior unbounded
  // `.select("*")`, so the un-fetched rows looked "new" here even though they
  // already existed in source_documents. The resulting insert (expected_hash:
  // null) collided with record_source_inventory()'s optimistic-lock check
  // against the real stored row and failed the ENTIRE check with "Source
  // inventory changed concurrently" for every customer whose cumulative
  // inventory on any one source crossed that boundary — not a concurrency
  // bug at all, a silent pagination bug.
  const { customerId } = await operatingDb();
  const sourceId = `source-paging-${customerId}`;
  const { error: sourceError } = await createServiceClient().from("sources").insert({
    id: sourceId, country: "Indonesia", name: "Source Paging", domain: "example.go.id",
    url: "https://example.go.id", regulation_type: "national", reliability_status: "working", view: "national",
  });
  if (sourceError) throw new Error(sourceError.message);

  const ROW_COUNT = 1_050; // comfortably past the 1000-row PostgREST default page.
  const { selectSourceChanges } = await import("@/lib/checks/source-changes");

  const first = await selectSourceChanges(
    customerId,
    "Indonesia",
    Array.from({ length: ROW_COUNT }, (_, index) => entry(sourceId, index + 1)),
    [],
    "2026-08-16T00:00:00Z",
  );
  // Bootstrap caps judgment at BOOTSTRAP_ENTRIES_PER_SOURCE (10) but every
  // row is written to inventory regardless — this must not throw.
  assert.equal(first.baselinedCount + first.regulations.length, ROW_COUNT);

  // The real assertion: re-submitting the identical, unchanged inventory a
  // second time must succeed cleanly for every row, including the ones past
  // row 1000 — before the fix this threw "changed concurrently" because rows
  // 1001+ were never found in the (truncated) existing-rows lookup.
  const second = await selectSourceChanges(
    customerId,
    "Indonesia",
    Array.from({ length: ROW_COUNT }, (_, index) => entry(sourceId, index + 1)),
    [],
    "2026-08-17T00:00:00Z",
  );
  assert.equal(second.regulations.length, 0);
  assert.equal(second.changedCount, 0);
});
