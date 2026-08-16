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

test("OSS KBLI JSON reports catalogue versions as a heartbeat", () => {
  const entries = parseEntries(
    JSON.stringify({
      success: true,
      data: [
        { id: "version-2020", version: "2020" },
        { id: "version-2025", version: "2025" },
      ],
      code: 200,
    }),
    source({
      id: "oss-kbli",
      country: "Indonesia",
      domain: "gw.oss.go.id",
      url: "https://gw.oss.go.id/v2/portal/kbli/version?lang=id",
      parser: "oss-kbli-versions-json",
      heartbeat: true,
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].year, 2025);
  assert.match(entries[0].fullTitle, /Published catalogue versions: 2020, 2025/);
  assert.match(entries[0].fullTitle, /not a company's license status/);
});

test("a source retries one transient server failure", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-fetch-retry-test-"));
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("temporary failure", { status: 503 });
    return new Response(
      '<a href="/produk/detail/8736-sni00742011">SNI 0074:2011</a>',
      { status: 200 },
    );
  };

  try {
    const report = await fetchAllSources(
      [
        source({
          id: "bsn-pesta-produk",
          country: "Indonesia",
          domain: "pesta.bsn.go.id",
          url: "https://pesta.bsn.go.id/produk",
          parser: "bsn-pesta",
          maxAttempts: 2,
        }),
      ],
      rawDir,
    );
    assert.equal(attempts, 2);
    assert.equal(report.outcomes[0].success, true);
    assert.equal(report.outcomes[0].entriesParsed, 1);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});

test("Setneg parser preserves legal dates and official PDF identity", () => {
  const [entry] = parseEntries(
    JSON.stringify({
      data: [
        {
          idperaturan: "P20579",
          no_peraturan: "24",
          tahun: "2026",
          tentang: "TATA KELOLA EKSPOR KOMODITAS",
          jns: "PP",
          nama_jenis: "Peraturan Pemerintah",
          files: "Salinan PP Nomor 24 Tahun 2026.pdf",
          tgl_di: "2026-05-20T00:00:00.000Z",
          diundangkan: "2026-05-20T00:00:00.000Z",
          status_hukum: "berlaku",
        },
      ],
    }),
    source({
      country: "Indonesia",
      domain: "jdih.setneg.go.id",
      url: "https://jdih.setneg.go.id/api/hukumproduk/produkhukum",
      parser: "setneg-json",
    }),
  );

  assert.equal(entry.number, "24");
  assert.equal(entry.year, 2026);
  assert.equal(entry.effectiveOn, null);
  assert.match(entry.fullTitle, /Diundangkan 2026-05-20/);
  assert.match(entry.url, /fl=P20579/);
});

test("Setneg fetch exhausts pagination for every instrument and both years", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-setneg-pages-test-"));
  const requests: Array<{ type: string; year: string; start: number }> = [];
  global.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      jns: string[];
      thn: string[];
      start: number;
    };
    requests.push({ type: body.jns[0], year: body.thn[0], start: body.start });
    const paged = body.jns[0] === "PP" && body.thn[0] === "2026";
    const count = paged ? 101 : 0;
    const rows = paged
      ? Array.from({ length: body.start === 0 ? 100 : 1 }, (_, index) => ({
          idperaturan: `P-${body.start + index}`,
          no_peraturan: String(body.start + index + 1),
          tahun: "2026",
          tentang: `Rule ${body.start + index + 1}`,
          jns: "PP",
          nama_jenis: "Peraturan Pemerintah",
          files: `rule-${body.start + index + 1}.pdf`,
        }))
      : [];
    return new Response(JSON.stringify({ data: rows, jml: count }), { status: 200 });
  };

  try {
    const report = await fetchAllSources(
      [
        source({
          country: "Indonesia",
          domain: "jdih.setneg.go.id",
          url: "https://jdih.setneg.go.id/api/hukumproduk/produkhukum",
          parser: "setneg-json",
        }),
      ],
      rawDir,
    );
    assert.equal(requests.length, 13);
    assert.ok(requests.some((request) => request.type === "PP" && request.start === 100));
    assert.equal(report.outcomes[0].entriesParsed, 101);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});

test("Surabaya fetch exhausts current and prior year pages", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-surabaya-pages-test-"));
  const requested: string[] = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    const year = url.searchParams.get("tahun")!;
    const page = Number(url.searchParams.get("page"));
    const totalPage = year === "2026" ? 2 : 1;
    return new Response(
      JSON.stringify({
        total: totalPage,
        totalPage,
        data: [
          {
            id: `${year}-${page}`,
            dok_tipe_full: "Peraturan Walikota",
            dok_no: String(page),
            dok_tahun: year,
            dok_judul: `Rule ${year}-${page}`,
            status: "1",
            penetapan_tgl: `${year}-01-0${page}`,
          },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const report = await fetchAllSources(
      [
        source({
          country: "Indonesia",
          domain: "jdih.surabaya.go.id",
          url: "https://jdih.surabaya.go.id/peraturan/ajax",
          parser: "surabaya-regulations-json",
        }),
      ],
      rawDir,
    );
    assert.equal(requested.length, 3);
    assert.equal(report.outcomes[0].entriesParsed, 3);
    assert.match(report.regulations[0].textUrl ?? "", /\/peraturan\/download\//);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});

test("Indonesia sector parsers preserve context and filter old DLH notices", () => {
  const kemnaker = parseEntries(
    '<div class="result-card"><h5><a href="https://jdih.kemnaker.go.id/peraturan/detail/1/rule">Peraturan Menteri Ketenagakerjaan Nomor 11 Tahun 2026</a></h5><p>Keselamatan kerja. Ditetapkan: 10 Agustus 2026</p></div>',
    source({ parser: "kemnaker", domain: "jdih.kemnaker.go.id" }),
  );
  const djp = parseEntries(
    '<div class="peraturan-content"><a href="/id/peraturan/rule">PER-8/PJ/2026</a><p>Administrasi perpajakan | 2026-07-28 | Aktif</p></div>',
    source({ parser: "djp-list", domain: "www.pajak.go.id", url: "https://www.pajak.go.id/id/peraturan" }),
  );
  const dlh = parseEntries(
    JSON.stringify({
      data: [
        { nama_jenis: "Old", jenis_pengumuman: "AMDAL", file: "old.pdf", created_at: "2026-01-01 00:00:00" },
        { nama_jenis: "Current plastic industry", jenis_pengumuman: "UKL-UPL", tgl_mohon: "2026-08-10", file: "new.pdf", created_at: "2026-08-11 00:00:00" },
      ],
    }),
    source({ parser: "surabaya-dlh-json", domain: "lh.surabaya.go.id", windowStart: "2026-07-01" }),
  );

  assert.match(kemnaker[0].fullTitle, /Keselamatan kerja/);
  assert.match(djp[0].fullTitle, /Administrasi perpajakan/);
  assert.equal(dlh.length, 1);
  assert.match(dlh[0].fullTitle, /not a generally applicable regulation/);
});
