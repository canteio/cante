import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

function futureSource(
  parser: string,
  overrides: Partial<SourceDefinition> & { profileCodes?: string[] } = {},
): SourceDefinition {
  return {
    ...source(),
    parser,
    ...overrides,
  } as SourceDefinition;
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

test("Federal Register fetching exhausts documented pagination", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-fr-fetch-test-"));
  const requested: string[] = [];
  global.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const page = Number(new URL(url).searchParams.get("page") ?? 1);
    return new Response(
      JSON.stringify({
        total_pages: 2,
        next_page_url: page === 1 ? "https://www.federalregister.gov/api/v1/documents.json?page=2" : null,
        results: [
          {
            title: `Rule ${page}`,
            type: "Rule",
            document_number: `2026-0000${page}`,
            html_url: `https://www.federalregister.gov/d/2026-0000${page}`,
            publication_date: `2026-08-0${page}`,
          },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const report = await fetchAllSources(
      [source({ parser: "federal-register-json", domain: "www.federalregister.gov" })],
      rawDir,
    );
    assert.equal(requested.length, 2);
    assert.equal(report.regulations.length, 2);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
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

test("USITC HTS release parser emits a content-versioned refresh signal", () => {
  const [entry] = parseEntries(
    JSON.stringify({
      name: "2026HTSRev16",
      description: "2026 HTS Revision 16",
      title: "Revision 16 (2026)",
    }),
    futureSource("usitc-hts-release", {
      domain: "hts.usitc.gov",
      url: "https://hts.usitc.gov/reststop/currentRelease",
    }),
  );

  assert.equal(entry.number, "2026HTSRev16");
  assert.match(entry.url, /#cante-hts-release-[a-f0-9]{16}$/);
  assert.equal(entry.textUrl, "https://hts.usitc.gov/reststop/currentRelease");
  assert.match(entry.fullTitle, /triggers a tariff-data refresh and product rescreening/);
  assert.match(entry.fullTitle, /not itself a classification or party-screening result/);
});

test("USITC HTS search parser retains rates for the recorded code", () => {
  const entries = parseEntries(
    JSON.stringify([
      {
        htsno: "6306.12.00.00",
        description: "Of synthetic fibers",
        units: ["kg"],
        general: "8.8%",
        special: "Free (AU,CA)",
        other: "90%",
        additionalDuties: null,
      },
      { htsno: "8501.10.40.00", description: "Electric motors", units: ["No."] },
    ]),
    futureSource("usitc-hts-search", {
      profileCodes: ["630612"],
      domain: "hts.usitc.gov",
      url: "https://hts.usitc.gov/reststop/search?keyword=6306.12",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, "6306120000");
  assert.match(entries[0].fullTitle, /General duty: 8\.8%/);
  assert.match(entries[0].fullTitle, /does not establish.*classified correctly/);
});

test("CBP CROSS parser keeps only rulings matching profile HTS codes", () => {
  const entries = parseEntries(
    JSON.stringify({
      rulings: [
        {
          id: 1,
          rulingNumber: "N361799",
          subject: "Synthetic textile cover",
          categories: "Classification, USMCA",
          rulingDate: "2026-06-25T00:00:00",
          collection: "ny",
          tariffs: ["6306.12.0000"],
          operationallyRevoked: false,
        },
        {
          id: 2,
          rulingNumber: "N300000",
          subject: "Unrelated machine",
          categories: "Classification",
          rulingDate: "2026-05-01T00:00:00",
          collection: "ny",
          tariffs: ["8479.89.0000"],
          operationallyRevoked: false,
        },
      ],
      totalHits: 2,
    }),
    futureSource("cbp-cross-json", {
      profileCodes: ["6306.12"],
      domain: "rulings.cbp.gov",
      url: "https://rulings.cbp.gov/api/search",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, "N361799");
  assert.match(entries[0].fullTitle, /6306\.12\.0000/);
  assert.equal(entries[0].url, "https://rulings.cbp.gov/ruling/N361799");
});

test("CBP CROSS fetching exhausts every result page", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-cross-fetch-test-"));
  const requestedPages: string[] = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const page = url.searchParams.get("page") ?? "1";
    requestedPages.push(page);
    return new Response(
      JSON.stringify({
        totalHits: 2,
        rulings: [
          {
            id: Number(page),
            rulingNumber: `N${page}`,
            subject: `Tarpaulin ruling ${page}`,
            categories: "Classification",
            rulingDate: `2026-08-0${page}T00:00:00`,
            collection: "ny",
            tariffs: ["6306.12.0000"],
            operationallyRevoked: false,
          },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const report = await fetchAllSources(
      [
        futureSource("cbp-cross-json", {
          profileCodes: ["630612"],
          domain: "rulings.cbp.gov",
          url: "https://rulings.cbp.gov/api/search?term=6306.12&pageSize=1&page=1",
        }),
      ],
      rawDir,
    );
    assert.deepEqual(requestedPages, ["1", "2"]);
    assert.equal(report.regulations.length, 2);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});

test("USTR Section 301 parser filters the overlay by profile HTS code", () => {
  const entries = parseEntries(
    JSON.stringify([
      {
        HTS_id: 63061200,
        description: "Tarpaulins of synthetic fibers",
        action_description: "List 4 modification - 0.0% duties",
        note: "Confirm current Chapter 99 treatment",
      },
      {
        HTS_id: 85011040,
        description: "Electric motors",
        action_description: "List 3",
        note: "",
      },
    ]),
    futureSource("ustr-301-json", {
      profileCodes: ["6306.12.00.00"],
      domain: "ustr.gov",
      url: "https://ustr.gov/themes/custom/ustr2021/tariff/hts_new.json",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].number, "63061200");
  assert.match(entries[0].fullTitle, /controlling Federal Register notice/);
  assert.equal(entries[0].action, "List 4 modification - 0.0% duties");
});

test("USITC IDS parser retains active and recent import-injury cases", () => {
  const entries = parseEntries(
    JSON.stringify({
      date: "2026-08-13T22:00:02.301+00:00",
      count: 4,
      data: [
        {
          "Investigation ID": 8938,
          "Investigation Number": "701-789",
          "Full Title": "Truck Bed Covers from China",
          Topic: "Truck Bed Covers",
          Countries: [{ name: "China", ID: 49 }],
          "Investigation Type": { Name: "Import Injury" },
          "Investigation Status": { Name: "Active" },
          "Investigation Phase": { Name: "Final" },
          "Start Date": "07-27-2026",
          "Determination Date": null,
        },
        {
          "Investigation ID": 9000,
          "Investigation Number": "731-2000",
          "Full Title": "Recent completed plastics case",
          Topic: "Plastic sheet",
          Countries: [{ name: "Indonesia" }],
          "Investigation Type": { Name: "Import Injury" },
          "Investigation Status": { Name: "Completed" },
          "Investigation Phase": { Name: "Preliminary" },
          "Start Date": "08-02-2026",
          "Determination Date": { date: "2026-08-10T12:00:00.000+00:00" },
        },
        {
          "Investigation ID": 100,
          "Investigation Number": "731-100",
          "Full Title": "Old completed case",
          "Investigation Type": { Name: "Import Injury" },
          "Investigation Status": { Name: "Completed" },
          "Investigation Phase": { Name: "Final" },
          "Start Date": "01-01-2020",
        },
        {
          "Investigation ID": 337,
          "Investigation Number": "337-TA-1",
          "Full Title": "Section 337 case",
          "Investigation Type": { Name: "Unfair Import" },
          "Investigation Status": { Name: "Active" },
          "Investigation Phase": { Name: "Final" },
          "Start Date": "08-01-2026",
        },
      ],
    }),
    futureSource("usitc-ids-json", {
      windowStart: "2026-08-01",
      domain: "ids.usitc.gov",
      url: "https://ids.usitc.gov/investigations.json",
    }),
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(new Set(entries.map((entry) => entry.number)), new Set(["701-789", "731-2000"]));
  assert.match(entries[0].url, /^https:\/\/ids\.usitc\.gov\/case\//);
});

test("USITC IDS fetch posts and exhausts advanced-search pagination", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-ids-fetch-test-"));
  const requestedPages: number[] = [];

  global.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { pageNumber: number; pageSize: number };
    requestedPages.push(body.pageNumber);
    return new Response(
      JSON.stringify({
        cases: [
          {
            id: body.pageNumber,
            level_1_investigations: [
              {
                investigation_type_id: { name: "Import Injury", id: 4 },
                investigation_phase_id: { name: body.pageNumber === 1 ? "Preliminary" : "Final" },
                investigation_id: 9000 + body.pageNumber,
                investigation_number: `701-${800 + body.pageNumber}`,
                investigation_title: `Import injury case ${body.pageNumber}`,
                institution_start_date: `2026-08-0${body.pageNumber}T04:00:00.000+00:00`,
                is_active: true,
                investigation_full_product: `Product ${body.pageNumber}`,
              },
            ],
          },
        ],
        totalRecords: 2,
      }),
      { status: 200 },
    );
  };

  try {
    const report = await fetchAllSources(
      [
        futureSource("usitc-ids-json", {
          id: "us-usitc-ids-import-injury",
          domain: "ids.usitc.gov",
          url: "https://ids.usitc.gov/idata/api/v1/advanced-search",
          requestMethod: "POST",
          requestBody: JSON.stringify({
            pageNumber: 1,
            pageSize: 1,
            criteria: [{ field: { name: "investigation_type_id" } }],
          }),
          requestHeaders: { "Content-Type": "application/json" },
        }),
      ],
      rawDir,
    );

    assert.deepEqual(requestedPages, [1, 2]);
    assert.equal(report.outcomes[0].success, true);
    assert.equal(report.outcomes[0].entriesParsed, 2);
    assert.deepEqual(new Set(report.regulations.map((entry) => entry.number)), new Set(["701-801", "701-802"]));
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});

test("generic dataset snapshots expose count and content-hash identity", () => {
  const definition = futureSource("dataset-snapshot-json", {
    name: "Consolidated Screening List",
    domain: "data.trade.gov",
    url: "https://data.trade.gov/csl.json",
  });
  const [first] = parseEntries(JSON.stringify([{ id: 1 }, { id: 2 }]), definition);
  const [second] = parseEntries(JSON.stringify([{ id: 1 }, { id: 3 }]), definition);

  assert.match(first.listingTitle, /2 records/);
  assert.notEqual(first.url, second.url);
  assert.match(first.url, /#cante-snapshot-[a-f0-9]{16}$/);
  assert.match(first.fullTitle, /triggers customer-party rescreening/);
  assert.match(first.fullTitle, /not itself a party-screening result/);
});

test("UFLPA parser retains statutory list membership and effective date", () => {
  const entries = parseEntries(
    `
      <h2>Section 2(d)(2)(B)(i) entities</h2>
      <table>
        <thead><tr><th>Entity Name</th><th>Effective Date</th></tr></thead>
        <tbody>
          <tr><td>Xinjiang Example Textile Co., Ltd.</td><td>August 1, 2026</td></tr>
          <tr><td>Second Entity</td><td>07/15/2026</td></tr>
        </tbody>
      </table>
    `,
    futureSource("uflpa-html", {
      domain: "www.dhs.gov",
      url: "https://www.dhs.gov/uflpa-entity-list",
    }),
  );

  assert.equal(entries.length, 2);
  assert.match(entries[0].fullTitle, /Section 2\(d\)\(2\)\(B\)\(i\)/);
  assert.equal(entries[0].effectiveOn, "2026-08-01");
  assert.equal(entries[1].effectiveOn, "2026-07-15");
  assert.match(entries[0].fullTitle, /not proof that a customer counterparty was screened/);
});

test("CBP WRO fetch discovers the newest CSV and parses quoted CSV evidence", async () => {
  const originalFetch = global.fetch;
  const rawDir = await mkdtemp(path.join(os.tmpdir(), "cante-wro-fetch-test-"));
  const requested: string[] = [];
  const indexUrl = "https://www.cbp.gov/document/stats/withhold-release-orders-findings";
  const newestCsv = "https://www.cbp.gov/files/withhold-release-orders-findings-2026-08-01.csv";

  global.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === indexUrl) {
      return new Response(
        `<a href="/files/withhold-release-orders-findings-2026-07-01.csv">Old CSV</a>
         <a href="${newestCsv}">Current CSV</a>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    if (url === newestCsv) {
      return new Response(
        '\uFEFFEffective Date,Calendar Year,Country Code,Country,Merchandise,WRO/Finding,Industry,Status,Press Release,Entity,Remarks\r\n' +
          '08/01/2026,2026,ID,Indonesia,"PVC sheet, coated",WRO,Textiles,Active,"/newsroom/example",' +
          '"Example Manufacturing, Ltd.","Line one, with comma\nLine two"\r\n',
        { status: 200, headers: { "Content-Type": "text/csv" } },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const report = await fetchAllSources(
      [
        futureSource("cbp-wro-csv", {
          id: "us-cbp-wro-findings",
          name: "CBP WRO and Findings",
          domain: "www.cbp.gov",
          url: indexUrl,
          rawFilename: "cbp-wro.json",
        }),
      ],
      rawDir,
    );

    assert.deepEqual(requested, [indexUrl, newestCsv]);
    assert.equal(report.outcomes[0].success, true);
    assert.equal(report.outcomes[0].entriesParsed, 1);
    assert.equal(report.regulations[0].listingTitle, "Example Manufacturing, Ltd. - PVC sheet, coated");
    assert.equal(report.regulations[0].effectiveOn, "2026-08-01");
    assert.equal(report.regulations[0].textUrl, newestCsv);
    assert.match(report.regulations[0].url, /#cante-wro-[a-f0-9]{16}$/);
    assert.match(report.regulations[0].fullTitle, /Line one, with comma\nLine two/);
    const raw = await readFile(path.join(rawDir, "cbp-wro.json"), "utf8");
    assert.match(raw, /^Effective Date,/);
    assert.doesNotMatch(raw, /^\{/);
  } finally {
    global.fetch = originalFetch;
    await rm(rawDir, { recursive: true, force: true });
  }
});
