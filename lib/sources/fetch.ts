import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type { SourceDefinition } from "@/lib/sources/registry";

/**
 * Port of scripts/fetch_sources.py. Plain fetching and parsing — no model
 * involved, so a fetch failure and a bad judgment call stay separable.
 *
 * Behaviour held identical to the Python original, including the two things
 * that matter most: browser headers (a bare request gets blocked) and a
 * parse-count of zero being reported as a broken parser rather than a quiet day.
 */

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
};

const TIMEOUT_MS = 25_000;
const MAX_GENERIC_ENTRIES = 30;

export interface RegulationEntry {
  sourceId: string;
  sourceName: string;
  domain: string;
  regulationType: string;
  label: string;
  number: string | null;
  year: number | null;
  /** As shown on the site — truncated with an ellipsis. */
  listingTitle: string;
  truncated: boolean;
  /** Complete, lowercased, reconstructed from the detail-URL slug. */
  fullTitle: string;
  url: string;
  /**
   * Where the judgment stage should read the full text, when that is not the
   * same place a human should click. Federal Register HTML pages are ~100KB
   * and intermittently bot-blocked (they 302 to unblock.federalregister.gov);
   * `raw_text_url` is the same document as ~7KB of plain text through the
   * documented API. `url` stays the human-facing link.
   */
  textUrl?: string;
  /**
   * Dates carried by the source itself, already structured. The whole reason
   * Indonesian judgment fetches a detail page is that its listing has no real
   * date — the Federal Register API returns them in the listing, so that fetch
   * is unnecessary rather than merely blocked.
   */
  effectiveOn?: string | null;
  /** eCFR's last amendment date. This is not a legal effective date. */
  amendedOn?: string | null;
  commentsCloseOn?: string | null;
  /** The source's own prose about dates, e.g. "Comments due August 27, 2026". */
  datesNote?: string | null;
  /** "Rule" / "Proposed Rule" / "Notice" — a duty and a proposal differ. */
  documentType?: string | null;
  /** The agency's own one-line description of what the document does. */
  action?: string | null;
  /**
   * Set only when the entry did NOT come from the primary government record —
   * currently pasal.id, a private re-publisher. Entries are JSON-serialized
   * straight into the judgment prompt, so this is how the model learns that a
   * row is second-hand and how strongly its publisher vouches for it. Absent on
   * official sources, because saying nothing there is correct: Setneg and
   * Kemendag *are* the record. Never let a re-published row reach judgment or
   * the customer looking like an official one.
   */
  provenance?: string;
  foundInViews: string[];
}

export interface FetchOutcome {
  sourceId: string;
  name: string;
  domain: string;
  view: string | undefined;
  url: string;
  fetchedAt: string;
  success: boolean;
  errorMessage: string | null;
  rawContentPath: string | null;
  contentLength: number;
  entriesParsed: number;
  parseWarning: string | null;
  /**
   * Not attempted, because an earlier source on the same domain already failed
   * at the connection level this run. Still a failed source — recorded, never
   * hidden — but distinguishable from one that was actually tried.
   */
  skipped: boolean;
  /** The source explicitly supports an empty listing and its marker was present. */
  validEmpty: boolean;
}

export interface FetchReport {
  runAt: string;
  outcomes: FetchOutcome[];
  regulations: RegulationEntry[];
  /**
   * Liveness pings (e.g. "the OSS KBLI portal answered"), kept out of
   * `regulations` so they can't be judged as if they were rules. They used to
   * land in the findings table as a `baseline` regulation, which is a portal
   * heartbeat wearing a regulation's clothes.
   */
  heartbeats: RegulationEntry[];
  /** Deterministic profile/source activation gaps, written before model judgment. */
  coverageCaveats: string[];
}

/**
 * One card = an <h6> whose <a> links to a /peraturan/<slug> detail page and
 * whose label is "<number> Tahun <year>", followed by a <p> with the title.
 */
const ENTRY_RE =
  /<h6[^>]*>\s*<a\s+href="(https:\/\/jdih\.kemendag\.go\.id\/peraturan\/[^"#?]+)"[^>]*>\s*([^<]+?)\s*<\/a>\s*<\/h6>\s*<p[^>]*>\s*([\s\S]*?)\s*<\/p>/g;

const LABEL_RE = /^([\w./-]+)\s+Tahun\s+(\d{4})$/i;

/** Connection-level failures — the whole domain is down, not just one path. */
function isDomainFailure(message: string | null): boolean {
  if (!message) return false;
  return /fetch failed|abort|timeout|timed out|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket/i.test(
    message,
  );
}

export async function fetchAllSources(
  sources: SourceDefinition[],
  rawDir: string,
  coverageCaveats: string[] = [],
): Promise<FetchReport> {
  const outcomes: FetchOutcome[] = [];
  const all: RegulationEntry[] = [];
  const heartbeats: RegulationEntry[] = [];
  // One dead domain used to cost five identical 12s timeouts and five identical
  // caveat lines. Fail it once, record the rest honestly as skipped.
  const deadDomains = new Map<string, string>();

  for (const source of sources) {
    const deadReason = deadDomains.get(source.domain);
    if (deadReason) {
      outcomes.push({
        ...emptyOutcome(source),
        errorMessage: `Not attempted — ${source.domain} already failed this run (${deadReason})`,
        skipped: true,
      });
      continue;
    }

    const { outcome, entries } = await fetchSource(source, rawDir);
    outcomes.push(outcome);
    if (!outcome.success && isDomainFailure(outcome.errorMessage)) {
      deadDomains.set(source.domain, outcome.errorMessage!);
    }
    if (source.heartbeat) heartbeats.push(...entries);
    else all.push(...entries);
  }

  return {
    runAt: new Date().toISOString(),
    outcomes,
    regulations: mergeEntries(all),
    heartbeats,
    coverageCaveats,
  };
}

function emptyOutcome(source: SourceDefinition): FetchOutcome {
  return {
    sourceId: source.id,
    name: source.name,
    domain: source.domain,
    view: source.view,
    url: source.url,
    fetchedAt: new Date().toISOString(),
    success: false,
    errorMessage: null,
    rawContentPath: null,
    contentLength: 0,
    entriesParsed: 0,
    parseWarning: null,
    skipped: false,
    validEmpty: false,
  };
}

async function fetchSource(
  source: SourceDefinition,
  rawDir: string,
): Promise<{ outcome: FetchOutcome; entries: RegulationEntry[] }> {
  const outcome = emptyOutcome(source);

  try {
    const html = await fetchSourceContent(source);

    await mkdir(rawDir, { recursive: true });
    const rawPath = source.rawFilename ? path.join(rawDir, source.rawFilename) : null;
    if (rawPath) {
      const rawContent =
        String(source.parser) === "cbp-wro-csv" ? unwrapCbpWroCsv(html).csv : html;
      await writeFile(rawPath, rawContent, "utf-8");
    }

    const entries = parseEntries(html, source);

    outcome.success = true;
    outcome.rawContentPath = rawPath;
    outcome.contentLength = html.length;
    outcome.entriesParsed = entries.length;
    if (
      entries.length === 0 &&
      source.emptyStateMarker &&
      html.includes(source.emptyStateMarker) &&
      (!source.emptyStateDisqualifier || !html.includes(source.emptyStateDisqualifier))
    ) {
      outcome.validEmpty = true;
    } else if (entries.length === 0) {
      outcome.parseWarning =
        "Fetched OK but parsed 0 entries — the page markup may have changed. " +
        "Treat this view as UNCHECKED, not as 'nothing new'.";
    }

    return { outcome, entries };
  } catch (err) {
    outcome.errorMessage = err instanceof Error ? err.message : String(err);
    return { outcome, entries: [] };
  }
}

async function fetchSourceContent(source: SourceDefinition): Promise<string> {
  const maxAttempts = Math.max(1, source.maxAttempts ?? 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? TIMEOUT_MS);
    try {
      const parser = String(source.parser ?? "kemendag");
      if (parser === "ecfr-versions-json") {
        return await fetchAllEcfrPages(source, controller.signal);
      }
      if (parser === "federal-register-json") {
        return await fetchAllFederalRegisterPages(source, controller.signal);
      }
      if (parser === "setneg-json") {
        return await fetchAllSetnegPages(source, controller.signal);
      }
      if (parser === "surabaya-regulations-json") {
        return await fetchAllSurabayaPages(source, controller.signal);
      }
      if (parser === "usitc-ids-json") {
        return await fetchAllUsitcIdsPages(source, controller.signal);
      }
      if (parser === "cbp-cross-json") {
        return await fetchAllCbpCrossPages(source, controller.signal);
      }
      if (parser === "cbp-wro-csv") {
        return await fetchCbpWroCsv(source, controller.signal);
      }
      if (parser === "pasal-laws-json") {
        return await fetchAllPasalPages(source, controller.signal);
      }
      return await fetchText(source.url, source, controller.signal, {
        method: source.requestMethod ?? "GET",
        ...(source.requestBody ? { body: source.requestBody } : {}),
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxAttempts || !isRetryableFetchFailure(message)) throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function isRetryableFetchFailure(message: string): boolean {
  return isDomainFailure(message) || /HTTP (?:429|5\d\d)\b/i.test(message);
}

/**
 * Auth for the one source that needs it. Resolved here, at request time, rather
 * than stored on the SourceDefinition: the registry is a module-level exported
 * constant that tests import and code logs, and a live bearer token has no
 * business sitting in it. `requiresEnv` on the definition keeps the *dependency*
 * declarative while the *secret* stays out of the data structure.
 */
function authHeaders(source: SourceDefinition): Record<string, string> {
  if (!source.requiresEnv) return {};
  const token = process.env[source.requiresEnv]?.trim();
  if (!token) {
    // Selection should have deactivated this source already. Reaching here means
    // it was requested without credentials, and a source that cannot be
    // authenticated is unchecked — never a quiet pass.
    throw new Error(
      `${source.requiresEnv} is not set — ${source.name} was not checked. ` +
        "Set it in .env to enable this source.",
    );
  }
  return { Authorization: `Bearer ${token}` };
}

async function fetchText(
  url: string,
  source: SourceDefinition,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...source.requestHeaders, ...authHeaders(source), ...(init.headers ?? {}) },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Exhaust pasal.id's offset pagination.
 *
 * The API caps `limit` at 50 and reports the real size in `total`. Kemenperin
 * has 23 rows a year so one page held it, but Kemenkeu has 57 — a single page
 * silently dropped 7 PMK while still reporting success, which is precisely the
 * "looks checked, wasn't" failure this project exists to avoid. Following
 * `total` is what makes the fetch honest.
 *
 * A page that fails or contradicts the first page's `total` fails the whole
 * source, matching the eCFR rule: a partial page set must never be presented as
 * complete coverage.
 */
async function fetchAllPasalPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL(source.url);
  const pageSize = Number(url.searchParams.get("limit") ?? "50");
  url.searchParams.set("offset", "0");

  const first = JSON.parse(await fetchText(url.toString(), source, signal)) as {
    total?: number;
    laws?: unknown[];
  };
  if (!Array.isArray(first.laws)) throw new Error("pasal.id payload did not contain laws");
  const total = Number(first.total ?? first.laws.length);
  const laws = [...first.laws];

  while (laws.length < total) {
    url.searchParams.set("offset", String(laws.length));
    const page = JSON.parse(await fetchText(url.toString(), source, signal)) as {
      total?: number;
      laws?: unknown[];
    };
    if (!Array.isArray(page.laws) || page.laws.length === 0) {
      throw new Error(`pasal.id pagination stopped at ${laws.length} of ${total}`);
    }
    if (Number(page.total) !== total) {
      throw new Error("pasal.id total changed during pagination");
    }
    laws.push(...page.laws);
    if (laws.length > total + pageSize) {
      throw new Error("pasal.id pagination overran its reported total");
    }
  }

  return JSON.stringify({ total, laws });
}

/** Discover CBP's dated WRO export from its stable index, then retain both URLs. */
async function fetchCbpWroCsv(source: SourceDefinition, signal: AbortSignal): Promise<string> {
  const indexHtml = await fetchText(source.url, source, signal);
  const $ = load(indexHtml);
  const candidates = $("a[href]")
    .map((_, element) => absolutizeUrl($(element).attr("href") ?? "", source.url))
    .get()
    .filter((url) => /\.csv(?:$|[?#])/i.test(url));

  if (candidates.length === 0) {
    throw new Error("CBP WRO index did not contain a CSV download link");
  }

  const csvUrl = [...new Set(candidates)].sort((a, b) => {
    const dateA = extractSortableUrlDate(a);
    const dateB = extractSortableUrlDate(b);
    return dateB.localeCompare(dateA);
  })[0];
  const response = await fetch(csvUrl, {
    headers: { ...HEADERS, ...source.requestHeaders },
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = await response.arrayBuffer();
  const prefix = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  const utf8Bom = prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf;
  const csv = new TextDecoder(utf8Bom ? "utf-8" : "windows-1252").decode(bytes);

  return JSON.stringify({ indexUrl: source.url, csvUrl, csv });
}

function extractSortableUrlDate(url: string): string {
  const ymd = url.match(/\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  const yearMonth = url.match(/\b(20\d{2})[-_/](\d{1,2})\b/);
  return yearMonth ? `${yearMonth[1]}-${yearMonth[2].padStart(2, "0")}-00` : "";
}

/** Exhaust the implementation-level IDS API; a partial case inventory is unchecked. */
async function fetchAllUsitcIdsPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  if (source.requestMethod !== "POST" || !source.requestBody) {
    return fetchText(source.url, source, signal);
  }
  const request = JSON.parse(source.requestBody) as Record<string, unknown>;
  const pageSize = Number(request.pageSize ?? 100);
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("USITC IDS request contained an invalid pageSize");
  }

  const cases: unknown[] = [];
  let pageNumber = 1;
  let totalRecords = 0;
  let first: Record<string, unknown> | null = null;
  do {
    const text = await fetchText(source.url, source, signal, {
      method: "POST",
      body: JSON.stringify({ ...request, pageNumber, pageSize }),
    });
    const payload = JSON.parse(text) as unknown;
    if (!isRecord(payload) || !Array.isArray(payload.cases)) {
      throw new Error(`USITC IDS page ${pageNumber} did not contain a cases array`);
    }
    const count = Number(payload.totalRecords);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`USITC IDS page ${pageNumber} contained invalid totalRecords`);
    }
    if (first === null) {
      first = payload;
      totalRecords = count;
    } else if (count !== totalRecords) {
      throw new Error(`USITC IDS totalRecords changed during pagination (${totalRecords} to ${count})`);
    }
    cases.push(...payload.cases);
    if (payload.cases.length === 0 && cases.length < totalRecords) {
      throw new Error(`USITC IDS pagination stopped at ${cases.length} of ${totalRecords}`);
    }
    pageNumber += 1;
  } while (cases.length < totalRecords);

  return JSON.stringify({ ...first, cases, totalRecords });
}

const SETNEG_TYPES = ["UU", "PERPU", "PP", "PERPRES", "KEPPRES", "INPRES"] as const;
const SETNEG_PAGE_SIZE = 100;

/** Poll complete current/prior-year national instrument sets or fail the source. */
async function fetchAllSetnegPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  const currentYear = new Date().getUTCFullYear();
  const data: unknown[] = [];
  const queries: Array<{ type: string; year: number; count: number }> = [];

  for (const year of [currentYear, currentYear - 1]) {
    for (const type of SETNEG_TYPES) {
      let start = 0;
      let total = 0;
      do {
        const body = JSON.stringify({
          tentang: "",
          p_lihan: "semua",
          jns: [type],
          thn: [String(year)],
          status: "",
          terx: "All",
          sortOrder: "desc",
          length: SETNEG_PAGE_SIZE,
          start,
        });
        const text = await fetchText(source.url, source, signal, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
        });
        const payload = JSON.parse(text) as { data?: unknown[]; jml?: number | string };
        if (!Array.isArray(payload.data)) {
          throw new Error(`Setneg ${type} ${year} payload did not contain data`);
        }
        total = Number(payload.jml ?? payload.data.length);
        if (!Number.isInteger(total) || total < 0) {
          throw new Error(`Setneg ${type} ${year} returned invalid count ${String(payload.jml)}`);
        }
        data.push(...payload.data);
        start += payload.data.length;
        if (payload.data.length === 0 && start < total) {
          throw new Error(`Setneg ${type} ${year} pagination stopped at ${start} of ${total}`);
        }
      } while (start < total);
      queries.push({ type, year, count: total });
    }
  }

  return JSON.stringify({ data, queries });
}

/** Surabaya's XHR is paginated; current and prior years catch delayed uploads. */
async function fetchAllSurabayaPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  const currentYear = new Date().getUTCFullYear();
  const data: unknown[] = [];
  const queries: Array<{ year: number; count: number }> = [];

  for (const year of [currentYear, currentYear - 1]) {
    let page = 1;
    let totalPages = 1;
    let total = 0;
    do {
      const url = new URL(source.url);
      for (const [key, value] of Object.entries({
        judul: "",
        jenis: "",
        nomor: "",
        tahun: String(year),
        sort: "terbaru",
        page: String(page),
      })) {
        url.searchParams.set(key, value);
      }
      const text = await fetchText(url.toString(), source, signal);
      const payload = JSON.parse(text) as {
        data?: unknown[];
        total?: number | string;
        totalPage?: number | string;
      };
      if (!Array.isArray(payload.data)) {
        throw new Error(`Surabaya ${year} page ${page} payload did not contain data`);
      }
      total = Number(payload.total ?? payload.data.length);
      totalPages = Number(payload.totalPage ?? 1);
      if (!Number.isInteger(totalPages) || totalPages < 1 || !Number.isInteger(total) || total < 0) {
        throw new Error(`Surabaya ${year} returned invalid pagination metadata`);
      }
      data.push(...payload.data);
      page += 1;
    } while (page <= totalPages);
    queries.push({ year, count: total });
  }

  return JSON.stringify({ data, queries });
}

/** Fetch every eCFR result page or fail the source; a partial page set is unchecked. */
async function fetchAllEcfrPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  const firstText = await fetchText(source.url, source, signal);
  const first = JSON.parse(firstText) as {
    content_versions?: unknown[];
    meta?: { total_pages?: string | number };
  };
  if (!Array.isArray(first.content_versions)) {
    throw new Error("eCFR payload did not contain content_versions");
  }

  const totalPages = Number(first.meta?.total_pages ?? 1);
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error(`eCFR returned an invalid page count: ${String(first.meta?.total_pages)}`);
  }

  const contentVersions = [...first.content_versions];
  for (let page = 2; page <= totalPages; page += 1) {
    const pageUrl = new URL(source.url);
    pageUrl.searchParams.set("page", String(page));
    const pageText = await fetchText(pageUrl.toString(), source, signal);
    const payload = JSON.parse(pageText) as { content_versions?: unknown[] };
    if (!Array.isArray(payload.content_versions)) {
      throw new Error(`eCFR page ${page} did not contain content_versions`);
    }
    contentVersions.push(...payload.content_versions);
  }

  return JSON.stringify({ ...first, content_versions: contentVersions });
}

/** Follow every documented Federal Register result page or fail the source. */
async function fetchAllFederalRegisterPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  const firstText = await fetchText(source.url, source, signal);
  const first = JSON.parse(firstText) as Record<string, unknown>;
  if (Number(first.count) === 0 && first.results === undefined) {
    return JSON.stringify({ ...first, total_pages: 1, next_page_url: null, results: [] });
  }
  if (!Array.isArray(first.results)) {
    throw new Error("Federal Register payload did not contain results");
  }
  const totalPages = Number(first.total_pages ?? 1);
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error(`Federal Register returned an invalid page count: ${String(first.total_pages)}`);
  }

  const results = [...first.results];
  let nextUrl = typeof first.next_page_url === "string" ? first.next_page_url : null;
  for (let page = 2; page <= totalPages; page += 1) {
    if (!nextUrl) throw new Error(`Federal Register pagination stopped before page ${page}`);
    const text = await fetchText(nextUrl, source, signal);
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(payload.results)) {
      throw new Error(`Federal Register page ${page} did not contain results`);
    }
    results.push(...payload.results);
    nextUrl = typeof payload.next_page_url === "string" ? payload.next_page_url : null;
  }
  return JSON.stringify({ ...first, results, next_page_url: null });
}

/** Exhaust a profile-scoped CROSS search; one partial result page is unchecked. */
async function fetchAllCbpCrossPages(
  source: SourceDefinition,
  signal: AbortSignal,
): Promise<string> {
  const firstText = await fetchText(source.url, source, signal);
  const first = JSON.parse(firstText) as Record<string, unknown>;
  if (!Array.isArray(first.rulings)) throw new Error("CBP CROSS payload did not contain rulings");
  const totalHits = Number(first.totalHits);
  if (!Number.isInteger(totalHits) || totalHits < first.rulings.length) {
    throw new Error("CBP CROSS payload contained invalid totalHits");
  }

  const url = new URL(source.url);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 100);
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("CBP CROSS request contained an invalid pageSize");
  }
  const rulings = [...first.rulings];
  for (let page = 2; rulings.length < totalHits; page += 1) {
    url.searchParams.set("page", String(page));
    const text = await fetchText(url.toString(), source, signal);
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (!Array.isArray(payload.rulings) || payload.rulings.length === 0) {
      throw new Error(`CBP CROSS pagination stopped at ${rulings.length} of ${totalHits}`);
    }
    if (Number(payload.totalHits) !== totalHits) {
      throw new Error("CBP CROSS totalHits changed during pagination");
    }
    rulings.push(...payload.rulings);
  }
  return JSON.stringify({ ...first, rulings, totalHits });
}

export function parseEntries(html: string, source: SourceDefinition): RegulationEntry[] {
  switch (String(source.parser ?? "kemendag")) {
    case "peraturan-go-id":
      return parseAnchorRegulations(html, source, /peraturan\.go\.id\/(?:id\/)?/i);
    case "kemenkeu-home":
      return parseKemenkeuHome(html, source);
    case "bsn-pesta":
      return parseBsnPesta(html, source);
    case "oss-kbli-versions-json":
      return parseOssKbliVersionsJson(html, source);
    case "setneg-json":
      return parseSetnegJson(html, source);
    case "pasal-laws-json":
      return parsePasalLawsJson(html, source);
    case "klh-json":
      return parseKlhJson(html, source);
    case "kemnaker":
      return parseKemnaker(html, source);
    case "djbc-home":
      return parseDjbcHome(html, source);
    case "djp-list":
      return parseDjpList(html, source);
    case "surabaya-regulations-json":
      return parseSurabayaRegulationsJson(html, source);
    case "surabaya-dlh-json":
      return parseSurabayaDlhJson(html, source);
    case "federal-register-json":
      return parseFederalRegisterJson(html, source);
    case "ecfr-versions-json":
      return parseEcfrVersionsJson(html, source);
    case "cpsc-recalls-json":
      return parseCpscRecallsJson(html, source);
    case "rss":
      return parseRssEntries(html, source);
    case "dated-link-list":
      return parseDatedLinkList(html, source);
    case "nc-register":
      return parseNcRegister(html, source);
    case "nc-air-notices":
      return parseAirNoticeTables(html, source);
    case "texas-register":
      return parseTexasRegister(html, source);
    case "heartbeat-html":
      return parseHtmlHeartbeat(html, source);
    case "usitc-hts-release":
      return parseUsitcHtsRelease(html, source);
    case "usitc-hts-search":
      return parseUsitcHtsSearch(html, source);
    case "cbp-cross-json":
      return parseCbpCrossJson(html, source);
    case "ustr-301-json":
      return parseUstr301Json(html, source);
    case "usitc-ids-json":
      return parseUsitcIdsJson(html, source);
    case "dataset-snapshot-json":
      return parseDatasetSnapshotJson(html, source);
    case "uflpa-html":
      return parseUflpaHtml(html, source);
    case "cbp-wro-csv":
      return parseCbpWroCsv(html, source);
    case "generic-regulation":
      return parseAnchorRegulations(html, source);
    case "kemendag":
    default:
      return parseKemendagEntries(html, source);
  }
}

function parseUsitcHtsRelease(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as { name?: unknown; description?: unknown; title?: unknown };
  if (
    !payload ||
    typeof payload.name !== "string" ||
    typeof payload.description !== "string" ||
    typeof payload.title !== "string"
  ) {
    throw new Error("USITC HTS release payload did not contain name, description, and title");
  }
  const hash = contentHash(json);
  return [
    buildEntry(source, {
      label: payload.name,
      number: payload.name,
      year: yearFromText(`${payload.name} ${payload.title}`),
      listingTitle: payload.description,
      fullTitle:
        `Current official USITC HTS release: ${payload.description} (${payload.name}). ` +
        "A release change triggers a tariff-data refresh and product rescreening; this entry is not itself a classification or party-screening result.",
      url: withCanteFragment(source.url, `hts-release-${hash.slice(0, 16)}`),
      textUrl: source.url,
      documentType: "HTS release metadata",
    }),
  ];
}

function parseUsitcHtsSearch(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as unknown;
  if (!Array.isArray(payload)) throw new Error("USITC HTS search payload was not an array");
  const profileCodes = sourceProfileCodes(source);
  if (profileCodes.length === 0) return [];

  return payload.flatMap((raw): RegulationEntry[] => {
    if (!isRecord(raw)) throw new Error("USITC HTS search row was not an object");
    const code = stringValue(raw.htsno);
    const description = stringValue(raw.description);
    if (!code || !description) throw new Error("USITC HTS search row lacked code or description");
    if (!profileCodes.some((profile) => tariffCodesOverlap(code, profile))) return [];

    const normalized = normalizeTariffCode(code);
    const units = stringArrayField(raw, "units") ?? [];
    const general = stringValue(raw.general);
    const special = stringValue(raw.special);
    const other = stringValue(raw.other);
    const additional = stringValue(raw.additionalDuties);
    return [
      buildEntry(source, {
        label: `HTS ${code}`,
        number: normalized,
        year: null,
        listingTitle: `${code} - ${description}`,
        fullTitle:
          `Official USITC HTS row ${code}: ${description}.` +
          `${units.length ? ` Units: ${units.join(", ")}.` : ""}` +
          `${general ? ` General duty: ${general}.` : ""}` +
          `${special ? ` Special duty: ${special}.` : ""}` +
          `${other ? ` Column 2 duty: ${other}.` : ""}` +
          `${additional ? ` Additional duties: ${additional}.` : ""} ` +
          "This monitors a recorded code; it does not establish that the product was classified correctly.",
        url: withCanteFragment(source.url, `hts-${normalized}`),
        documentType: "HTS tariff row",
      }),
    ];
  });
}

function parseCbpCrossJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as { rulings?: unknown };
  if (!payload || !Array.isArray(payload.rulings)) {
    throw new Error("CBP CROSS payload did not contain a rulings array");
  }
  const profileCodes = sourceProfileCodes(source);
  if (profileCodes.length === 0) return [];

  return payload.rulings
    .flatMap((raw): RegulationEntry[] => {
      if (!isRecord(raw)) throw new Error("CBP CROSS ruling was not an object");
      const rulingNumber = stringField(raw, "rulingNumber");
      const subject = stringField(raw, "subject");
      const rulingDate = stringField(raw, "rulingDate");
      const tariffs = stringArrayField(raw, "tariffs");
      if (!rulingNumber || !subject || !rulingDate || !tariffs) {
        throw new Error("CBP CROSS ruling was missing required fields");
      }
      const matched = tariffs.filter((code) => profileCodes.some((profile) => tariffCodesOverlap(code, profile)));
      if (matched.length === 0) return [];
      const categories = stringField(raw, "categories");
      const collection = stringField(raw, "collection");
      const status = raw.operationallyRevoked === true ? "Operationally revoked" : "Current in CROSS";
      const url = `https://rulings.cbp.gov/ruling/${encodeURIComponent(rulingNumber)}`;
      return [
        buildEntry(source, {
          label: `CBP ruling ${rulingNumber}`,
          number: rulingNumber,
          year: yearFromText(rulingDate),
          listingTitle: subject,
          fullTitle:
            `${subject}. Ruling ${rulingNumber}, dated ${rulingDate.slice(0, 10)}. ` +
            `Matched customer HTS code(s): ${matched.join(", ")}. Status: ${status}.` +
            `${categories ? ` Categories: ${categories}.` : ""}` +
            `${collection ? ` Collection: ${collection}.` : ""}`,
          url,
          documentType: "CBP classification ruling",
        }),
      ];
    });
}

function parseUstr301Json(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as unknown;
  if (!Array.isArray(payload)) throw new Error("USTR Section 301 payload was not an array");
  const profileCodes = sourceProfileCodes(source);
  if (profileCodes.length === 0) return [];

  return payload
    .flatMap((raw): RegulationEntry[] => {
      if (!isRecord(raw)) throw new Error("USTR Section 301 row was not an object");
      const rawCode = raw.HTS_id;
      const code =
        typeof rawCode === "number"
          ? String(rawCode).padStart(8, "0")
          : typeof rawCode === "string"
            ? rawCode
            : "";
      const description = stringField(raw, "description");
      const action = stringField(raw, "action_description");
      if (!code || !description || !action) {
        throw new Error("USTR Section 301 row was missing required fields");
      }
      if (!profileCodes.some((profile) => tariffCodesOverlap(code, profile))) return [];
      const normalized = normalizeTariffCode(code);
      const note = stringField(raw, "note");
      return [
        buildEntry(source, {
          label: `Section 301 HTS ${formatTariffCode(normalized)}`,
          number: normalized,
          year: null,
          listingTitle: `${formatTariffCode(normalized)} - ${description}`,
          fullTitle:
            `USTR Section 301 product overlay for HTS ${formatTariffCode(normalized)}: ${description}. ` +
            `Action: ${action}.${note ? ` Note: ${note}.` : ""} ` +
            "This mapping aid must be confirmed against the controlling Federal Register notice and current HTS release.",
          url: withCanteFragment(source.url, `hts-${normalized}`),
          documentType: "Section 301 product overlay",
          action,
        }),
      ];
    });
}

function parseUsitcIdsJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as unknown;
  if (!isRecord(payload)) throw new Error("USITC IDS payload was not an object");
  if (Array.isArray(payload.cases)) {
    return parseUsitcIdsAdvancedSearch(payload, source);
  }
  if (!Array.isArray(payload.data)) throw new Error("USITC IDS payload did not contain cases or data");
  if (typeof payload.count !== "number" || payload.count < payload.data.length) {
    throw new Error("USITC IDS payload contained invalid count metadata");
  }
  const windowStart = source.windowStart ?? "9999-12-31";

  return payload.data
    .flatMap((raw): RegulationEntry[] => {
      if (!isRecord(raw)) throw new Error("USITC IDS investigation was not an object");
      const type = nestedName(raw["Investigation Type"]);
      if (type !== "Import Injury") return [];
      const id = numberOrString(raw["Investigation ID"]);
      const number = stringValue(raw["Investigation Number"]);
      const title = stringValue(raw["Full Title"]);
      const topic = stringValue(raw.Topic);
      const status = nestedName(raw["Investigation Status"]);
      const phase = nestedName(raw["Investigation Phase"]);
      if (!id || !number || !title || !status || !phase) {
        throw new Error("USITC IDS import-injury investigation was missing required fields");
      }
      const started = normalizeUsDate(stringValue(raw["Start Date"]) ?? "");
      const determination = dateObjectValue(raw["Determination Date"]);
      const isCurrent = status.toLowerCase() === "active";
      const isRecent = Boolean(
        (started && started >= windowStart) || (determination && determination >= windowStart),
      );
      if (!isCurrent && !isRecent) return [];
      const countries = arrayNames(raw.Countries);
      return [
        buildEntry(source, {
          label: `USITC ${number}`,
          number,
          year: yearFromText(started ?? determination ?? ""),
          listingTitle: title,
          fullTitle:
            `${title}. Import Injury investigation ${number}; status ${status}; phase ${phase}.` +
            `${topic ? ` Product/topic: ${topic}.` : ""}` +
            `${countries.length ? ` Countries: ${countries.join(", ")}.` : ""}` +
            `${started ? ` Started ${started}.` : ""}` +
            `${determination ? ` Determination date ${determination}.` : ""}`,
          url: `https://ids.usitc.gov/case/${encodeURIComponent(id)}`,
          documentType: "USITC import-injury investigation",
        }),
      ];
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

function parseUsitcIdsAdvancedSearch(
  payload: Record<string, unknown>,
  source: SourceDefinition,
): RegulationEntry[] {
  const cases = payload.cases;
  if (!Array.isArray(cases)) throw new Error("USITC IDS advanced search did not contain cases");
  if (
    typeof payload.totalRecords !== "number" ||
    !Number.isInteger(payload.totalRecords) ||
    payload.totalRecords < cases.length
  ) {
    throw new Error("USITC IDS advanced search contained invalid totalRecords");
  }
  const windowStart = source.windowStart ?? "9999-12-31";
  const entries: RegulationEntry[] = [];

  for (const caseRecord of cases) {
    if (!isRecord(caseRecord) || !Array.isArray(caseRecord.level_1_investigations)) {
      throw new Error("USITC IDS case was missing level_1_investigations");
    }
    for (const raw of caseRecord.level_1_investigations) {
      if (!isRecord(raw)) throw new Error("USITC IDS investigation was not an object");
      const type = nestedName(raw.investigation_type_id);
      if (type !== "Import Injury") continue;
      const id = numberOrString(raw.investigation_id);
      const number = stringValue(raw.investigation_number);
      const title = stringValue(raw.investigation_title);
      const phase = nestedName(raw.investigation_phase_id);
      const started = normalizeUsDate(stringValue(raw.institution_start_date) ?? "");
      if (!id || !number || !title || !phase || typeof raw.is_active !== "boolean") {
        throw new Error("USITC IDS import-injury investigation was missing required fields");
      }
      const status = raw.is_active ? "Active" : "Inactive";
      if (!raw.is_active && !(started && started >= windowStart)) continue;
      const topic = stringValue(raw.investigation_full_product);
      entries.push(
        buildEntry(source, {
          label: `USITC ${number}`,
          number,
          year: yearFromText(started ?? ""),
          listingTitle: title,
          fullTitle:
            `${title}. Import Injury investigation ${number}; status ${status}; phase ${phase}.` +
            `${topic ? ` Product/topic: ${topic}.` : ""}` +
            `${started ? ` Started ${started}.` : ""}`,
          url: `https://ids.usitc.gov/case/${encodeURIComponent(id)}`,
          documentType: "USITC import-injury investigation",
        }),
      );
    }
  }

  return entries.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

function parseDatasetSnapshotJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as unknown;
  const count = snapshotRecordCount(payload);
  const hash = contentHash(json);
  return [
    buildEntry(source, {
      label: `${source.name} dataset snapshot`,
      number: hash.slice(0, 16),
      year: new Date().getUTCFullYear(),
      listingTitle: `${source.name}: ${count.toLocaleString("en-US")} records`,
      fullTitle:
        `${source.name} official dataset snapshot contains ${count.toLocaleString("en-US")} records; content SHA-256 ${hash}. ` +
        "A dataset update triggers customer-party rescreening, but this dataset-change entry is not itself a party-screening result.",
      url: withCanteFragment(source.url, `snapshot-${hash.slice(0, 16)}`),
      documentType: "Dataset snapshot",
    }),
  ];
}

function parseUflpaHtml(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();

  $("table").each((_, tableElement) => {
    const table = $(tableElement);
    const headers = table
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => cleanText($(cell).html() ?? "").toLowerCase())
      .get();
    const entityIndex = headers.findIndex((header) => /entity|company|name/.test(header));
    const dateIndex = headers.findIndex((header) => /effective|date/.test(header));
    if (entityIndex < 0) return;
    const heading = cleanText(
      table.prevAll("h1,h2,h3,h4,h5,h6").first().html() ?? table.find("caption").html() ?? "",
    );

    table.find("tr").slice(1).each((__, rowElement) => {
      const cells = $(rowElement).find("th,td");
      const entity = cleanText(cells.eq(entityIndex).html() ?? "");
      const effective = dateIndex >= 0 ? cleanText(cells.eq(dateIndex).html() ?? "") : "";
      if (!entity) return;
      const key = `${heading}|${entity}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const fragment = `uflpa-${contentHash(key).slice(0, 16)}`;
      entries.push(
        buildEntry(source, {
          label: `UFLPA entity: ${entity}`,
          number: null,
          year: yearFromText(effective),
          listingTitle: entity,
          fullTitle:
            `${entity} appears on the DHS UFLPA Entity List` +
            `${heading ? ` under ${heading}` : ""}.` +
            `${effective ? ` Effective date: ${effective}.` : ""} ` +
            "This is a source-list record, not proof that a customer counterparty was screened or matched.",
          url: withCanteFragment(source.url, fragment),
          textUrl: source.url,
          effectiveOn: normalizeUsDate(effective),
          documentType: heading || "UFLPA Entity List membership",
        }),
      );
    });
  });

  return entries;
}

function parseCbpWroCsv(payloadText: string, source: SourceDefinition): RegulationEntry[] {
  const { csv, indexUrl, csvUrl } = unwrapCbpWroCsv(payloadText, source.url);
  const rows = parseCsvRecords(csv);
  if (rows.length === 0) return [];
  const required = ["Effective Date", "Country", "Merchandise", "WRO/Finding", "Status", "Entity"];
  for (const field of required) {
    if (!Object.hasOwn(rows[0], field)) throw new Error(`CBP WRO CSV was missing required column ${field}`);
  }

  return rows.flatMap((row) => {
    const entity = row.Entity?.trim();
    const merchandise = row.Merchandise?.trim();
    const type = row["WRO/Finding"]?.trim();
    const effective = row["Effective Date"]?.trim();
    const country = row.Country?.trim();
    if (!entity || !merchandise || !type || !effective || !country) return [];
    const key = `${country}|${entity}|${merchandise}|${type}|${effective}`.toLowerCase();
    const pressRelease = row["Press Release"]?.trim();
    return [
      buildEntry(source, {
        label: `${type}: ${entity}`,
        number: null,
        year: yearFromText(effective),
        listingTitle: `${entity} - ${merchandise}`,
        fullTitle:
          `CBP ${type} record for ${entity}, ${country}; merchandise: ${merchandise}. ` +
          `Effective date: ${effective}. Status: ${row.Status?.trim() || "not stated"}.` +
          `${row.Industry?.trim() ? ` Industry: ${row.Industry.trim()}.` : ""}` +
          `${row.Remarks?.trim() ? ` Remarks: ${row.Remarks.trim()}.` : ""}` +
          `${pressRelease ? ` Press release: ${absolutizeUrl(pressRelease, indexUrl)}.` : ""} ` +
          "This is a source-list record, not proof that a customer shipment or counterparty was screened or matched.",
        url: withCanteFragment(indexUrl, `wro-${contentHash(key).slice(0, 16)}`),
        textUrl: csvUrl,
        effectiveOn: normalizeUsDate(effective),
        documentType: `CBP ${type}`,
      }),
    ];
  });
}

function unwrapCbpWroCsv(
  payloadText: string,
  fallbackUrl = "",
): { csv: string; indexUrl: string; csvUrl: string } {
  if (!payloadText.trimStart().startsWith("{")) {
    return { csv: payloadText, indexUrl: fallbackUrl, csvUrl: fallbackUrl };
  }
  const payload = JSON.parse(payloadText) as { indexUrl?: unknown; csvUrl?: unknown; csv?: unknown };
  if (
    typeof payload.indexUrl !== "string" ||
    typeof payload.csvUrl !== "string" ||
    typeof payload.csv !== "string"
  ) {
    throw new Error("CBP WRO fetch payload was missing indexUrl, csvUrl, or csv");
  }
  return { indexUrl: payload.indexUrl, csvUrl: payload.csvUrl, csv: payload.csv };
}

/** RFC 4180-compatible rows, including quoted commas, escaped quotes, and newlines. */
function parseCsvRecords(csv: string): Array<Record<string, string>> {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) matrix.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) matrix.push(row);
  }
  if (matrix.length === 0) return [];
  const headers = matrix[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error("CSV contained blank or duplicate headers");
  }
  return matrix.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function sourceProfileCodes(source: SourceDefinition): string[] {
  const value = (source as SourceDefinition & { profileCodes?: unknown }).profileCodes;
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string" && normalizeTariffCode(code).length >= 6)
    : [];
}

function normalizeTariffCode(code: string): string {
  return code.replace(/\D/g, "");
}

function tariffCodesOverlap(left: string, right: string): boolean {
  const a = normalizeTariffCode(left);
  const b = normalizeTariffCode(right);
  if (a.length < 6 || b.length < 6) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function formatTariffCode(code: string): string {
  if (code.length <= 4) return code;
  return `${code.slice(0, 4)}.${code.slice(4)}`;
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function withCanteFragment(url: string, fragment: string): string {
  const parsed = new URL(url);
  parsed.hash = `cante-${fragment}`;
  return parsed.toString();
}

function snapshotRecordCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (!isRecord(payload)) throw new Error("Dataset snapshot JSON was not an array or object");
  for (const key of ["data", "results", "records", "items"]) {
    if (Array.isArray(payload[key])) return payload[key].length;
  }
  if (typeof payload.count === "number" && Number.isInteger(payload.count) && payload.count >= 0) {
    return payload.count;
  }
  throw new Error("Dataset snapshot JSON did not expose records or a valid count");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return stringValue(record[key]);
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value.map((item) => item.trim()).filter(Boolean);
}

function numberOrString(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : stringValue(value);
}

function nestedName(value: unknown): string | null {
  return isRecord(value) ? stringValue(value.Name ?? value.name) : null;
}

function arrayNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    const name = nestedName(item);
    return name ? [name] : [];
  });
}

function dateObjectValue(value: unknown): string | null {
  if (typeof value === "string") return normalizeUsDate(value);
  return isRecord(value) ? normalizeUsDate(stringValue(value.date) ?? "") : null;
}

function normalizeUsDate(value: string): string | null {
  const iso = value.match(/^(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return extractDate(value) || null;
}

function parseCpscRecallsJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as Array<{
    RecallID?: number;
    RecallNumber?: string;
    RecallDate?: string;
    Description?: string;
    URL?: string;
    Title?: string;
    Products?: Array<{ Name?: string; NumberOfUnits?: string }>;
    Injuries?: Array<{ Name?: string }>;
    Remedies?: Array<{ Name?: string }>;
  }>;

  if (!Array.isArray(payload)) throw new Error("CPSC recall payload was not an array");
  return payload.slice(0, 30).flatMap((item) => {
    if (!item.Title || !item.URL || !item.RecallNumber) return [];
    const products = item.Products?.map((product) =>
      `${product.Name ?? "Unnamed product"}${product.NumberOfUnits ? ` (${product.NumberOfUnits} units)` : ""}`,
    ).join("; ");
    const injuries = item.Injuries?.map((injury) => injury.Name).filter(Boolean).join("; ");
    const remedies = item.Remedies?.map((remedy) => remedy.Name).filter(Boolean).join("; ");
    const date = item.RecallDate?.slice(0, 10) ?? "date unknown";
    return [
      buildEntry(source, {
        label: `CPSC recall ${item.RecallNumber}`,
        number: item.RecallNumber,
        year: yearFromText(date),
        listingTitle: item.Title,
        fullTitle:
          `${item.Title}. Recall date ${date}.` +
          `${products ? ` Products: ${products}.` : ""}` +
          `${item.Description ? ` ${item.Description}` : ""}` +
          `${injuries ? ` Incidents/injuries: ${injuries}.` : ""}` +
          `${remedies ? ` Remedy: ${remedies}.` : ""}`,
        url: item.URL,
      }),
    ];
  });
}

function parseDatedLinkList(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, element) => {
    if (entries.length >= 30) return;
    const anchor = $(element);
    const url = absolutizeUrl(anchor.attr("href") ?? "", source.url);
    if (!isDatedLinkCandidate(url, source) || seen.has(url)) return;

    const container = anchor.closest(".views-row, article, tr, li, .search-result");
    const context = cleanText((container.length ? container : anchor.parent()).html() ?? "");
    const title = cleanText(anchor.html() ?? "") || titleFromSlug(url);
    const datetime = container.find("time[datetime]").first().attr("datetime") ?? "";
    const date = datetime.slice(0, 10) || extractDate(context) || extractDate(url);
    if (!date && !/\.pdf(?:$|\?)/i.test(url)) return;

    seen.add(url);
    entries.push(
      buildEntry(source, {
        label: date ? `${source.name} ${date}` : title.slice(0, 100),
        number: null,
        year: yearFromText(date || context),
        listingTitle: title,
        fullTitle: `${title}.${date ? ` Published or posted ${date}.` : ""}${context && context !== title ? ` ${context}` : ""}`,
        url,
      }),
    );
  });

  return entries;
}

function isDatedLinkCandidate(url: string, source: SourceDefinition): boolean {
  switch (source.view) {
    case "ofac-list-updates":
      return /ofac\.treasury\.gov\/recent-actions\/\d{8}(?:$|[?#])/i.test(url);
    case "nc-deq-news":
      return /deq\.nc\.gov\/news\/press-releases\/\d{4}\/\d{2}\/\d{2}\//i.test(url);
    case "nc-labor-news":
      return /labor\.nc\.gov\/news\/press-releases\/\d{4}\/\d{2}\/\d{2}\//i.test(url);
    case "nc-tax-updates":
      return /ncdor\.gov\/(?:news\/|taxes-forms\/|documents\/)/i.test(url);
    case "ca-register":
      return /\.pdf(?:$|\?)/i.test(url) && /notice|register/i.test(url);
    case "ny-register":
      return /dos\.ny\.gov\/system\/files\/documents\/\d{4}\/\d{2}\/.*\.pdf/i.test(url);
    default:
      return /\b(?:20\d{2})[/-](?:0?\d{1,2})[/-](?:0?\d{1,2})\b|\.pdf(?:$|\?)/i.test(url);
  }
}

function parseNcRegister(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();

  $("a[href*='files.nc.gov'][href*='.pdf']").each((_, element) => {
    if (entries.length >= 12) return;
    const anchor = $(element);
    const url = absolutizeUrl(anchor.attr("href") ?? "", source.url);
    if (seen.has(url)) return;
    const container = anchor.closest("tr, .views-row, article, li");
    const context = cleanText((container.length ? container : anchor.parent()).html() ?? "");
    const issue = context.match(/Volume\s+\d+\s+Issue\s+\d+/i)?.[0] ?? cleanText(anchor.html() ?? "");
    const datetime = container.find("time[datetime]").first().attr("datetime") ?? "";
    const date = datetime.slice(0, 10) || extractDate(context) || extractDate(url);
    if (!issue || !date) return;

    seen.add(url);
    entries.push(
      buildEntry(source, {
        label: issue,
        number: issue.match(/Issue\s+(\d+)/i)?.[1] ?? null,
        year: yearFromText(date),
        listingTitle: `${issue} - ${date}`,
        fullTitle: `${issue} of the North Carolina Register, published ${date}. The issue may contain proposed rules, adopted rules, hearing notices, executive orders, and other rulemaking actions; inspect the PDF for company applicability.`,
        url,
      }),
    );
  });

  return entries;
}

function parseAirNoticeTables(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();

  $("table tr").each((_, element) => {
    if (entries.length >= 30) return;
    const row = $(element);
    const anchor = row.find("a[href]").first();
    if (!anchor.length) return;
    const context = cleanText(row.html() ?? "");
    if (!/permit|rule|public comment|hearing|enforcement|posted|deadline/i.test(context)) return;
    const baseUrl = absolutizeUrl(anchor.attr("href") ?? "", source.url);
    const date = extractDate(context);
    const versionedUrl = date ? `${baseUrl}#cante-posted-${date}` : baseUrl;
    if (seen.has(versionedUrl)) return;
    const title = cleanText(row.find("td").first().html() ?? anchor.html() ?? "") || titleFromSlug(baseUrl);

    seen.add(versionedUrl);
    entries.push(
      buildEntry(source, {
        label: date ? `${source.name} ${date}` : title.slice(0, 100),
        number: null,
        year: yearFromText(date || context),
        listingTitle: title,
        fullTitle: `${title}. ${context}`,
        url: versionedUrl,
      }),
    );
  });

  return entries;
}

function parseTexasRegister(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const current = $("a[title*='Current Issue in HTML']").first();
  const line = cleanText(current.parent().html() ?? "");
  const date = extractDate(line);
  if (!current.length || !date) return [];
  const baseUrl = absolutizeUrl(current.attr("href") ?? "", source.url);
  return [
    buildEntry(source, {
      label: `Texas Register ${date}`,
      number: null,
      year: yearFromText(date),
      listingTitle: `Texas Register current issue - ${date}`,
      fullTitle: `Texas Register issue published ${date}. It may contain proposed, adopted, withdrawn, and emergency state rules; inspect the issue for company applicability.`,
      url: `${baseUrl}#cante-issue-${date}`,
    }),
  ];
}

function extractDate(value: string): string {
  const iso = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|\d{2})\b/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const named = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i,
  );
  if (!named) return "";
  const month = new Date(`${named[1]} 1, 2000`).getMonth() + 1;
  return `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
}

/**
 * Federal Register listings, via the documented no-key API.
 *
 * The dates arrive with the listing. This is the one place the US side is
 * structurally better off than the Indonesian one: Kemendag's listing carries
 * a year and nothing else, so judgment has to fetch a detail page to learn
 * when a rule was enacted. The Federal Register returns `effective_on`,
 * `comments_close_on`, `dates` and `type` as fields, so the same rule — never
 * assert recency from a listing alone — is satisfied with zero extra fetches.
 *
 * These fields are only present because `federalRegister()` asks for them via
 * `fields[]`. Without that the API returns a short default set, this parser
 * silently read `undefined` for every date, and every US alert had to disclose
 * that effective dates were unverified.
 */
function parseFederalRegisterJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    results?: Array<{
      title?: string;
      type?: string;
      action?: string | null;
      abstract?: string | null;
      dates?: string | null;
      document_number?: string;
      html_url?: string;
      raw_text_url?: string | null;
      publication_date?: string;
      effective_on?: string | null;
      comments_close_on?: string | null;
      citation?: string | null;
      agencies?: Array<{ name?: string }>;
    }>;
  };

  return (payload.results ?? []).flatMap((item) => {
    if (!item.title || !item.html_url || !item.document_number) return [];
    const agency = item.agencies?.map((a) => a.name).filter(Boolean).join(", ");
    const date = item.publication_date ?? "date unknown";
    const effective = item.effective_on
      ? ` Effective ${item.effective_on}.`
      : " No effective date published.";
    const comments = item.comments_close_on ? ` Comments close ${item.comments_close_on}.` : "";
    return [
      buildEntry(source, {
        label: item.citation ?? `${item.document_number} (${item.type ?? "Document"})`,
        number: item.document_number,
        year: yearFromText(date),
        listingTitle: item.title,
        fullTitle:
          `[${item.type ?? "Document"}] ${item.title}. Published ${date}.${effective}${comments}` +
          `${agency ? ` Agency: ${agency}.` : ""}` +
          `${item.action ? ` Action: ${item.action}` : ""}` +
          `${item.abstract ? ` ${item.abstract}` : ""}`,
        url: item.html_url,
        textUrl: item.raw_text_url ?? undefined,
        effectiveOn: item.effective_on ?? null,
        commentsCloseOn: item.comments_close_on ?? null,
        datesNote: item.dates ?? null,
        documentType: item.type ?? null,
        action: item.action ?? null,
      }),
    ];
  });
}

function parseEcfrVersionsJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    content_versions?: Array<{
      date?: string;
      amendment_date?: string;
      issue_date?: string;
      identifier?: string;
      name?: string;
      part?: string;
      substantive?: boolean;
      removed?: boolean;
      title?: string;
      type?: string;
    }>;
  };
  const versions = new Map<string, NonNullable<typeof payload.content_versions>[number]>();

  for (const item of payload.content_versions ?? []) {
    if (!item.identifier || !item.title || item.substantive === false) continue;
    const itemDate = item.amendment_date ?? item.date ?? item.issue_date ?? "";
    const key = `${item.type ?? "section"}:${item.identifier}:${itemDate}`;
    if (!versions.has(key)) versions.set(key, item);
  }

  return [...versions.values()]
    .sort((a, b) =>
      (b.amendment_date ?? b.date ?? b.issue_date ?? "").localeCompare(
        a.amendment_date ?? a.date ?? a.issue_date ?? "",
      ),
    )
    .map((item) => {
      const date = item.amendment_date ?? item.date ?? item.issue_date ?? "date unknown";
      const type = item.type ?? "section";
      const pathType = type === "appendix" ? "appendix" : "section";
      const citationUrl = new URL(
        `/current/title-${item.title}/${pathType}-${item.identifier}`,
        "https://www.ecfr.gov",
      ).toString();
      const identityDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "date-unknown";
      const url = `${citationUrl}#cante-amendment-${identityDate}`;
      const status = item.removed ? "Removed" : "Changed";
      return buildEntry(source, {
        label: `${item.title} CFR ${item.identifier}`,
        number: item.identifier ?? null,
        year: yearFromText(date),
        listingTitle: item.name ?? `${item.title} CFR ${item.identifier}`,
        fullTitle:
          `${status} ${date}: ${item.name ?? `${item.title} CFR ${item.identifier}`}. ` +
          `This is the codified text as amended, not a proposal. The amendment date is not proof of the rule's legal effective date.`,
        url,
        effectiveOn: null,
        amendedOn: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        documentType: item.removed ? "Removed CFR text" : "Amended CFR text",
      });
    });
}

function parseRssEntries(xml: string, source: SourceDefinition): RegulationEntry[] {
  const entries: RegulationEntry[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;

  for (const match of xml.matchAll(itemRe)) {
    const block = match[1];
    const title = cleanText(xmlValue(block, "title"));
    const url = cleanText(xmlValue(block, "link"));
    const description = cleanText(xmlValue(block, "description"));
    const published = cleanText(xmlValue(block, "pubDate"));
    if (!title || !url) continue;
    const documentNumber = url.match(/\/documents\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\//)?.[1] ?? null;
    entries.push(
      buildEntry(source, {
        label: documentNumber ?? title.slice(0, 80),
        number: documentNumber,
        year: yearFromText(published || description),
        listingTitle: title,
        fullTitle: `${title}. Published ${published || "date unknown"}. ${description}`,
        url,
      }),
    );
    if (entries.length >= 20) break;
  }

  return entries;
}

function xmlValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? "";
}

function parseHtmlHeartbeat(html: string, source: SourceDefinition): RegulationEntry[] {
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  if (!title) return [];
  return [
    buildEntry(source, {
      label: "Portal reachable",
      number: null,
      year: yearFromText(title),
      listingTitle: title,
      fullTitle: `${title} is reachable. This is a portal heartbeat, not proof that every change was checked.`,
      url: source.url,
    }),
  ];
}

export function parseKemendagEntries(html: string, source: SourceDefinition): RegulationEntry[] {
  const entries: RegulationEntry[] = [];
  ENTRY_RE.lastIndex = 0;
  const view = source.view ?? source.id;

  for (const match of html.matchAll(ENTRY_RE)) {
    const [, url, rawLabel, rawTitle] = match;
    const label = cleanText(rawLabel);
    const listingTitle = cleanText(rawTitle);

    const labelMatch = LABEL_RE.exec(label);

    entries.push({
      sourceId: source.id,
      sourceName: source.name,
      domain: source.domain,
      regulationType: source.regulationType,
      label,
      number: labelMatch ? labelMatch[1] : null,
      year: labelMatch ? Number(labelMatch[2]) : null,
      listingTitle,
      truncated: listingTitle.endsWith("…") || listingTitle.endsWith("..."),
      fullTitle: titleFromSlug(url),
      url,
      foundInViews: [view],
    });
  }

  return entries;
}

function parseKemenkeuHome(html: string, source: SourceDefinition): RegulationEntry[] {
  const anchorEntries = parseAnchorRegulations(html, source, /jdih\.kemenkeu\.go\.id\/dok\//i);
  return anchorEntries.filter((entry) => /^(PMK|KMK|PER|SE|INS)[\s-]/i.test(entry.label));
}

function parseBsnPesta(html: string, source: SourceDefinition): RegulationEntry[] {
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\s+[^>]*href=["']([^"']*\/produk\/detail\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRe)) {
    const url = absolutizeUrl(match[1], source.url);
    if (seen.has(url)) continue;
    const text = cleanText(match[2]);
    const standard = text.match(/\bSNI[\w\s./:-]*\d{4}\b/i)?.[0]?.trim() ?? null;
    if (!standard && !/\bSNI\b/i.test(text)) continue;

    seen.add(url);
    const title = text || standard || "SNI catalogue entry";
    entries.push(
      buildEntry(source, {
        label: standard ?? "SNI",
        number: standard,
        year: yearFromText(title),
        listingTitle: title,
        fullTitle: title,
        url,
      }),
    );
    if (entries.length >= MAX_GENERIC_ENTRIES) break;
  }

  return entries;
}

function parseOssKbliVersionsJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    success?: boolean;
    code?: number;
    data?: Array<{ id?: string; version?: string }>;
  };
  if (payload.success !== true || !Array.isArray(payload.data)) {
    throw new Error("OSS KBLI version payload did not contain a successful data array");
  }

  const versions = payload.data
    .map((item) => item.version?.trim())
    .filter((version): version is string => Boolean(version));
  if (versions.length === 0) return [];
  const years = versions.map(Number).filter(Number.isFinite);
  const latestYear = years.length > 0 ? Math.max(...years) : null;

  return [
    buildEntry(source, {
      label: "OSS KBLI catalogue",
      number: null,
      year: latestYear,
      listingTitle: `Published KBLI versions: ${versions.join(", ")}`,
      fullTitle:
        `Official OSS KBLI gateway reachable. Published catalogue versions: ${versions.join(", ")}. ` +
        "This confirms catalogue availability, not a company's license status or complete obligation coverage.",
      url: "https://oss.go.id/id/kbli",
    }),
  ];
}

/**
 * pasal.id — a PRIVATE re-publisher, not a government record. This is the only
 * route to Kemenperin's regulations: `jdih.kemenperin.go.id` has been dark to
 * the outside world since Feb 2024 and `peraturan.go.id` (the record pasal.id
 * itself cites as its source) is equally dead, so nothing official is reachable
 * for the ministry that governs MA's own sector.
 *
 * Three properties of this feed are load-bearing and must not be smoothed over:
 *
 * 1. **No dates. At all.** Not in the listing, not in the detail response —
 *    only `year`. This is the Kemendag problem in a harder form, since here
 *    there is no detail page carrying a real enactment date either. `effectiveOn`
 *    stays null and the entry says outright that recency is unestablished.
 * 2. **`verification.tier` is the publisher's own confidence.** Every observed
 *    Kemenperin row is `parsed_unreviewed` with `content_verified: false` — the
 *    publisher stating nobody checked it. That travels into `provenance` rather
 *    than being dropped, because a re-publisher's unreviewed parse is the
 *    weakest evidence in this system and judgment has to weigh it as such.
 * 3. **`type=PERMEN` is not a clean bucket.** The unfiltered feed mixes in
 *    other issuers entirely (a Keputusan KPU came back under PERMEN), so the
 *    `issuing_body` filter is what makes this a Kemenperin source. Rows whose
 *    issuing body is not the requested one are dropped rather than reported as
 *    ministry coverage.
 */
/** pasal.id instrument codes → the Indonesian name a reader expects. */
const PASAL_TYPE_LABELS: Record<string, string> = {
  PERMEN: "Peraturan Menteri",
  KEPMEN: "Keputusan Menteri",
  PERDA: "Peraturan Daerah",
  PERGUB: "Peraturan Gubernur",
  PERWALI: "Peraturan Walikota",
  PERBUP: "Peraturan Bupati",
  PERBAN: "Peraturan Badan",
  SE: "Surat Edaran",
  PP: "Peraturan Pemerintah",
  PERPRES: "Peraturan Presiden",
  UU: "Undang-Undang",
};

function parsePasalLawsJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    total?: unknown;
    laws?: Array<{
      frbr_uri?: string;
      title?: string;
      number?: string;
      year?: number;
      status?: string;
      type?: string;
      content_verified?: boolean;
      verification?: { tier?: string } | null;
      issuing_body?: { slug?: string; name?: string; abbreviation?: string } | null;
      // Not returned by the API today. pasal.id stores both (migration 018) and
      // renders them on its own pages, so an upstream request to expose them is
      // open — see CLAUDE.md. Read them here so that the day they appear, the
      // date arrives free and `enrichPasalDates()` simply finds nothing to do.
      tanggal_penetapan?: string | null;
      tanggal_pengundangan?: string | null;
    }>;
  };
  if (!Array.isArray(payload.laws)) throw new Error("pasal.id payload did not contain laws");

  // The issuing body this source claims to cover. A row from any other issuer
  // is not this ministry's coverage, however well it parses.
  const expectedBody = new URL(source.url).searchParams.get("issuing_body");

  return payload.laws.flatMap((law) => {
    if (!law.frbr_uri || !law.title) return [];
    const bodySlug = law.issuing_body?.slug ?? null;
    if (expectedBody && bodySlug !== expectedBody) return [];

    const body = law.issuing_body?.name ?? "";
    const tier = law.verification?.tier ?? "unknown";
    const verified = law.content_verified === true;
    const number = law.number ?? null;
    const year = typeof law.year === "number" ? law.year : null;

    // pasal.id titles read "Peraturan Daerah Nomor 1 Tahun 2026 tentang …" — the
    // issuer lives in issuing_body, not the title, so a bare title cannot tell
    // one ministry or one city from another. Build the label from both, and from
    // the instrument type: "Kota Surabaya" under a PERDA must not come out as
    // "Peraturan Menteri Surabaya".
    const kind = PASAL_TYPE_LABELS[law.type ?? ""] ?? law.type ?? "Peraturan";
    const issuer = body.replace(/^Kementerian\s+/i, "").trim();
    const label = `${kind}${issuer ? ` ${issuer}` : ""} Nomor ${number ?? "?"} Tahun ${year ?? "?"}`;
    // Titles arrive with embedded CRLFs from the source PDF.
    const title = law.title.replace(/\s+/g, " ").trim();
    const subject = title.replace(/^.*?\btentang\s+/i, "").trim() || title;
    const enacted = law.tanggal_penetapan?.slice(0, 10) ?? null;
    const promulgated = law.tanggal_pengundangan?.slice(0, 10) ?? null;
    const datesNote =
      enacted || promulgated
        ? `${[enacted ? `Ditetapkan ${enacted}` : null, promulgated ? `Diundangkan ${promulgated}` : null]
            .filter(Boolean)
            .join("; ")}. Tanggal berlaku menurut pasal penutup belum dipastikan.`
        : null;

    return [
      buildEntry(source, {
        label,
        number,
        year,
        listingTitle: `${label} tentang ${subject}`,
        fullTitle:
          `${label} tentang ${subject}.` +
          `${law.status ? ` Status menurut penerbit ulang: ${law.status}.` : ""}` +
          (datesNote
            ? ` ${datesNote}`
            : " Listing ini tidak mencantumkan tanggal penetapan atau pengundangan;" +
              " tanggal dilengkapi terpisah bila tersedia."),
        datesNote,
        // Verified to resolve: https://pasal.id + frbr_uri returns HTTP 200.
        // Built from the identifier the API returned, never guessed from a slug.
        url: new URL(law.frbr_uri, "https://pasal.id").toString(),
        // No date is available anywhere in this API, so asserting one would be
        // invention. Absence is the honest value.
        effectiveOn: null,
        documentType: law.type ?? "PERMEN",
        provenance:
          `Diterbitkan ulang oleh pasal.id (basis data hukum swasta), bukan catatan resmi pemerintah. ` +
          `Tingkat verifikasi penerbit: ${tier}` +
          `${verified ? "" : " (belum ditinjau manusia)"}. ` +
          `JDIH ${body} dan peraturan.go.id tidak dapat diakses, jadi teks resmi belum diverifikasi ke sumber pemerintah. ` +
          `Perlakukan sebagai petunjuk yang harus dikonfirmasi, bukan bukti.`,
      }),
    ];
  });
}

function parseSetnegJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    data?: Array<{
      idperaturan?: string;
      no_peraturan?: string;
      tahun?: string;
      tentang?: string;
      jns?: string;
      nama_jenis?: string;
      files?: string;
      tgl_di?: string | null;
      diundangkan?: string | null;
      status_hukum?: string | null;
    }>;
  };
  if (!Array.isArray(payload.data)) throw new Error("Setneg payload did not contain data");

  return payload.data.flatMap((item) => {
    if (!item.idperaturan || !item.no_peraturan || !item.tahun || !item.tentang) return [];
    const kind = item.nama_jenis ?? item.jns ?? "Peraturan";
    const label = `${kind} Nomor ${item.no_peraturan} Tahun ${item.tahun}`;
    const signed = item.tgl_di?.slice(0, 10) ?? null;
    const promulgated = item.diundangkan?.slice(0, 10) ?? null;
    const pdf = new URL("/api/hukumproduk/pdf", source.url);
    pdf.searchParams.set("l", "uploads");
    pdf.searchParams.set("fl", item.idperaturan);
    if (item.files) pdf.searchParams.set("f", item.files);
    const url = item.files ? pdf.toString() : "https://jdih.setneg.go.id/";

    return [
      buildEntry(source, {
        label,
        number: item.no_peraturan,
        year: Number(item.tahun) || null,
        listingTitle: `${label} tentang ${item.tentang}`,
        fullTitle:
          `${label} tentang ${item.tentang}.` +
          `${signed ? ` Ditetapkan ${signed}.` : ""}` +
          `${promulgated ? ` Diundangkan ${promulgated}.` : ""}` +
          `${item.status_hukum ? ` Status hukum: ${item.status_hukum}.` : ""}`,
        url,
        textUrl: item.files ? url : undefined,
        effectiveOn: null,
        documentType: kind,
      }),
    ];
  });
}

function parseKlhJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    data?: Array<{
      id?: number;
      title?: string;
      description?: string;
      lampiran_url?: string;
      created_at?: string;
      updated_at?: string;
      dynamic_fields?: Record<string, string | undefined>;
    }>;
  };
  if (!Array.isArray(payload.data)) throw new Error("KLH payload did not contain data");

  return payload.data.flatMap((item) => {
    if (!item.id || !item.title || !item.lampiran_url) return [];
    const fields = item.dynamic_fields ?? {};
    const number = fields.no_peraturan ?? null;
    const enacted = fields.tanggal_penetapan;
    const promulgated = fields.tanggal_pengundangan;
    const kind = fields.jenis ?? fields.singkatan ?? "Dokumen hukum lingkungan";
    return [
      buildEntry(source, {
        label: fields.singkatan && number ? `${fields.singkatan} ${number}` : item.title,
        number,
        year: yearFromText(item.title),
        listingTitle: `${item.title}${item.description ? ` - ${item.description}` : ""}`,
        fullTitle:
          `${item.title}${item.description ? ` ${item.description}.` : "."}` +
          `${enacted ? ` Ditetapkan ${enacted}.` : ""}` +
          `${promulgated ? ` Diundangkan ${promulgated}.` : ""}` +
          `${fields.status_peraturan ? ` Status: ${fields.status_peraturan}.` : ""}` +
          `${fields.sumber ? ` Sumber: ${fields.sumber}.` : ""}` +
          `${item.created_at ? ` Diunggah ${item.created_at.slice(0, 10)}.` : ""}` +
          `${item.updated_at ? ` Metadata diperbarui ${item.updated_at.slice(0, 10)}.` : ""}`,
        url: item.lampiran_url,
        textUrl: item.lampiran_url,
        effectiveOn: null,
        documentType: kind,
      }),
    ];
  });
}

function parseKemnaker(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();
  $(".result-card").each((_, element) => {
    if (entries.length >= MAX_GENERIC_ENTRIES) return;
    const card = $(element);
    const anchor = card.find("a[href*='/peraturan/detail/']").first();
    const title = cleanText(anchor.html() ?? "");
    const url = absolutizeUrl(anchor.attr("href") ?? "", source.url);
    if (!title || !url || seen.has(url)) return;
    const context = cleanText(card.html() ?? "");
    const metadata = labelFromText(title, url);
    seen.add(url);
    entries.push(
      buildEntry(source, {
        ...metadata,
        listingTitle: title,
        fullTitle: `${context}. Listing order is upload chronology; use the stated legal dates, not its position, for recency.`,
        url,
      }),
    );
  });
  return entries;
}

function parseDjbcHome(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  const heading = $("*")
    .filter((_, element) => cleanText($(element).html() ?? "") === "PERATURAN BARU DITAMBAHKAN ...")
    .first();
  const list = heading.parent().parent().find("ol li");
  list.each((_, element) => {
    if (entries.length >= MAX_GENERIC_ENTRIES) return;
    const row = $(element);
    const anchor = row.find("a[href]").first();
    const label = cleanText(anchor.html() ?? "");
    const url = absolutizeUrl(anchor.attr("href") ?? "", source.url);
    if (!label || !url) return;
    const context = cleanText(row.html() ?? "");
    const metadata = labelFromText(label, url);
    const displayedYear = metadata.year;
    const urlYear = yearFromText(url);
    const currentYear = new Date().getUTCFullYear();
    const malformedYear = displayedYear !== null && displayedYear > currentYear + 1;
    entries.push(
      buildEntry(source, {
        ...metadata,
        year: malformedYear ? urlYear : displayedYear,
        listingTitle: context,
        fullTitle:
          `${context}.` +
          `${malformedYear ? ` The directory displays an implausible year (${displayedYear}); verify against the issuing authority before relying on it.` : ""}`,
        url,
      }),
    );
  });
  return entries;
}

function parseDjpList(html: string, source: SourceDefinition): RegulationEntry[] {
  const $ = load(html);
  const entries: RegulationEntry[] = [];
  $(".peraturan-content").each((_, element) => {
    if (entries.length >= MAX_GENERIC_ENTRIES) return;
    const row = $(element);
    const anchor = row.find("a[href*='/peraturan/']").first();
    const label = cleanText(anchor.html() ?? "");
    const url = absolutizeUrl(anchor.attr("href") ?? "", source.url);
    if (!label || !url) return;
    const context = cleanText(row.html() ?? "");
    const metadata = labelFromText(label, url);
    entries.push(
      buildEntry(source, {
        ...metadata,
        year: metadata.year ?? yearFromText(context),
        listingTitle: context,
        fullTitle: context,
        url,
      }),
    );
  });
  return entries;
}

function parseSurabayaRegulationsJson(
  json: string,
  source: SourceDefinition,
): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    data?: Array<{
      id?: string;
      dok_tipe_full?: string;
      dok_no?: string;
      dok_tahun?: string;
      dok_judul?: string;
      status?: string;
      penetapan_tgl?: string | null;
    }>;
  };
  if (!Array.isArray(payload.data)) throw new Error("Surabaya payload did not contain data");
  return payload.data.flatMap((item) => {
    if (!item.id || !item.dok_tipe_full || !item.dok_no || !item.dok_judul) return [];
    const url = `https://jdih.surabaya.go.id/peraturan/${encodeURIComponent(item.id)}`;
    const year = Number(item.dok_tahun) || yearFromText(item.penetapan_tgl ?? "");
    return [
      buildEntry(source, {
        label: `${item.dok_tipe_full} Nomor ${item.dok_no}`,
        number: item.dok_no,
        year,
        listingTitle: item.dok_judul,
        fullTitle:
          `${item.dok_tipe_full} Nomor ${item.dok_no}${year ? ` Tahun ${year}` : ""} tentang ${item.dok_judul}.` +
          `${item.penetapan_tgl ? ` Ditetapkan ${item.penetapan_tgl}.` : ""}` +
          `${item.status ? ` Status katalog: ${item.status}.` : ""}`,
        url,
        textUrl: `https://jdih.surabaya.go.id/peraturan/download/${encodeURIComponent(item.id)}`,
        effectiveOn: null,
        documentType: item.dok_tipe_full,
      }),
    ];
  });
}

function parseSurabayaDlhJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    data?: Array<{
      nama_jenis?: string;
      jenis_pengumuman?: string;
      tgl_mohon?: string;
      file?: string;
      created_at?: string;
    }>;
  };
  if (!Array.isArray(payload.data)) throw new Error("Surabaya DLH payload did not contain data");
  const windowStart = source.windowStart ?? "0000-00-00";
  return payload.data
    .filter((item) => (item.created_at?.slice(0, 10) ?? "") >= windowStart)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .flatMap((item) => {
      if (!item.nama_jenis || !item.jenis_pengumuman || !item.file) return [];
      const posted = item.created_at?.slice(0, 10) ?? null;
      const url = `https://lh.surabaya.go.id/fileupload/${item.file.replace(/^\/+/, "")}`;
      return [
        buildEntry(source, {
          label: `${item.jenis_pengumuman} Surabaya${posted ? ` ${posted}` : ""}`,
          number: null,
          year: yearFromText(posted ?? item.tgl_mohon ?? ""),
          listingTitle: item.nama_jenis,
          fullTitle:
            `${item.jenis_pengumuman} environmental-document notice: ${item.nama_jenis}.` +
            `${item.tgl_mohon ? ` Application date ${item.tgl_mohon}.` : ""}` +
            `${posted ? ` Posted ${posted}.` : ""}` +
            " This is a project/facility notice, not a generally applicable regulation.",
          url,
          textUrl: url,
          documentType: `${item.jenis_pengumuman} notice`,
        }),
      ];
    });
}

function parseAnchorRegulations(
  html: string,
  source: SourceDefinition,
  urlPattern?: RegExp,
): RegulationEntry[] {
  const entries: RegulationEntry[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRe)) {
    const url = absolutizeUrl(match[1], source.url);
    if (seen.has(url)) continue;
    if (urlPattern && !urlPattern.test(url)) continue;

    const text = cleanText(match[2]);
    const candidate = text || titleFromSlug(url);
    if (!looksLikeRegulation(candidate)) continue;

    const { label, number, year } = labelFromText(candidate, url);
    seen.add(url);
    entries.push(
      buildEntry(source, {
        label,
        number,
        year,
        listingTitle: candidate,
        fullTitle: candidate.length > 20 ? candidate : titleFromSlug(url),
        url,
      }),
    );
    if (entries.length >= MAX_GENERIC_ENTRIES) break;
  }

  return entries;
}

function buildEntry(
  source: SourceDefinition,
  entry: {
    label: string;
    number: string | null;
    year: number | null;
    listingTitle: string;
    fullTitle: string;
    url: string;
    textUrl?: string;
    effectiveOn?: string | null;
    amendedOn?: string | null;
    commentsCloseOn?: string | null;
    datesNote?: string | null;
    documentType?: string | null;
    action?: string | null;
    provenance?: string;
  },
): RegulationEntry {
  return {
    sourceId: source.id,
    sourceName: source.name,
    domain: source.domain,
    regulationType: source.regulationType,
    label: entry.label,
    number: entry.number,
    year: entry.year,
    listingTitle: entry.listingTitle,
    truncated: entry.listingTitle.endsWith("…") || entry.listingTitle.endsWith("..."),
    fullTitle: entry.fullTitle,
    url: entry.url,
    ...(Object.hasOwn(entry, "textUrl") ? { textUrl: entry.textUrl } : {}),
    ...(Object.hasOwn(entry, "effectiveOn") ? { effectiveOn: entry.effectiveOn ?? null } : {}),
    ...(Object.hasOwn(entry, "amendedOn") ? { amendedOn: entry.amendedOn ?? null } : {}),
    ...(Object.hasOwn(entry, "commentsCloseOn")
      ? { commentsCloseOn: entry.commentsCloseOn ?? null }
      : {}),
    ...(Object.hasOwn(entry, "datesNote") ? { datesNote: entry.datesNote ?? null } : {}),
    ...(Object.hasOwn(entry, "documentType")
      ? { documentType: entry.documentType ?? null }
      : {}),
    ...(Object.hasOwn(entry, "action") ? { action: entry.action ?? null } : {}),
    ...(entry.provenance ? { provenance: entry.provenance } : {}),
    foundInViews: [source.view ?? source.id],
  };
}

/** Strip tags and entities out of a listing fragment, collapse whitespace. */
function cleanText(fragment: string): string {
  const withoutTags = fragment.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    hellip: "…",
  };
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole);
}

/**
 * Rebuild the full title from the detail-URL slug.
 *
 * The listing truncates titles with an ellipsis, cutting off exactly the part
 * that says what the regulation covers. The slug carries the whole thing —
 * lowercased and hyphenated, but complete, which matters more.
 */
function titleFromSlug(url: string): string {
  const slug = url.replace(/\/+$/, "").split("/").pop() ?? "";
  return decodeURIComponent(slug).replace(/-/g, " ").trim();
}

function absolutizeUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Site chrome that satisfies any keyword test but is never a regulation. */
const NAVIGATION_TEXT_RE =
  /^(beranda|home|login|masuk|daftar|register|kontak|contact|tentang|about|profil|profile|bantuan|help|faq|pencarian|cari|search|selengkapnya|lihat semua|read more|next|prev|previous|berikutnya|sebelumnya|\d+)$/i;

/**
 * A citable regulation, not merely a page that mentions one.
 *
 * The previous version tested `${text} ${url}` against a word list containing
 * bare `uu`, `pp`, `oss` and `kbli` — and the URL *is* peraturan.go.id/pp, so
 * every anchor on the page passed, nav and footer included. It only ever looked
 * harmless because the fetch always failed; the first successful fetch would
 * have produced 30 junk entries, each costing a detail-page read and a
 * judgment. So: match the link text only, and require both a regulation word
 * and a number or year, which is what makes a rule citable at all.
 */
function looksLikeRegulation(text: string): boolean {
  const candidate = text.trim();
  if (candidate.length < 10) return false;
  if (NAVIGATION_TEXT_RE.test(candidate)) return false;

  const hasRegulationWord =
    /\b(undang[-\s]?undang|peraturan pemerintah|peraturan presiden|keputusan presiden|peraturan menteri|keputusan menteri|peraturan daerah|peraturan|perpres|keppres|kepres|permen|kepmen|perda|perkada|pmk|kmk)\b/i.test(
      candidate,
    ) || /\bSNI\b/.test(candidate);

  const hasCitation =
    /\b(nomor|no\.?)\s*[\w./-]*\d/i.test(candidate) ||
    /\btahun\s+(19|20)\d{2}\b/i.test(candidate) ||
    /\b(PMK|KMK|SNI)[\s-]*[\w./-]*\d/i.test(candidate);

  return hasRegulationWord && hasCitation;
}

function labelFromText(text: string, url: string): {
  label: string;
  number: string | null;
  year: number | null;
} {
  const source = `${text} ${titleFromSlug(url)}`;
  const patterns = [
    /\b(PMK|KMK|PER|SE|INS)\s*[-\s]?\s*([\w./-]+)\s+TAHUN\s+(\d{4})\b/i,
    /\b(Undang[-\s]?Undang|UU|Peraturan Pemerintah|PP|Peraturan Presiden|Perpres|Keputusan Presiden|Keppres|Kepres|Peraturan Menteri|Permen)\s+(?:Nomor|No\.?)?\s*([\w./-]+)\s+Tahun\s+(\d{4})\b/i,
    /\b(SNI[\w\s./:-]*?(\d{4}))\b/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    if (/^SNI/i.test(match[1])) {
      return { label: match[1].trim(), number: match[1].trim(), year: Number(match[2]) };
    }
    return {
      label: `${match[1].replace(/\s+/g, " ")} ${match[2]} Tahun ${match[3]}`,
      number: match[2],
      year: Number(match[3]),
    };
  }

  return {
    label: text.slice(0, 80) || titleFromSlug(url).slice(0, 80),
    number: null,
    year: yearFromText(source),
  };
}

function yearFromText(text: string): number | null {
  const match = text.match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/** Deduplicate across views on the detail URL, then sort newest-first. */
export function mergeEntries(entries: RegulationEntry[]): RegulationEntry[] {
  const merged = new Map<string, RegulationEntry>();

  for (const entry of entries) {
    const existing = merged.get(entry.url);
    if (existing) {
      for (const view of entry.foundInViews) {
        if (!existing.foundInViews.includes(view)) existing.foundInViews.push(view);
      }
    } else {
      merged.set(entry.url, { ...entry, foundInViews: [...entry.foundInViews] });
    }
  }

  return [...merged.values()].sort((a, b) => {
    const yearDiff = (b.year ?? 0) - (a.year ?? 0);
    if (yearDiff !== 0) return yearDiff;
    return numericPart(b.number) - numericPart(a.number);
  });
}

function numericPart(value: string | null): number {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}
