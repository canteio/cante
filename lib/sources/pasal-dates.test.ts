import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichPasalDates,
  parseIndonesianDate,
  parsePasalDatesFromHtml,
} from "@/lib/sources/pasal-dates";
import type { RegulationEntry } from "@/lib/sources/fetch";

/** Markup copied from the live Permenperin 22/2026 page, 18 Aug 2026. */
const LIVE_MARKUP = `
<div><dt class="text-muted-foreground text-xs">Pemrakarsa</dt><dd><template id="P:16"></template></dd></div>
<div><dt class="text-muted-foreground text-xs">Penetapan</dt><dd>Jakarta, 15 Juli 2026</dd><dd class="text-muted-foreground">Agus Gumiwang Kartasasmita</dd></div>
<div><dt class="text-muted-foreground text-xs">Pengundangan</dt><dd>31 Juli 2026</dd><dd class="text-muted-foreground">LN 2026 No. 529</dd><dd class="text-muted-foreground">Dhahana Putra</dd></div>
`;

function entry(overrides: Partial<RegulationEntry> = {}): RegulationEntry {
  return {
    sourceId: "kemenperin-pasal",
    sourceName: "pasal.id",
    domain: "pasal.id",
    regulationType: "national",
    label: "Peraturan Menteri Perindustrian Nomor 22 Tahun 2026",
    number: "22",
    year: 2026,
    listingTitle: "Permenperin 22/2026",
    truncated: false,
    fullTitle: "Permenperin 22/2026 tentang Pemberlakuan SNI.",
    url: "https://pasal.id/akn/id/act/permenperin/2026/22",
    foundInViews: ["kemenperin-permen"],
    ...overrides,
  };
}

test("Indonesian dates parse, and a non-date is not coerced into one", () => {
  assert.equal(parseIndonesianDate("15 Juli 2026"), "2026-07-15");
  assert.equal(parseIndonesianDate("Jakarta, 15 Juli 2026"), "2026-07-15");
  assert.equal(parseIndonesianDate("1 Januari 2020"), "2020-01-01");
  assert.equal(parseIndonesianDate("Agus Gumiwang Kartasasmita"), null);
  assert.equal(parseIndonesianDate(""), null);
  assert.equal(parseIndonesianDate("32 Juli 2026"), null, "an impossible day is not a date");
  assert.equal(parseIndonesianDate("15 Rogueber 2026"), null, "an unknown month is not a date");
});

test("both dates and the Berita Negara citation are read off the live markup", () => {
  const dates = parsePasalDatesFromHtml(LIVE_MARKUP);
  assert.equal(dates.penetapan, "2026-07-15");
  assert.equal(dates.pengundangan, "2026-07-31");
  assert.equal(dates.beritaNegara, "LN 2026 No. 529");
});

test("the signatory name in the same block is not mistaken for a date", () => {
  // Penetapan carries two <dd>s: the date, then who signed it.
  const dates = parsePasalDatesFromHtml(LIVE_MARKUP);
  assert.equal(dates.penetapan, "2026-07-15");
  assert.notEqual(dates.beritaNegara, "Agus Gumiwang Kartasasmita");
});

test("a page with no date block yields nulls rather than a guess", () => {
  const dates = parsePasalDatesFromHtml("<div><p>Tidak ada tanggal di sini.</p></div>");
  assert.equal(dates.penetapan, null);
  assert.equal(dates.pengundangan, null);
  assert.equal(dates.beritaNegara, null);
});

test("a resolved date lands on the entry as prose, without claiming an effective date", async () => {
  const target = entry();
  const result = await enrichPasalDates([target], {
    fetchImpl: (async () => new Response(LIVE_MARKUP, { status: 200 })) as unknown as typeof fetch,
  });

  assert.equal(result.resolved, 1);
  assert.match(target.datesNote!, /Ditetapkan 2026-07-15/);
  assert.match(target.datesNote!, /Diundangkan 2026-07-31/);
  assert.match(
    target.datesNote!,
    /Tanggal berlaku menurut pasal penutup belum dipastikan/,
    "promulgation is not the legal effective date and must not be presented as one",
  );
  assert.equal(target.effectiveOn, undefined, "effectiveOn stays unset — no source established it");
});

test("a failed lookup leaves the entry dateless and says so, instead of throwing", async () => {
  const target = entry();
  const result = await enrichPasalDates([target], {
    fetchImpl: (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
  });

  assert.equal(result.resolved, 0);
  assert.equal(target.datesNote, undefined);
  assert.ok(
    result.caveats.some((caveat) => caveat.includes("tidak berhasil")),
    "a silent enrichment failure must be disclosed, never look like a dated entry",
  );
});

test("an HTTP error is a failure, not a date", async () => {
  const target = entry();
  const result = await enrichPasalDates([target], {
    fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
  });
  assert.equal(result.resolved, 0);
  assert.equal(target.datesNote, undefined);
});

test("entries that already carry dates are skipped, so an API-supplied date costs no fetch", async () => {
  let calls = 0;
  const already = entry({ datesNote: "Ditetapkan 2026-07-15. " });
  const result = await enrichPasalDates([already], {
    fetchImpl: (async () => {
      calls += 1;
      return new Response(LIVE_MARKUP, { status: 200 });
    }) as unknown as typeof fetch,
  });

  assert.equal(calls, 0, "forward compatibility: the day pasal.id exposes dates, this does nothing");
  assert.equal(result.attempted, 0);
});

test("non-pasal entries are never touched", async () => {
  let calls = 0;
  const setneg = entry({ domain: "jdih.setneg.go.id", sourceId: "setneg" });
  const result = await enrichPasalDates([setneg], {
    fetchImpl: (async () => {
      calls += 1;
      return new Response(LIVE_MARKUP, { status: 200 });
    }) as unknown as typeof fetch,
  });

  assert.equal(calls, 0);
  assert.equal(result.attempted, 0);
});

test("lookups are bounded per run, and the overflow is disclosed", async () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    entry({ url: `https://pasal.id/akn/id/act/permenperin/2026/${i}` }),
  );
  let calls = 0;
  const result = await enrichPasalDates(many, {
    fetchImpl: (async () => {
      calls += 1;
      return new Response(LIVE_MARKUP, { status: 200 });
    }) as unknown as typeof fetch,
  });

  assert.equal(calls, 25, "a bad ledger diff must not turn into a crawl");
  assert.ok(result.caveats.some((caveat) => caveat.includes("dibatasi")));
});
