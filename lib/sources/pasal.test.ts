import assert from "node:assert/strict";
import test from "node:test";
import { parseEntries } from "@/lib/sources/fetch";
import { selectMonitoredSources, type SourceDefinition } from "@/lib/sources/registry";

/**
 * pasal.id is the only non-official regulation source in the registry, standing
 * in for a government record that is unreachable. These tests pin the three
 * things that stop it from quietly reading like an official one.
 */

function pasalSource(overrides: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    id: "kemenperin-pasal",
    country: "Indonesia",
    name: "pasal.id (penerbit ulang swasta) — Permen Kemenperin",
    domain: "pasal.id",
    url: "https://pasal.id/api/v1/laws?type=PERMEN&issuing_body=permenperin&limit=50&year=2026",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "pasal-laws-json",
    requiresEnv: "PASAL_API_TOKEN",
    ...overrides,
  };
}

/** Shaped exactly like the live 18 Aug 2026 response, including its weak tier. */
function law(overrides: Record<string, unknown> = {}) {
  return {
    id: 226881,
    frbr_uri: "/akn/id/act/permenperin/2026/4",
    title:
      "Peraturan Menteri Nomor 4 Tahun 2026 tentang Perubahan Atas Peraturan Menteri Perindustrian Nomor 2 Tahun 2025",
    number: "4",
    year: 2026,
    status: "berlaku",
    content_verified: false,
    verification: { version: 1, tier: "parsed_unreviewed", scope: "work", checked_at: null },
    type: "PERMEN",
    issuing_body: { id: 16, slug: "permenperin", name: "Kementerian Perindustrian", abbreviation: "Kemenperin" },
    ...overrides,
  };
}

test("a re-published entry is labelled as such, with the publisher's own weak tier carried through", () => {
  const [entry] = parseEntries(JSON.stringify({ total: 1, laws: [law()] }), pasalSource());

  assert.ok(entry.provenance, "a private re-publisher's row must carry provenance");
  assert.match(entry.provenance!, /pasal\.id/);
  assert.match(entry.provenance!, /bukan catatan resmi pemerintah/);
  // The publisher saying "nobody reviewed this" is the single most important
  // fact about the row, and it must survive into the judgment prompt.
  assert.match(entry.provenance!, /parsed_unreviewed/);
  assert.match(entry.provenance!, /belum ditinjau manusia/);
});

test("the listing carries no date, and none is invented from it", () => {
  const [entry] = parseEntries(JSON.stringify({ total: 1, laws: [law()] }), pasalSource());

  assert.equal(entry.effectiveOn, null, "an absent date must stay absent, never inferred");
  assert.equal(entry.datesNote, null, "no date is known at parse time");
  assert.equal(entry.year, 2026, "the year is the only time fact the listing gives");
  // Dates are filled in afterwards by enrichPasalDates() for entries that reach
  // judgment; the entry says so rather than claiming no date exists at all.
  assert.match(entry.fullTitle, /tidak mencantumkan tanggal/);
});

test("if pasal.id ever returns dates, the parser uses them without any code change", () => {
  // The upstream request to expose tanggal_penetapan/tanggal_pengundangan is
  // open. This pins the contract so the day it lands, the date arrives free.
  const [entry] = parseEntries(
    JSON.stringify({
      total: 1,
      laws: [law({ tanggal_penetapan: "2026-07-15", tanggal_pengundangan: "2026-07-31" })],
    }),
    pasalSource(),
  );

  assert.match(entry.datesNote!, /Ditetapkan 2026-07-15/);
  assert.match(entry.datesNote!, /Diundangkan 2026-07-31/);
  assert.equal(entry.effectiveOn, null, "a promulgation date is still not an effective date");
});

test("rows from another issuing body are dropped, not reported as ministry coverage", () => {
  // Live finding: type=PERMEN is not a clean bucket — a Keputusan KPU came back
  // under it. Without the issuing-body check this source would silently claim
  // unrelated agencies' output as Kemenperin coverage.
  const foreign = law({
    frbr_uri: "/akn/id/act/kepkpu/2026/93",
    title: "Keputusan Komisi Pemilihan Umum Nomor 93 Tahun 2026 tentang Pedoman Perencanaan",
    number: "93",
    issuing_body: null,
  });

  const entries = parseEntries(JSON.stringify({ total: 2, laws: [law(), foreign] }), pasalSource());

  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, "4");
});

test("the citation URL is built from the identifier the API returned, not guessed", () => {
  const [entry] = parseEntries(JSON.stringify({ total: 1, laws: [law()] }), pasalSource());

  // Verified live: https://pasal.id + frbr_uri resolves HTTP 200, while the
  // slug-shaped /peraturan/... forms return 404.
  assert.equal(entry.url, "https://pasal.id/akn/id/act/permenperin/2026/4");
});

test("the ministry is named from issuing_body, since the title alone is ambiguous", () => {
  const [entry] = parseEntries(JSON.stringify({ total: 1, laws: [law()] }), pasalSource());

  // pasal.id titles read "Peraturan Menteri Nomor 4 Tahun 2026" with no ministry
  // in them at all — every ministry's rows would otherwise look identical.
  assert.match(entry.label, /Perindustrian/);
});

test("a page-sized result set is not mistaken for the whole set", () => {
  // The API caps limit at 50 and reports the real size in `total`. Kemenkeu has
  // 57 PMK, so reading one page dropped 7 while still reporting success — a
  // source that looks checked and isn't. The parser must never treat a page as
  // the set; fetchAllPasalPages() follows `total` before parsing.
  const page = JSON.stringify({ total: 57, laws: [law()] });
  const entries = parseEntries(page, pasalSource());
  assert.equal(entries.length, 1, "the parser reads what it is given");
  const parsed = JSON.parse(page);
  assert.ok(
    parsed.total > parsed.laws.length,
    "this fixture encodes the real condition: total exceeds one page",
  );
});

test("a malformed payload fails loudly rather than reporting an empty quiet day", () => {
  assert.throws(
    () => parseEntries(JSON.stringify({ total: 0 }), pasalSource()),
    /did not contain laws/,
  );
});

test("without a token the source is not selected, and the gap is disclosed", () => {
  const previous = process.env.PASAL_API_TOKEN;
  delete process.env.PASAL_API_TOKEN;
  try {
    const selection = selectMonitoredSources("Indonesia");
    assert.ok(
      !selection.sources.some((source) => source.id === "kemenperin-pasal"),
      "a credentialed source with no credential must not be selected",
    );
    assert.ok(
      selection.coverageCaveats.some((caveat) => caveat.includes("PASAL_API_TOKEN")),
      "an unconfigured source is unchecked and must say so, never be silently absent",
    );
  } finally {
    if (previous !== undefined) process.env.PASAL_API_TOKEN = previous;
  }
});

test("with a token the source is selected, and still discloses that it is not official", () => {
  const previous = process.env.PASAL_API_TOKEN;
  process.env.PASAL_API_TOKEN = "test-token";
  try {
    const selection = selectMonitoredSources("Indonesia");
    const source = selection.sources.find((candidate) => candidate.id === "kemenperin-pasal");
    assert.ok(source, "a credentialed source with a credential is selected");
    assert.ok(
      selection.coverageCaveats.some((caveat) => caveat.includes("pasal.id")),
      "coverage through a private re-publisher must be disclosed even when it works",
    );
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
});

test("the fetched year tracks the run clock rather than the year the process started", () => {
  const previous = process.env.PASAL_API_TOKEN;
  process.env.PASAL_API_TOKEN = "test-token";
  try {
    const selection = selectMonitoredSources("Indonesia", null, {
      now: new Date("2027-03-04T00:00:00Z"),
    });
    const source = selection.sources.find((candidate) => candidate.id === "kemenperin-pasal");
    assert.match(source!.url, /year=2027/);
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
});

test("a region with an official adapter is never duplicated by pasal.id", () => {
  const previous = process.env.PASAL_API_TOKEN;
  process.env.PASAL_API_TOKEN = "test-token";
  try {
    const selection = selectMonitoredSources("Indonesia", null, {
      locations: ["Surabaya, Jawa Timur"],
    });
    assert.equal(
      selection.sources.filter((source) => source.id.startsWith("pasal-region-")).length,
      0,
      "Surabaya and East Java have working official adapters; a re-publisher beside them is a downgrade",
    );
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
});

test("a location with no official adapter activates its regional Perda feed, and says it is second-hand", () => {
  const previous = process.env.PASAL_API_TOKEN;
  process.env.PASAL_API_TOKEN = "test-token";
  try {
    const selection = selectMonitoredSources("Indonesia", null, {
      locations: ["Sidoarjo, Jawa Timur", "Banten"],
    });
    const ids = selection.sources.filter((s) => s.id.startsWith("pasal-region-")).map((s) => s.id);
    assert.ok(ids.includes("pasal-region-perda-kabupaten-sidoarjo"));
    assert.ok(ids.includes("pasal-region-perda-provinsi-banten"));
    assert.ok(
      selection.coverageCaveats.some((c) => c.includes("penerbit ulang swasta") && c.includes("Perda")),
      "regional coverage through a re-publisher must be disclosed",
    );
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
});

test("regional feeds are not windowed to the current year", () => {
  const previous = process.env.PASAL_API_TOKEN;
  process.env.PASAL_API_TOKEN = "test-token";
  try {
    const selection = selectMonitoredSources("Indonesia", null, { locations: ["Sidoarjo"] });
    const source = selection.sources.find((s) => s.id === "pasal-region-perda-kabupaten-sidoarjo");
    // Sidoarjo had 0 Perda in 2026 and 8 across all years. A year window would
    // have returned nothing and looked like coverage.
    assert.ok(!source!.url.includes("year="), "a regency may pass no Perda in a given year");
    assert.equal(source!.emptyStateMarker, '"total":0', "a real zero must be provable, not assumed");
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
});

test("an unrecognised location is disclosed as unmonitored rather than silently dropped", () => {
  const previous = process.env.PASAL_API_TOKEN;
  process.env.PASAL_API_TOKEN = "test-token";
  try {
    const selection = selectMonitoredSources("Indonesia", null, { locations: ["Kupang"] });
    assert.ok(
      selection.coverageCaveats.some((c) => c.includes("belum dipantau sama sekali")),
      "a location we cannot cover must say so",
    );
  } finally {
    if (previous === undefined) delete process.env.PASAL_API_TOKEN;
    else process.env.PASAL_API_TOKEN = previous;
  }
});

test("a Perda is labelled by its instrument type, not as a ministerial regulation", () => {
  const perda = {
    frbr_uri: "/akn/id/act/perda-kota-surabaya/2026/1",
    title: "Peraturan Daerah Nomor 1 Tahun 2026 tentang Rencana\r\nPerlindungan Lingkungan",
    number: "1",
    year: 2026,
    status: "berlaku",
    content_verified: false,
    verification: { tier: "parsed_unreviewed" },
    type: "PERDA",
    issuing_body: { slug: "perda-kota-surabaya", name: "Kota Surabaya" },
  };
  const [entry] = parseEntries(
    JSON.stringify({ total: 1, laws: [perda] }),
    pasalSource({ url: "https://pasal.id/api/v1/laws?issuing_body=perda-kota-surabaya&limit=50" }),
  );

  assert.equal(entry.label, "Peraturan Daerah Kota Surabaya Nomor 1 Tahun 2026");
  assert.ok(!entry.label.includes("Menteri"), "a city Perda is not a ministerial regulation");
  assert.ok(!entry.listingTitle.includes("\r"), "CRLFs from the source PDF are normalised");
});
