import assert from "node:assert/strict";
import test from "node:test";
import { fallbackCaveat, selectFallbackSources } from "@/lib/sources/fallback";
import type { FetchOutcome, FetchReport } from "@/lib/sources/fetch";

function outcome(sourceId: string, success: boolean): FetchOutcome {
  return {
    sourceId,
    name: sourceId,
    domain: "example.go.id",
    view: undefined,
    url: "https://example.go.id",
    fetchedAt: "2026-08-18T00:00:00.000Z",
    success,
    errorMessage: success ? null : "This operation was aborted",
    rawContentPath: null,
    contentLength: 0,
    entriesParsed: success ? 7 : 0,
    parseWarning: null,
    skipped: false,
    validEmpty: false,
  };
}

function report(outcomes: FetchOutcome[]): FetchReport {
  return {
    runAt: "2026-08-18T00:00:00.000Z",
    outcomes,
    regulations: [],
    heartbeats: [],
    coverageCaveats: [],
  };
}

function withToken<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.PASAL_API_TOKEN;
  if (value === undefined) delete process.env.PASAL_API_TOKEN;
  else process.env.PASAL_API_TOKEN = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
}

test("a healthy run fetches no backup at all", () => {
  withToken("test-token", () => {
    const selected = selectFallbackSources(report([outcome("kemenkeu-jdih", true)]));
    assert.equal(selected.length, 0, "a working primary must cost nothing");
  });
});

test("a failed Kemenkeu activates the re-publisher backup", () => {
  withToken("test-token", () => {
    const selected = selectFallbackSources(report([outcome("kemenkeu-jdih", false)]));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, "kemenkeu-pasal-fallback");
    assert.equal(selected[0].domain, "pasal.id");
    assert.match(selected[0].url, /issuing_body=permenkeu/);
  });
});

test("a different source failing does not activate the Kemenkeu backup", () => {
  withToken("test-token", () => {
    const selected = selectFallbackSources(report([outcome("bsn-pesta", false)]));
    assert.equal(selected.length, 0, "backups are paired to one primary, not to any failure");
  });
});

test("without a credential no backup is claimed", () => {
  withToken(undefined, () => {
    const selected = selectFallbackSources(report([outcome("kemenkeu-jdih", false)]));
    assert.equal(selected.length, 0);
  });
});

test("the fetched year tracks the run clock", () => {
  withToken("test-token", () => {
    const selected = selectFallbackSources(report([outcome("kemenkeu-jdih", false)]), {
      now: new Date("2027-02-01T00:00:00Z"),
    });
    assert.match(selected[0].url, /year=2027/);
  });
});

test("the caveat says the official source failed and this is not a substitute", () => {
  const caveat = fallbackCaveat("kemenkeu-pasal-fallback");
  assert.match(caveat, /gagal diakses/, "the primary's failure must stay visible");
  assert.match(caveat, /penerbit ulang swasta/, "the backup must be labelled second-hand");
  assert.match(
    caveat,
    /bukan pengganti/,
    "a backup must never read as having completed the official check",
  );
});
