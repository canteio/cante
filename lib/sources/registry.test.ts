import assert from "node:assert/strict";
import test from "node:test";
import { selectMonitoredSources } from "@/lib/sources/registry";

function ecfrStart(selection: ReturnType<typeof selectMonitoredSources>): string {
  const source = selection.sources.find((candidate) => candidate.id === "us-ecfr-title-29");
  assert.ok(source);
  return new URL(source.url).searchParams.get("issue_date[gte]") ?? "";
}

test("eCFR selection resumes inclusively from the last completed run", () => {
  const selection = selectMonitoredSources("United States", null, {
    lastCompletedAt: "2026-08-15T23:59:00.000Z",
    now: new Date("2026-08-16T12:00:00.000Z"),
  });

  assert.equal(ecfrStart(selection), "2026-08-15");
  assert.ok(!selection.coverageCaveats.some((caveat) => caveat.includes("bootstrap")));
});

test("first eCFR run uses and discloses a seven-day bootstrap window", () => {
  const selection = selectMonitoredSources("United States", null, {
    now: new Date("2026-08-16T12:00:00.000Z"),
  });

  assert.equal(ecfrStart(selection), "2026-08-09");
  assert.ok(
    selection.coverageCaveats.includes(
      "eCFR bootstrap coverage begins 2026-08-09. Earlier amendments were not historically audited by this monitor.",
    ),
  );
});

test("Surabaya sources activate only for a matching Indonesian location", () => {
  const local = selectMonitoredSources("Indonesia", null, {
    now: new Date("2026-08-16T12:00:00.000Z"),
    locations: ["Surabaya, Indonesia"],
  });
  const elsewhere = selectMonitoredSources("Indonesia", null, {
    now: new Date("2026-08-16T12:00:00.000Z"),
    locations: ["Jakarta, Indonesia"],
  });

  assert.ok(local.sources.some((source) => source.id === "surabaya-regulations"));
  assert.ok(local.sources.some((source) => source.id === "surabaya-dlh-notices"));
  assert.ok(!elsewhere.sources.some((source) => source.id === "surabaya-regulations"));
  assert.ok(
    elsewhere.coverageCaveats.some((caveat) =>
      caveat.includes("belum cocok dengan adapter regional"),
    ),
  );
  assert.equal(
    local.sources.find((source) => source.id === "surabaya-dlh-notices")?.windowStart,
    "2026-07-02",
  );
});
