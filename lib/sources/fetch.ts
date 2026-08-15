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

export interface RegulationEntry {
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
}

export interface FetchReport {
  runAt: string;
  outcomes: FetchOutcome[];
  regulations: RegulationEntry[];
}

/**
 * One card = an <h6> whose <a> links to a /peraturan/<slug> detail page and
 * whose label is "<number> Tahun <year>", followed by a <p> with the title.
 */
const ENTRY_RE =
  /<h6[^>]*>\s*<a\s+href="(https:\/\/jdih\.kemendag\.go\.id\/peraturan\/[^"#?]+)"[^>]*>\s*([^<]+?)\s*<\/a>\s*<\/h6>\s*<p[^>]*>\s*([\s\S]*?)\s*<\/p>/g;

const LABEL_RE = /^([\w./-]+)\s+Tahun\s+(\d{4})$/i;

export async function fetchAllSources(
  sources: SourceDefinition[],
  rawDir: string,
): Promise<FetchReport> {
  const outcomes: FetchOutcome[] = [];
  const all: RegulationEntry[] = [];

  for (const source of sources) {
    const { outcome, entries } = await fetchSource(source, rawDir);
    outcomes.push(outcome);
    all.push(...entries);
  }

  return {
    runAt: new Date().toISOString(),
    outcomes,
    regulations: mergeEntries(all),
  };
}

async function fetchSource(
  source: SourceDefinition,
  rawDir: string,
): Promise<{ outcome: FetchOutcome; entries: RegulationEntry[] }> {
  const outcome: FetchOutcome = {
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
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

    const entries = parseEntries(html, source.view ?? source.id);

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

export function parseEntries(html: string, view: string): RegulationEntry[] {
  const entries: RegulationEntry[] = [];
  ENTRY_RE.lastIndex = 0;

  for (const match of html.matchAll(ENTRY_RE)) {
    const [, url, rawLabel, rawTitle] = match;
    const label = cleanText(rawLabel);
    const listingTitle = cleanText(rawTitle);

    const labelMatch = LABEL_RE.exec(label);

    entries.push({
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
