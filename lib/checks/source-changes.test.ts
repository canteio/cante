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
