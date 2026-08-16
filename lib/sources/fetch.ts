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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? TIMEOUT_MS);
    let html: string;
    try {
      const res = await fetch(source.url, {
        headers: { ...HEADERS, ...source.requestHeaders },
        signal: controller.signal,
      });
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
    case "generic-regulation":
      return parseAnchorRegulations(html, source);
    case "kemendag":
    default:
      return parseKemendagEntries(html, source);
  }
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

function parseFederalRegisterJson(json: string, source: SourceDefinition): RegulationEntry[] {
  const payload = JSON.parse(json) as {
    results?: Array<{
      title?: string;
      type?: string;
      abstract?: string | null;
      document_number?: string;
      html_url?: string;
      publication_date?: string;
      effective_on?: string | null;
      citation?: string | null;
      agencies?: Array<{ name?: string }>;
    }>;
  };

  return (payload.results ?? []).slice(0, 20).flatMap((item) => {
    if (!item.title || !item.html_url || !item.document_number) return [];
    const agency = item.agencies?.map((a) => a.name).filter(Boolean).join(", ");
    const date = item.publication_date ?? "date unknown";
    const effective = item.effective_on ? ` Effective ${item.effective_on}.` : "";
    return [
      buildEntry(source, {
        label: item.citation ?? `${item.document_number} (${item.type ?? "Document"})`,
        number: item.document_number,
        year: yearFromText(date),
        listingTitle: item.title,
        fullTitle:
          `${item.title}. Published ${date}.${effective}` +
          `${agency ? ` Agency: ${agency}.` : ""}` +
          `${item.abstract ? ` ${item.abstract}` : ""}`,
        url: item.html_url,
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
  const latestByIdentifier = new Map<string, NonNullable<typeof payload.content_versions>[number]>();

  for (const item of payload.content_versions ?? []) {
    if (!item.identifier || !item.title || item.substantive === false) continue;
    const key = `${item.type ?? "section"}:${item.identifier}`;
    const existing = latestByIdentifier.get(key);
    const itemDate = item.amendment_date ?? item.date ?? item.issue_date ?? "";
    const existingDate = existing?.amendment_date ?? existing?.date ?? existing?.issue_date ?? "";
    if (!existing || itemDate > existingDate) latestByIdentifier.set(key, item);
  }

  return [...latestByIdentifier.values()]
    .sort((a, b) =>
      (b.amendment_date ?? b.date ?? b.issue_date ?? "").localeCompare(
        a.amendment_date ?? a.date ?? a.issue_date ?? "",
      ),
    )
    .slice(0, 3)
    .map((item) => {
      const date = item.amendment_date ?? item.date ?? item.issue_date ?? "date unknown";
      const type = item.type ?? "section";
      const pathType = type === "section" ? "section" : type === "part" ? "part" : "section";
      const url = `https://www.ecfr.gov/current/title-${item.title}/${pathType}-${item.identifier}`;
      const status = item.removed ? "Removed" : "Changed";
      return buildEntry(source, {
        label: `${item.title} CFR ${item.identifier}`,
        number: item.identifier ?? null,
        year: yearFromText(date),
        listingTitle: item.name ?? `${item.title} CFR ${item.identifier}`,
        fullTitle: `${status} ${date}: ${item.name ?? `${item.title} CFR ${item.identifier}`}`,
        url,
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
