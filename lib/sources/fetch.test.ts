import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchAllSources, parseEntries } from "@/lib/sources/fetch";
import type { SourceDefinition } from "@/lib/sources/registry";

function source(overrides: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    id: "test-source",
    country: "United States",
    name: "Test source",
    domain: "www.ecfr.gov",
    url: "https://www.ecfr.gov/api/versioner/v1/versions/title-29.json?issue_date%5Bgte%5D=2026-08-01",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "ecfr-versions-json",
    ...overrides,
  };
}

test("eCFR entries retain every dated amendment and use valid citation types", () => {
  const entries = parseEntries(
    JSON.stringify({
      content_versions: [
        {
          title: "29",
          type: "section",
          identifier: "4044.54",
          name: "Section 4044.54",
          amendment_date: "2026-07-29",
          substantive: true,
          removed: false,
        },
        {
          title: "29",
          type: "section",
          identifier: "4044.54",
          name: "Section 4044.54",
          amendment_date: "2026-07-31",
          substantive: true,
          removed: false,
        },
        {
          title: "31",
          type: "appendix",
          identifier: "Appendix A to Chapter V",
          name: "Appendix A to Chapter V",
          amendment_date: "2026-07-27",
          substantive: true,
          removed: false,
        },
      ],
    }),
    source(),
  );

  assert.equal(entries.length, 3);
  assert.match(entries[0].url, /#cante-amendment-2026-07-31$/);
  assert.match(entries[1].url, /#cante-amendment-2026-07-29$/);
  assert.match(entries[2].url, /\/appendix-Appendix%20A%20to%20Chapter%20V/);
  assert.equal(entries[0].amendedOn, "2026-07-31");
  assert.equal(entries[0].effectiveOn, null);
  assert.ok(Object.hasOwn(entries[0], "effectiveOn"));
});

test("Federal Register entries preserve explicit null date fields", () => {
  const [entry] = parseEntries(
    JSON.stringify({
      results: [
        {
          title: "A proposed rule",
          type: "Proposed Rule",
          document_number: "2026-12345",
          html_url: "https://www.federalregister.gov/d/2026-12345",
          raw_text_url: "https://www.federalregister.gov/documents/full_text/text/2026-12345.txt",
          publication_date: "2026-08-16",
          effective_on: null,
          comments_close_on: null,
          dates: null,
          action: null,
        },
      ],
    }),
    source({ parser: "federal-register-json", domain: "www.federalregister.gov" }),
  );

  assert.equal(entry.effectiveOn, null);
  assert.equal(entry.commentsCloseOn, null);
  assert.equal(entry.datesNote, null);
  assert.equal(entry.action, null);
  assert.ok(Object.hasOwn(entry, "effectiveOn"));
  assert.ok(Object.hasOwn(entry, "commentsCloseOn"));
});

test("eCFR pagination combines every page before parsing", async () => {
  const originalFetch = global.fetch;
  const requested: string[] = [];
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-fetch-test-"));

  global.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const page = new URL(url).searchParams.get("page") ?? "1";
    return new Response(
      JSON.stringify({
        meta: { total_pages: "2" },
        content_versions: [
          {
            title: "29",
            type: "section",
            identifier: `100.${page}`,
            name: `Section 100.${page}`,
            amendment_date: `2026-08-0${page}`,
            substantive: true,
            removed: false,
          },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const report = await fetchAllSources([source()], rawDir);
    assert.equal(requested.length, 2);
    assert.equal(new URL(requested[1]).searchParams.get("page"), "2");
    assert.equal(report.outcomes[0].entriesParsed, 2);
    assert.equal(report.regulations.length, 2);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});

test("an empty incremental eCFR window is a valid quiet result", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-fetch-empty-test-"));
  global.fetch = async () =>
    new Response(JSON.stringify({ meta: { result_count: "0" }, content_versions: [] }), {
      status: 200,
    });

  try {
    const report = await fetchAllSources(
      [source({ emptyStateMarker: '"content_versions":[]' })],
      rawDir,
    );
    assert.equal(report.outcomes[0].success, true);
    assert.equal(report.outcomes[0].validEmpty, true);
    assert.equal(report.outcomes[0].parseWarning, null);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});
