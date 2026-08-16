import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
  };
}

async function fetchSource(
  source: SourceDefinition,
  rawDir: string,
): Promise<{ outcome: FetchOutcome; entries: RegulationEntry[] }> {
  const outcome = emptyOutcome(source);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? TIMEOUT_MS);
    let html: string;
    try {
      const res = await fetch(source.url, { headers: HEADERS, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    await mkdir(rawDir, { recursive: true });
    const rawPath = source.rawFilename ? path.join(rawDir, source.rawFilename) : null;
    if (rawPath) await writeFile(rawPath, html, "utf-8");

    const entries = parseEntries(html, source);

    outcome.success = true;
    outcome.rawContentPath = rawPath;
    outcome.contentLength = html.length;
    outcome.entriesParsed = entries.length;
    if (entries.length === 0) {
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

export function parseEntries(html: string, source: SourceDefinition): RegulationEntry[] {
  switch (source.parser) {
    case "peraturan-go-id":
      return parseAnchorRegulations(html, source, /peraturan\.go\.id\/(?:id\/)?/i);
    case "kemenkeu-home":
      return parseKemenkeuHome(html, source);
    case "bsn-pesta":
      return parseBsnPesta(html, source);
    case "oss-kbli":
      return parseOssKbliHeartbeat(html, source);
    case "generic-regulation":
      return parseAnchorRegulations(html, source);
    case "kemendag":
    default:
      return parseKemendagEntries(html, source);
  }
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

function parseOssKbliHeartbeat(html: string, source: SourceDefinition): RegulationEntry[] {
  const title =
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    "OSS KBLI and business licensing portal";
  if (!/\bKBLI\b/i.test(html)) return [];

  return [
    buildEntry(source, {
      label: "OSS KBLI",
      number: null,
      year: yearFromText(title),
      listingTitle: title,
      fullTitle:
        "OSS KBLI portal reachable; use confirmed KBLI codes to map risk, licensing, PB UMKU, and sector obligations.",
      url: source.url,
    }),
  ];
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
    foundInViews: [source.view ?? source.id],
  };
}

/** Strip tags and entities out of a listing fragment, collapse whitespace. */
function cleanText(fragment: string): string {
  const withoutTags = fragment.replace(/<[^>]+>/g, "");
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
