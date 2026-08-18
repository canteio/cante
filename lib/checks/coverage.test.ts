import assert from "node:assert/strict";
import test from "node:test";
import { auditVerdictCoverage, normalizeUrlKey } from "@/lib/checks/coverage";
import type { RegulationEntry } from "@/lib/sources/fetch";

function entry(url: string, label = url): RegulationEntry {
  return {
    sourceId: "src",
    sourceName: "Source",
    domain: "example.go.id",
    regulationType: "national",
    label,
    number: null,
    year: 2026,
    listingTitle: label,
    truncated: false,
    fullTitle: label,
    url,
    foundInViews: ["view"],
  };
}

test("every entry judged leaves nothing unaccounted", () => {
  const regs = [entry("https://a.go.id/1"), entry("https://a.go.id/2")];
  const coverage = auditVerdictCoverage(regs, ["https://a.go.id/1", "https://a.go.id/2"], []);
  assert.equal(coverage.judged, 2);
  assert.equal(coverage.alreadySeen, 0);
  assert.equal(coverage.unaccounted.length, 0);
  assert.equal(coverage.caveats.length, 1, "no unaccounted-detail caveat when nothing is missing");
});

test("an entry matching a prior run's exact URL is alreadySeen, not unaccounted", () => {
  const regs = [entry("https://a.go.id/1")];
  const coverage = auditVerdictCoverage(regs, [], ["https://a.go.id/1"]);
  assert.equal(coverage.judged, 0);
  assert.equal(coverage.alreadySeen, 1);
  assert.equal(coverage.unaccounted.length, 0);
});

test("an entry neither judged this run nor seen before is unaccounted, and named in the caveat", () => {
  const regs = [entry("https://a.go.id/1", "Regulation One"), entry("https://a.go.id/2", "Regulation Two")];
  const coverage = auditVerdictCoverage(regs, ["https://a.go.id/1"], []);
  assert.equal(coverage.judged, 1);
  assert.equal(coverage.unaccounted.length, 1);
  assert.equal(coverage.unaccounted[0].url, "https://a.go.id/2");
  assert.ok(coverage.caveats.some((c) => c.includes("Regulation Two")));
  assert.ok(
    coverage.caveats.some((c) => c.includes("belum diperiksa")),
    "Indonesian caveat must say 'unchecked', never 'nothing relevant'",
  );
});

test("English caveats say 'unchecked', never imply a clean pass", () => {
  const regs = [entry("https://a.go.id/1")];
  const coverage = auditVerdictCoverage(regs, [], [], "en");
  assert.ok(coverage.caveats.some((c) => c.includes("Treat them as unchecked")));
});

test("URL matching ignores a trailing slash and case", () => {
  const regs = [entry("https://A.go.id/Path/")];
  const coverage = auditVerdictCoverage(regs, ["https://a.go.id/path"], []);
  assert.equal(coverage.judged, 1);
  assert.equal(coverage.unaccounted.length, 0);
});

test("a missing URL can never spuriously match another missing URL", () => {
  // Both a judged entry's URL and a fetched entry's URL can normalize to "".
  // If empty keys were allowed into the lookup sets, every no-URL entry would
  // spuriously "match" every other no-URL entry. auditVerdictCoverage() guards
  // this by filtering falsy keys out of the sets entirely, so a no-URL entry
  // always falls through to unaccounted rather than being silently counted as
  // judged — the safe failure mode for something with nothing to key on.
  const regs = [entry("", "No URL at all")];
  regs[0].url = null as unknown as string;
  const coverage = auditVerdictCoverage(regs, [null], []);
  assert.equal(coverage.judged, 0);
  assert.equal(coverage.unaccounted.length, 1);
});

test("normalizeUrlKey is stable across whitespace, case, and a trailing slash", () => {
  assert.equal(normalizeUrlKey(" https://X.go.id/Foo/ "), normalizeUrlKey("https://x.go.id/foo"));
  assert.equal(normalizeUrlKey(null), normalizeUrlKey(undefined));
});

test("caveat lists at most 5 unaccounted examples and says 'and others' beyond that", () => {
  const regs = Array.from({ length: 7 }, (_, i) => entry(`https://a.go.id/${i}`, `Reg ${i}`));
  const coverage = auditVerdictCoverage(regs, [], []);
  assert.equal(coverage.unaccounted.length, 7);
  const detail = coverage.caveats.find((c) => c.includes("Reg 0"));
  assert.ok(detail);
  assert.ok(detail!.includes("dan lainnya"));
  assert.ok(!detail!.includes("Reg 5"));
});
