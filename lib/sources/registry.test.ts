import assert from "node:assert/strict";
import test from "node:test";
import {
  selectMonitoredSources,
  type SourceSelectionProfile,
} from "@/lib/sources/registry";

function profile(
  overrides: Partial<SourceSelectionProfile> = {},
): SourceSelectionProfile {
  return {
    facilityAddresses: [],
    products: [],
    distributionStates: [],
    labelsClaims: [],
    htsScheduleBCodes: [],
    exportClassifications: [],
    exportCountries: [],
    regulatedProductFlags: [],
    ...overrides,
  };
}

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
  assert.ok(
    selection.coverageCaveats.includes(
      "Federal Register bootstrap coverage begins 2026-08-09. Earlier documents were not historically audited by this monitor.",
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

test("US trade datasets activate for a recorded HTS code", () => {
  const selection = selectMonitoredSources(
    "United States",
    profile({ htsScheduleBCodes: [{ code: "6306.12.0000" }] }),
    { now: new Date("2026-08-16T12:00:00.000Z") },
  );
  const ids = new Set(selection.sources.map((source) => source.id));

  for (const id of [
    "us-usitc-hts-release",
    "us-usitc-hts-630612",
    "us-cbp-csms",
    "us-fr-section-301",
    "us-fr-section-232-bis",
    "us-fr-section-232-ita",
    "us-fr-commerce-adcvd",
    "us-fr-usitc-import-injury",
    "us-fr-uflpa",
    "us-usitc-ids-import-injury",
    "us-ustr-section-301-hts",
    "us-trade-csl",
    "us-cbp-forced-labor",
    "us-dhs-uflpa-entities",
    "us-cbp-wro-findings",
    "us-cbp-cross-630612",
  ]) {
    assert.ok(ids.has(id), `expected ${id} to be selected`);
  }

  const cross = selection.sources.find(
    (source) => source.id === "us-cbp-cross-630612",
  );
  const hts = selection.sources.find((source) => source.id === "us-usitc-hts-630612");
  const ustr = selection.sources.find((source) => source.id === "us-ustr-section-301-hts");
  assert.deepEqual(cross?.profileCodes, ["630612"]);
  assert.deepEqual(hts?.profileCodes, ["630612"]);
  assert.deepEqual(ustr?.profileCodes, ["630612"]);
  assert.equal(new URL(cross!.url).searchParams.get("term"), "6306.12");
  assert.equal(new URL(hts!.url).searchParams.get("keyword"), "6306.12");
  assert.ok(selection.coverageCaveats.some((caveat) => caveat.includes("HTS-to-PGA")));
});

test("US trade selection exposes POST metadata and targeted Federal Register terms", () => {
  const selection = selectMonitoredSources(
    "United States",
    profile({ htsScheduleBCodes: [{ code: "630612" }] }),
  );
  const ids = new Map(selection.sources.map((source) => [source.id, source]));
  const idsSource = ids.get("us-usitc-ids-import-injury");

  assert.equal(idsSource?.requestMethod, "POST");
  assert.equal(idsSource?.requestHeaders?.["Content-Type"], "application/json");
  assert.equal(
    JSON.parse(idsSource?.requestBody ?? "{}").criteria[0].lines[0].value,
    "Import Injury",
  );

  const expectedTerms = new Map([
    ["us-fr-section-301", "Section 301"],
    ["us-fr-section-232-bis", "Section 232"],
    ["us-fr-section-232-ita", "Section 232"],
    ["us-fr-commerce-adcvd", "antidumping countervailing duty"],
    ["us-fr-usitc-import-injury", "import injury"],
    ["us-fr-uflpa", "UFLPA Entity List"],
  ]);
  for (const [id, term] of expectedTerms) {
    const url = new URL(ids.get(id)!.url);
    assert.equal(url.searchParams.get("conditions[term]"), term);
    assert.match(url.searchParams.get("conditions[publication_date][gte]") ?? "", /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("CROSS sources normalize, deduplicate, and cap recorded HTS codes", () => {
  const htsScheduleBCodes = [
    { code: "6306.12.0000" },
    { code: "6306129999" },
    ...Array.from({ length: 11 }, (_, index) => ({
      code: `${String(1000 + index).padStart(4, "0")}.00.0000`,
    })),
    { code: "invalid" },
  ];
  const selection = selectMonitoredSources(
    "United States",
    profile({ htsScheduleBCodes }),
  );
  const cross = selection.sources.filter((source) => source.parser === "cbp-cross-json");

  assert.equal(cross.length, 10);
  assert.equal(cross.filter((source) => source.id === "us-cbp-cross-630612").length, 1);
  assert.ok(
    selection.coverageCaveats.some((caveat) =>
      caveat.includes("limited to the first 10 distinct recorded HTS-6 codes"),
    ),
  );
});

test("HTS-specific trade sources stay inactive without a trade profile", () => {
  const selection = selectMonitoredSources("United States", profile());
  const ids = new Set(selection.sources.map((source) => source.id));

  assert.ok(ids.has("us-usitc-hts-release"));
  assert.ok(!ids.has("us-cbp-csms"));
  assert.ok(![...ids].some((id) => id.startsWith("us-cbp-cross-")));
  assert.ok(!selection.coverageCaveats.some((caveat) => caveat.includes("HTS-to-PGA")));
});

test("federal tax sources are monitored, and customs duties activate for exporters", () => {
  // The US pack watched thirteen agencies and no tax authority at all, while
  // the Indonesian pack has monitored DJP, DJBC and Kemenkeu from the start.
  const empty = selectMonitoredSources("United States", profile());
  const emptyIds = new Set(empty.sources.map((source) => source.id));

  // Federal tax reaches any company with US operations, so these are ungated —
  // the same reasoning that leaves EPA and OSHA ungated.
  assert.ok(emptyIds.has("us-fr-irs"), "IRS rulemaking is monitored without a profile");
  assert.ok(emptyIds.has("us-ecfr-title-26"), "26 CFR is monitored without a profile");

  // 19 CFR is the customs-duties title — drawback, entry, valuation, origin —
  // so it follows the export gate like Title 15 rather than polling for a
  // company with no trade facts on file.
  assert.ok(!emptyIds.has("us-ecfr-title-19"), "customs duties need an export profile");

  const exporter = selectMonitoredSources(
    "United States",
    profile({ exportClassifications: [{ code: "EAR99" }] }),
  );
  const exporterIds = new Set(exporter.sources.map((source) => source.id));
  assert.ok(exporterIds.has("us-ecfr-title-19"));
  assert.ok(exporterIds.has("us-fr-irs"));
  assert.ok(exporterIds.has("us-ecfr-title-26"));
});

test("the IRS feed asks for the dated fields, like every other Federal Register row", () => {
  const selection = selectMonitoredSources("United States", profile());
  const irs = selection.sources.find((source) => source.id === "us-fr-irs");
  assert.ok(irs);

  const params = new URL(irs.url).searchParams;
  assert.deepEqual(params.getAll("conditions[agencies][]"), ["internal-revenue-service"]);
  // Without fields[] the API returns a short default set carrying no dates at
  // all — the failure that silently gutted every US alert once already.
  const fields = params.getAll("fields[]");
  assert.ok(fields.includes("effective_on"));
  assert.ok(fields.includes("comments_close_on"));
  assert.ok(fields.includes("raw_text_url"));
  assert.equal(irs.regulationType, "tax");
});

test("a domestic manufacturer is a first-class customer, not an exporter with gaps", () => {
  // The export gate used to be inferred from stray codes, so "domestic" was
  // indistinguishable from "exporter whose facts are missing".
  const domestic = selectMonitoredSources(
    "United States",
    profile({ sideOfTrade: "domestic", htsScheduleBCodes: [{ code: "6306.12" }] }),
  );
  const ids = new Set(domestic.sources.map((source) => source.id));

  // A stated fact beats an inferred one: the stray HTS code does not reopen
  // the cross-border packs.
  assert.ok(!ids.has("us-fr-section-301"));
  assert.ok(!ids.has("us-ecfr-title-19"));
  assert.ok(!ids.has("us-bis-ear"));

  // The domestic substance is still fully monitored.
  assert.ok(ids.has("us-fr-epa"));
  assert.ok(ids.has("us-fr-osha"));
  assert.ok(ids.has("us-ecfr-title-29"));
  assert.ok(ids.has("us-ecfr-title-40"));
  assert.ok(ids.has("us-fr-irs"));
});

test("an importer gets Section 301 and 19 CFR without ever exporting", () => {
  // The highest-value US segment: a domestic manufacturer buying foreign
  // inputs. Conflating import with export made this company invisible to the
  // measures that actually cost it money.
  const importer = selectMonitoredSources("United States", profile({ sideOfTrade: "import" }));
  const ids = new Set(importer.sources.map((source) => source.id));

  assert.ok(ids.has("us-fr-section-301"), "Section 301 hits importers");
  assert.ok(ids.has("us-ecfr-title-19"), "19 CFR is customs duties and drawback");
  assert.ok(ids.has("us-fr-commerce-adcvd"));
  assert.ok(ids.has("us-fr-uflpa"));
  assert.ok(ids.has("us-fr-export-cbp"));

  // But not the filings only an exporter makes.
  assert.ok(!ids.has("us-bis-ear"), "EAR is an export control");
  assert.ok(!ids.has("us-census-aes"), "AES/EEI is an export filing");

  const exporter = selectMonitoredSources("United States", profile({ sideOfTrade: "export" }));
  const exporterIds = new Set(exporter.sources.map((source) => source.id));
  assert.ok(exporterIds.has("us-bis-ear"));
  assert.ok(exporterIds.has("us-fr-section-301"), "exporters import inputs too");
});

test("every Indonesian source serves a domestic manufacturer", () => {
  // Indonesia has no export-gated rows at all: national law, tax, environment,
  // labor, SNI, licensing and regional rules apply whether or not anyone ships
  // abroad. Any future export-only Indonesian source must be gated, not added
  // to the default set.
  const domestic = selectMonitoredSources("Indonesia", profile({ sideOfTrade: "domestic" }));
  const all = selectMonitoredSources("Indonesia", profile({ sideOfTrade: "both" }));
  assert.equal(domestic.sources.length, all.sources.length);
  assert.ok(domestic.sources.length >= 10);
});

test("source selection defaults to United States when jurisdiction is omitted", () => {
  const selection = selectMonitoredSources();
  assert.ok(selection.sources.length > 0);
  assert.ok(selection.sources.every((source) => source.country === "United States"));
});
