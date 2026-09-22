/**
 * Sources as data, not hardcoded logic. Reliability status is what was
 * actually tested against the live sites, not what the docs promise — the
 * fetch layer skips anything marked `blocked` and records every attempt.
 */

export type ReliabilityStatus = "working" | "blocked" | "unstable" | "untested";
export type SourceParser =
  | "kemendag"
  | "peraturan-go-id"
  | "kemenkeu-home"
  | "bsn-pesta"
  | "oss-kbli-versions-json"
  | "setneg-json"
  | "pasal-laws-json"
  | "klh-json"
  | "kemnaker"
  | "djbc-home"
  | "djp-list"
  | "surabaya-regulations-json"
  | "surabaya-dlh-json"
  | "federal-register-json"
  | "ecfr-versions-json"
  | "cpsc-recalls-json"
  | "usitc-hts-release"
  | "usitc-hts-search"
  | "cbp-cross-json"
  | "ustr-301-json"
  | "usitc-ids-json"
  | "dataset-snapshot-json"
  | "uflpa-html"
  | "cbp-wro-csv"
  | "rss"
  | "dated-link-list"
  | "nc-register"
  | "nc-air-notices"
  | "texas-register"
  | "heartbeat-html"
  | "generic-regulation";

export type UsProfileGate =
  /**
   * Genuinely export-only: EAR/CCL, AES/EEI filing, ITAR. A company that only
   * imports never files these.
   */
  | "export"
  /**
   * Cross-border either way — Section 301/232, AD/CVD, UFLPA, forced labour,
   * CBP operations, 19 CFR customs duties, sanctions screening.
   *
   * Split out from `export` because conflating the two made a domestic
   * manufacturer importing Chinese inputs invisible to Section 301 and AD/CVD,
   * which is where that company's money actually moves. Importing is not
   * exporting, and neither is "not domestic".
   */
  | "trade"
  | "consumer-product"
  | "food-drug"
  | "electronics"
  | "transport"
  | "defense";

export interface SourceActivation {
  /** Optional profile capability that must be present before polling. */
  profileGate?: UsProfileGate;
  /** State whose register or agency surface this source covers. */
  state?: "North Carolina" | "California" | "New York" | "Texas";
  /** Whether the state must contain a facility, a distribution lane, or either. */
  stateScope?: "facility" | "distribution" | "either";
  /** Location-specific source, matched conservatively against facility text. */
  facilityTerms?: string[];
  /** Generic location match for country packs outside the US state model. */
  locationTerms?: string[];
}

export interface SourceSelectionProfile {
  facilityAddresses: string[];
  products: string[];
  distributionStates: string[];
  labelsClaims: string[];
  htsScheduleBCodes: Array<{ code: string }>;
  exportClassifications: Array<{ code: string }>;
  exportCountries: string[];
  regulatedProductFlags: string[];
  /**
   * domestic | import | export | both.
   *
   * Previously stored on the customer profile, rendered into prompts as a
   * string, and attached to no behaviour at all. It now decides whether the
   * cross-border source packs are polled, so a purely domestic manufacturer is
   * a first-class customer rather than an exporter with missing facts.
   */
  sideOfTrade?: string | null;
}

export interface SourceSelection {
  sources: SourceDefinition[];
  coverageCaveats: string[];
}

export interface SourceSelectionOptions {
  /** Inclusive lower bound for incremental eCFR queries. */
  lastCompletedAt?: string | null;
  /** Injectable clock for deterministic selection tests. */
  now?: Date;
  /** Customer/facility locations used to activate regional source adapters. */
  locations?: string[];
}

export interface SourceDefinition {
  id: string;
  country: string;
  name: string;
  domain: string;
  /** The URL actually fetched (already carries its query string). */
  url: string;
  regulationType:
    | "trade"
    | "tax"
    | "national"
    | "regional"
    | "standards"
    | "customs"
    | "licensing";
  reliabilityStatus: ReliabilityStatus;
  parser?: SourceParser;
  timeoutMs?: number;
  /** Retry transient transport/server failures; parse failures are never retried or hidden. */
  maxAttempts?: number;
  /** Rolling discovery window for sources whose endpoint returns a full archive. */
  lookbackDays?: number;
  /** Computed per selection from lookbackDays; parser-facing, not persisted. */
  windowStart?: string;
  /**
   * This source proves a portal is reachable; it does not publish regulations
   * we can judge. Its entries are reported as source health, never merged into
   * the regulation list — a liveness ping is not a rule.
   */
  heartbeat?: boolean;
  /** Listing view key, used to weight relevance during judgment. */
  view?: string;
  rawFilename?: string;
  notes?: string;
  activation?: SourceActivation;
  /** Narrow per-source override for official sites that reject browser impersonation. */
  requestHeaders?: Record<string, string>;
  /**
   * Name of an environment variable holding this source's credential. The
   * variable name lives here; the secret itself never does — `fetch.ts` reads
   * `process.env` at request time. A source whose variable is unset is
   * deactivated by `sourceIsActive()` and disclosed as a coverage gap, because
   * an unconfigured source is unchecked, not quiet.
   */
  requiresEnv?: string;
  /** Optional request metadata for official JSON APIs that require POST. */
  requestMethod?: "GET" | "POST";
  requestBody?: string;
  /** Normalized customer codes that caused this source instance to be selected. */
  profileCodes?: string[];
  /** A zero-row result is valid only when this marker is present in the body. */
  emptyStateMarker?: string;
  /** If this marker is present, zero rows are a parser warning instead. */
  emptyStateDisqualifier?: string;
}

const LISTING_URL = "https://jdih.kemendag.go.id/peraturan";

/**
 * Fields the Federal Register API returns only when asked.
 *
 * Documented at federalregister.gov/developers/documentation/api/v1. Without
 * `fields[]` the API answers with a short default set that carries **no
 * dates**, so the parser read `undefined` for `effective_on` every run and
 * every US alert had to disclose that effective dates were unverified. Asking
 * for them costs nothing and removes the caveat.
 *
 * `raw_text_url` matters just as much: it is the same document as ~7KB of
 * plain text, where the HTML page is ~100KB and intermittently 302s to
 * unblock.federalregister.gov when fetched by a bot.
 */
const FR_FIELDS = [
  "document_number",
  "title",
  "type",
  "action",
  "abstract",
  "dates",
  "effective_on",
  "comments_close_on",
  "publication_date",
  "citation",
  "agencies",
  "html_url",
  "raw_text_url",
];

function federalRegister(agencies: string[], view: string): string {
  const params = new URLSearchParams({
    per_page: view === "us-export" ? "10" : "8",
    order: "newest",
  });
  for (const agency of agencies) params.append("conditions[agencies][]", agency);
  params.append("conditions[type][]", "RULE");
  params.append("conditions[type][]", "PRORULE");
  if (view === "us-export") params.append("conditions[type][]", "NOTICE");
  for (const field of FR_FIELDS) params.append("fields[]", field);
  return `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
}

function targetedFederalRegister(agencies: string[], term: string): string {
  const params = new URLSearchParams({
    per_page: "100",
    order: "newest",
    "conditions[term]": term,
  });
  for (const agency of agencies) params.append("conditions[agencies][]", agency);
  for (const type of ["RULE", "PRORULE", "NOTICE", "PRESDOCU"]) {
    params.append("conditions[type][]", type);
  }
  for (const field of FR_FIELDS) params.append("fields[]", field);
  return `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
}

const CROSS_PROFILE_CODE_LIMIT = 10;

function normalizedHts6Codes(profile?: SourceSelectionProfile | null): string[] {
  return [
    ...new Set(
      (profile?.htsScheduleBCodes ?? [])
        .map(({ code }) => code.replace(/\D/g, ""))
        .filter((code) => code.length >= 6)
        .map((code) => code.slice(0, 6)),
    ),
  ].slice(0, CROSS_PROFILE_CODE_LIMIT);
}

function crossSources(profile?: SourceSelectionProfile | null): SourceDefinition[] {
  return normalizedHts6Codes(profile).map((code) => {
    const term = `${code.slice(0, 4)}.${code.slice(4)}`;
    const params = new URLSearchParams({
      term,
      collection: "ALL",
      pageSize: "100",
      page: "1",
      sortBy: "DATE_DESC",
    });
    return {
      id: `us-cbp-cross-${code}`,
      country: "United States",
      name: `CBP CROSS rulings - HTS ${term}`,
      domain: "rulings.cbp.gov",
      url: `https://rulings.cbp.gov/api/search?${params.toString()}`,
      regulationType: "customs",
      reliabilityStatus: "working",
      parser: "cbp-cross-json",
      view: "us-cbp-cross",
      rawFilename: `us-cbp-cross-${code}.json`,
      timeoutMs: 30_000,
      profileCodes: [code],
      emptyStateMarker: '"totalHits":',
      notes:
        "Official CBP CROSS application API search scoped to one recorded HTS-6 code; rulings are research evidence, not a binding classification for another product.",
    };
  });
}

function htsSearchSources(profile?: SourceSelectionProfile | null): SourceDefinition[] {
  return normalizedHts6Codes(profile).map((code) => {
    const term = `${code.slice(0, 4)}.${code.slice(4)}`;
    return {
      id: `us-usitc-hts-${code}`,
      country: "United States",
      name: `USITC HTS tariff data - ${term}`,
      domain: "hts.usitc.gov",
      url: `https://hts.usitc.gov/reststop/search?${new URLSearchParams({ keyword: term }).toString()}`,
      regulationType: "customs",
      reliabilityStatus: "working",
      parser: "usitc-hts-search",
      view: "us-hts-code",
      rawFilename: `us-usitc-hts-${code}.json`,
      timeoutMs: 30_000,
      profileCodes: [code],
      emptyStateMarker: "[]",
      notes:
        "Official no-key HTS search scoped to one recorded HTS-6 code. Rates and descriptions are monitored as declared-code data, not generated legal classification advice.",
    } satisfies SourceDefinition;
  });
}

/** A first run starts near today; it is a monitor bootstrap, not a historical audit. */
const ECFR_BOOTSTRAP_LOOKBACK_DAYS = 7;

/**
 * eCFR amendments for a title, windowed from the last completed check.
 *
 * The unfiltered endpoint returns the *oldest* 1,000 section versions — for
 * Title 29 that is a 268KB page beginning in 2017, from which the parser could
 * only ever surface years-old sections and call them changes. The documented
 * `issue_date[gte]` parameter turns the same call into "what changed since the
 * monitor last completed". The boundary is inclusive because the API has day,
 * not timestamp, precision; versioned entry identities remove the overlap.
 */
function ecfrTitle(title: number, since = ecfrWindowStart()): string {
  const params = new URLSearchParams({ "issue_date[gte]": since });
  return `https://www.ecfr.gov/api/versioner/v1/versions/title-${title}.json?${params.toString()}`;
}

function ecfrWindowStart(options: SourceSelectionOptions = {}): string {
  if (options.lastCompletedAt) {
    const completed = new Date(options.lastCompletedAt);
    if (!Number.isNaN(completed.getTime())) return completed.toISOString().slice(0, 10);
  }

  const since = new Date(options.now ?? new Date());
  since.setUTCDate(since.getUTCDate() - ECFR_BOOTSTRAP_LOOKBACK_DAYS);
  return since.toISOString().slice(0, 10);
}

function cpscRecentRecalls(): string {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 45);
  return `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${start
    .toISOString()
    .slice(0, 10)}`;
}

function currentCaliforniaRegisterMonth(): string {
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase();
  return `https://oal.ca.gov/${month}-${now.getUTCFullYear()}-california-regulatory-notice-registers/`;
}

// Server-side UUIDs read off the live search form's <select> options — not
// slugs. Re-check these if the Kemendag site changes.
const TEMATIK_EKSPOR = "454156ac-1b95-41a5-a0a8-6da456b380a4";
const TEMATIK_PERIZINAN = "2e7f28be-17f0-401b-8dd6-50a169e94c63";

function listing(params: Record<string, string>): string {
  return `${LISTING_URL}?${new URLSearchParams(params).toString()}`;
}

export const SOURCE_REGISTRY: SourceDefinition[] = [
  {
    id: "kemendag-semua",
    country: "Indonesia",
    name: "JDIH Kemendag — Semua Peraturan (terbaru)",
    domain: "jdih.kemendag.go.id",
    url: listing({ status: "Berlaku", order: "terbaru" }),
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "kemendag",
    view: "semua",
    rawFilename: "kemendag-peraturan.html",
    notes:
      "Dominated by Harga Patokan Ekspor commodity-price decrees (mining, palm, " +
      "agriculture, forestry) that never cover PVC tarpaulin. Volume here is not signal.",
  },
  {
    id: "kemendag-ekspor",
    country: "Indonesia",
    name: "JDIH Kemendag — Tematik: Ekspor",
    domain: "jdih.kemendag.go.id",
    url: listing({ tematik: TEMATIK_EKSPOR, status: "Berlaku", order: "terbaru" }),
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "kemendag",
    view: "ekspor",
    rawFilename: "kemendag-ekspor.html",
    notes:
      "Export-policy-tagged by Kemendag itself. Surfaces the 'Kebijakan dan " +
      "Pengaturan Ekspor' Permendag rules that never appear in the unfiltered top 10.",
  },
  {
    id: "kemendag-perizinan",
    country: "Indonesia",
    name: "JDIH Kemendag — Tematik: Perizinan",
    domain: "jdih.kemendag.go.id",
    url: listing({ tematik: TEMATIK_PERIZINAN, status: "Berlaku", order: "terbaru" }),
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "kemendag",
    view: "perizinan",
    rawFilename: "kemendag-perizinan.html",
    notes: "Mostly historical — newest entries are from 2022. Reference, rarely a source of change.",
  },
  {
    id: "bpk-peraturan",
    country: "Indonesia",
    name: "JDIH BPK — Peraturan",
    domain: "peraturan.bpk.go.id",
    url: "https://peraturan.bpk.go.id/",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "generic-regulation",
    notes:
      "Confirmed bot detection. Deepest searchable archive of Indonesian law, so it " +
      "stays useful for occasional manual lookups — but never automated fetching.",
  },
  {
    id: "peraturan-go-id",
    country: "Indonesia",
    name: "peraturan.go.id — national feed",
    domain: "peraturan.go.id",
    url: "https://peraturan.go.id/",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "peraturan-go-id",
    view: "national-home",
    rawFilename: "peraturan-go-id-home.html",
    timeoutMs: 12_000,
    notes: "Unreachable from the monitor; replaced for UU/Perpu/PP/Perpres/Keppres/Inpres by JDIH Setneg JSON.",
  },
  {
    id: "peraturan-go-id-uu",
    country: "Indonesia",
    name: "peraturan.go.id — Undang-Undang",
    domain: "peraturan.go.id",
    url: "https://peraturan.go.id/uu",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "peraturan-go-id",
    view: "uu",
    rawFilename: "peraturan-go-id-uu.html",
    timeoutMs: 12_000,
    notes: "National law feed. Monitor attempt is recorded even when the site times out.",
  },
  {
    id: "peraturan-go-id-pp",
    country: "Indonesia",
    name: "peraturan.go.id — Peraturan Pemerintah",
    domain: "peraturan.go.id",
    url: "https://peraturan.go.id/pp",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "peraturan-go-id",
    view: "pp",
    rawFilename: "peraturan-go-id-pp.html",
    timeoutMs: 12_000,
    notes: "Government regulation feed. Monitor attempt is recorded even when the site times out.",
  },
  {
    id: "peraturan-go-id-perpres",
    country: "Indonesia",
    name: "peraturan.go.id — Peraturan Presiden",
    domain: "peraturan.go.id",
    url: "https://peraturan.go.id/perpres",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "peraturan-go-id",
    view: "perpres",
    rawFilename: "peraturan-go-id-perpres.html",
    timeoutMs: 12_000,
    notes: "Perpres/Kepres-class monitoring surface. Monitor attempt is recorded even when the site times out.",
  },
  {
    id: "peraturan-go-id-permen",
    country: "Indonesia",
    name: "peraturan.go.id — Peraturan Menteri",
    domain: "peraturan.go.id",
    url: "https://peraturan.go.id/permen",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "peraturan-go-id",
    view: "permen",
    rawFilename: "peraturan-go-id-permen.html",
    timeoutMs: 12_000,
    notes: "Ministerial regulation feed across ministries. Monitor attempt is recorded even when the site times out.",
  },
  {
    id: "jdihn",
    country: "Indonesia",
    name: "JDIHN — national legal database network",
    domain: "jdihn.go.id",
    url: "https://jdihn.go.id/",
    regulationType: "national",
    reliabilityStatus: "blocked",
    parser: "generic-regulation",
    view: "jdihn",
    rawFilename: "jdihn.html",
    timeoutMs: 12_000,
    notes: "Production portal times out and the development portal has no working DNS; member integration feeds are decentralized rather than a public central read API.",
  },
  {
    // The only route to the ministry responsible for industrial policy. Both
    // official records for Kemenperin regulations are unreachable — its JDIH
    // has been dark since Feb 2024 and peraturan.go.id, which pasal.id names as
    // its own upstream, is equally dead. This is a private re-publisher standing
    // in for a government record that nobody can currently fetch, and every
    // layer below is built to keep that distinction visible rather than to
    // quietly restore the appearance of coverage.
    id: "kemenperin-pasal",
    country: "Indonesia",
    name: "pasal.id (penerbit ulang swasta) — Permen Kemenperin",
    domain: "pasal.id",
    // year is rewritten per run by refreshDynamicUrl; limit 50 is the API max
    // and current Kemenperin volume is ~23/year, so one page holds the year.
    url: "https://pasal.id/api/v1/laws?type=PERMEN&issuing_body=permenperin&limit=50&year=2026",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "pasal-laws-json",
    view: "kemenperin-permen",
    rawFilename: "kemenperin-pasal.json",
    maxAttempts: 2,
    requestHeaders: { Accept: "application/json" },
    requiresEnv: "PASAL_API_TOKEN",
    // The feed has no date field, so it cannot be windowed by date and the whole
    // current year is fetched each run. New rows are found by the
    // source_documents fingerprint ledger, not by ordering — the API returns
    // rows in no chronological order, so "read page 1 for what's new" would
    // silently miss things.
    notes:
      "Private re-publisher, verified 18 Aug 2026: 23 Permenperin rows for 2026, every one carrying verification tier 'parsed_unreviewed' and content_verified false — the publisher's own statement that nobody reviewed the parse. " +
      "type=PERMEN alone is not a Kemenperin filter (an unrelated Keputusan KPU came back under it), so issuing_body=permenperin is load-bearing and the parser drops rows from any other issuer. " +
      "No date field exists anywhere in this API, including detail responses, so effectiveOn stays null and recency is never asserted. " +
      "Relationship edges are empty for these rows despite titles like 'Perubahan Atas …', so lifecycle links come from lib/checks/lifecycle.ts reading the title, not from the publisher.",
  },
  {
    id: "kemenkeu-jdih",
    country: "Indonesia",
    name: "JDIH Kemenkeu — customs, duty and tariff (PMK)",
    domain: "jdih.kemenkeu.go.id",
    url: "https://jdih.kemenkeu.go.id/home",
    regulationType: "customs",
    reliabilityStatus: "working",
    parser: "kemenkeu-home",
    view: "kemenkeu-home",
    rawFilename: "kemenkeu-home.html",
    timeoutMs: 15_000,
    notes: "Homepage exposes current PMK links, including Bea Cukai, duty, tariff, and tax-administration changes.",
  },
  {
    id: "bsn-pesta-produk",
    country: "Indonesia",
    name: "BSN PESTA — SNI products",
    domain: "pesta.bsn.go.id",
    url: "https://pesta.bsn.go.id/produk",
    regulationType: "standards",
    reliabilityStatus: "working",
    parser: "bsn-pesta",
    view: "sni-products",
    rawFilename: "bsn-pesta-produk.html",
    timeoutMs: 15_000,
    maxAttempts: 2,
    notes:
      "Live-tested server-rendered SNI catalogue; one retry absorbs transient transport/server failures. " +
      "Product-specific mandatory status still needs detail/source validation.",
  },
  {
    id: "oss-kbli",
    country: "Indonesia",
    name: "OSS — KBLI catalogue versions API",
    domain: "gw.oss.go.id",
    url: "https://gw.oss.go.id/v2/portal/kbli/version?lang=id",
    regulationType: "licensing",
    reliabilityStatus: "working",
    parser: "oss-kbli-versions-json",
    view: "oss-kbli",
    rawFilename: "oss-kbli-versions.json",
    timeoutMs: 12_000,
    heartbeat: true,
    requestHeaders: { Accept: "application/json" },
    notes:
      "No-auth JSON gateway used by the official OSS KBLI frontend. It proves catalogue " +
      "availability and reports published KBLI versions, but is not a documented licensing-status API. " +
      "Specific obligation mapping still depends on confirmed KBLI codes.",
  },
  {
    id: "setneg-national",
    country: "Indonesia",
    name: "JDIH Setneg — UU, Perpu, PP, Perpres, Keppres and Inpres",
    domain: "jdih.setneg.go.id",
    url: "https://jdih.setneg.go.id/api/hukumproduk/produkhukum",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "setneg-json",
    view: "setneg-national",
    rawFilename: "setneg-national.json",
    timeoutMs: 45_000,
    requestHeaders: { Accept: "application/json", "Content-Type": "application/json" },
    notes:
      "No-auth frontend JSON API. Polls every page for the current and prior year across UU, Perpu, PP, Perpres, Keppres, and Inpres; it does not cover nationwide Permen/Kepmen.",
  },
  {
    id: "klh-regulations",
    country: "Indonesia",
    name: "JDIH KLH/BPLH — environmental regulations",
    domain: "jdih.kemenlh.go.id",
    url: "https://jdih.kemenlh.go.id/admin/api/dokumen-hukum/terbaru?limit=30",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "klh-json",
    view: "environment",
    rawFilename: "klh-regulations.json",
    timeoutMs: 20_000,
    maxAttempts: 2,
    requestHeaders: { Accept: "application/json" },
    notes:
      "Official no-auth JSON carrying stable IDs, upload/update timestamps, legal dates, status, and full-text PDFs. Upload time is not treated as enactment time.",
  },
  {
    id: "kemnaker-regulations",
    country: "Indonesia",
    name: "JDIH Kemnaker — labor and occupational safety rules",
    domain: "jdih.kemnaker.go.id",
    url: "https://jdih.kemnaker.go.id/peraturan?sort=terbaru",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "kemnaker",
    view: "labor-safety",
    rawFilename: "kemnaker-regulations.html",
    timeoutMs: 20_000,
    maxAttempts: 2,
    notes: "Official newest-upload listing. List order is upload chronology, never evidence of legal recency.",
  },
  {
    id: "djbc-regulations",
    country: "Indonesia",
    name: "DJBC — customs and excise regulation directory",
    domain: "peraturan.beacukai.go.id",
    url: "https://peraturan.beacukai.go.id/",
    regulationType: "customs",
    reliabilityStatus: "working",
    parser: "djbc-home",
    view: "customs",
    rawFilename: "djbc-regulations.html",
    timeoutMs: 20_000,
    maxAttempts: 2,
    notes:
      "Official newly-added directory spanning PMK, KMK, DJBC, Kemendag and Kemenperin instruments. The site says its archive is incomplete, so it supplements rather than replaces issuer JDIHs.",
  },
  {
    id: "djp-regulations",
    country: "Indonesia",
    name: "DJP — tax regulation directory",
    domain: "www.pajak.go.id",
    url: "https://www.pajak.go.id/id/peraturan",
    regulationType: "tax",
    reliabilityStatus: "working",
    parser: "djp-list",
    view: "tax",
    rawFilename: "djp-regulations.html",
    timeoutMs: 20_000,
    maxAttempts: 2,
    notes: "Official tax directory carrying number, subject, issuer/type, legal date, status, and detail URL.",
  },
  {
    id: "surabaya-regulations",
    country: "Indonesia",
    name: "JDIH Surabaya — Perda, Perwali, Kepwali and local rules",
    domain: "jdih.surabaya.go.id",
    url: "https://jdih.surabaya.go.id/peraturan/ajax",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "surabaya-regulations-json",
    view: "surabaya-regional",
    rawFilename: "surabaya-regulations.json",
    timeoutMs: 30_000,
    maxAttempts: 2,
    requestHeaders: { Accept: "application/json" },
    activation: { locationTerms: ["Surabaya"] },
    notes:
      "Official no-auth JSON. Polls every page for the current and prior year; detail pages and stable download routes provide promulgation metadata and full text.",
  },
  {
    id: "surabaya-dlh-notices",
    country: "Indonesia",
    name: "DLH Surabaya — AMDAL, UKL-UPL, DELH and DPLH notices",
    domain: "lh.surabaya.go.id",
    url: "https://lh.surabaya.go.id/weblh/data-pengumuman-dokumen",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "surabaya-dlh-json",
    view: "surabaya-environment",
    rawFilename: "surabaya-dlh-notices.json",
    timeoutMs: 20_000,
    maxAttempts: 2,
    lookbackDays: 45,
    requestHeaders: { Accept: "application/json" },
    activation: { locationTerms: ["Surabaya"] },
    notes:
      "Official environmental-document notice feed. These are facility/project notices, not generally applicable regulations.",
  },
  {
    id: "east-java-regulations",
    country: "Indonesia",
    name: "JDIH East Java — provincial rules",
    domain: "jdih.jatimprov.go.id",
    url: "https://jdih.jatimprov.go.id/peraturan-terbaru",
    regulationType: "regional",
    reliabilityStatus: "blocked",
    parser: "generic-regulation",
    view: "east-java-regional",
    activation: { locationTerms: ["East Java", "Jawa Timur", "Surabaya"] },
    notes:
      "Official catalogue works interactively but Cloudflare blocks unattended fetches, confirmed 17 Aug 2026 (HTTP 403, Cloudflare challenge page) from a plain fetch matching production headers. " +
      "Superseded for daily polling by the api.jdih.jatimprov.go.id rows below, which serve the same JDIH Jatim content unblocked; kept here, still blocked, as the documented reason this host is not retried directly.",
  },
  {
    id: "east-java-perda",
    country: "Indonesia",
    name: "JDIH East Java (api) — Peraturan Daerah",
    domain: "api.jdih.jatimprov.go.id",
    url: "https://api.jdih.jatimprov.go.id/peraturan-daerah",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "generic-regulation",
    view: "east-java-perda",
    rawFilename: "east-java-perda.html",
    maxAttempts: 2,
    activation: { locationTerms: ["East Java", "Jawa Timur", "Surabaya"] },
    notes:
      "Discovered 17 Aug 2026: same JDIH Jatim CMS as the Cloudflare-blocked main domain, served from this subdomain without the challenge. Live probe returned HTTP 200 and parsed real current entries.",
  },
  {
    id: "east-java-pergub",
    country: "Indonesia",
    name: "JDIH East Java (api) — Peraturan Gubernur",
    domain: "api.jdih.jatimprov.go.id",
    url: "https://api.jdih.jatimprov.go.id/peraturan-gubernur",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "generic-regulation",
    view: "east-java-pergub",
    rawFilename: "east-java-pergub.html",
    maxAttempts: 2,
    activation: { locationTerms: ["East Java", "Jawa Timur", "Surabaya"] },
  },
  {
    id: "east-java-kepgub",
    country: "Indonesia",
    name: "JDIH East Java (api) — Keputusan Gubernur",
    domain: "api.jdih.jatimprov.go.id",
    url: "https://api.jdih.jatimprov.go.id/keputusan-gubernur",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "generic-regulation",
    view: "east-java-kepgub",
    rawFilename: "east-java-kepgub.html",
    maxAttempts: 2,
    activation: { locationTerms: ["East Java", "Jawa Timur", "Surabaya"] },
    notes:
      "Live probe parsed 7 anchors, 6 genuine Kepgub entries and 1 false positive (a news article whose headline happened to cite a Perda number, e.g. 'Mahasiswa Magang ... Perda Jatim Nomor 4 Tahun 2022'). " +
      "looksLikeRegulation() matches link text only, so a news item citing a regulation by number/year is indistinguishable from the regulation itself; judgment must be able to discard it as off-topic rather than the parser silently dropping true entries.",
  },
  {
    id: "east-java-instruksi",
    country: "Indonesia",
    name: "JDIH East Java (api) — Instruksi Gubernur",
    domain: "api.jdih.jatimprov.go.id",
    url: "https://api.jdih.jatimprov.go.id/instruksi-gubernur",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "generic-regulation",
    view: "east-java-instruksi",
    rawFilename: "east-java-instruksi.html",
    maxAttempts: 2,
    activation: { locationTerms: ["East Java", "Jawa Timur", "Surabaya"] },
    notes:
      "Surat Edaran (circulars) were checked at the equivalent /surat-edaran slug and do not exist on this host (404) — that gap remains manual-assisted.",
  },
  ...[
    ["epa", "EPA", ["environmental-protection-agency"], "national", undefined],
    ["osha", "OSHA", ["occupational-safety-and-health-administration"], "national", undefined],
    ["ftc", "FTC", ["federal-trade-commission"], "standards", undefined],
    ["cpsc", "CPSC", ["consumer-product-safety-commission"], "standards", "consumer-product"],
    ["fda", "FDA", ["food-and-drug-administration"], "standards", "food-drug"],
    [
      "usda",
      "USDA product agencies",
      ["food-safety-and-inspection-service", "animal-and-plant-health-inspection-service"],
      "standards",
      "food-drug",
    ],
    ["fcc", "FCC", ["federal-communications-commission"], "standards", "electronics"],
    [
      "dot",
      "DOT and NHTSA",
      ["transportation-department", "national-highway-traffic-safety-administration"],
      "national",
      "transport",
    ],
    /*
     * IRS, ungated.
     *
     * The US pack monitored thirteen agencies and no tax authority at all,
     * while the Indonesian pack has watched DJP, DJBC and Kemenkeu from the
     * start. Ungated because federal tax reaches any company with US
     * operations — the same reasoning that leaves EPA and OSHA ungated — and
     * because the volume is small: a live probe on 16 Aug 2026 found RULE and
     * PRORULE documents arriving at roughly one a week.
     *
     * Note what this feed is NOT. The US cannot tax exports at all
     * (Constitution, Art. I §9 cl. 5), so there is no export-duty regime here
     * to watch. What matters to an exporter is on the customs side — drawback,
     * entry, valuation, origin — which is why 19 CFR was added alongside this
     * and is the more important of the two.
     */
    ["irs", "IRS", ["internal-revenue-service"], "tax", undefined],
  ].map(([id, label, agencies, regulationType, profileGate]) => ({
    id: `us-fr-${id}`,
    country: "United States",
    name: `Federal Register - ${label}`,
    domain: "www.federalregister.gov",
    url: federalRegister(agencies as string[], "us-manufacturing"),
    regulationType: regulationType as SourceDefinition["regulationType"],
    reliabilityStatus: "working" as const,
    parser: "federal-register-json" as const,
    view: `us-fr-${id}`,
    rawFilename: `us-federal-register-${id}.json`,
    activation: profileGate ? { profileGate: profileGate as UsProfileGate } : undefined,
    notes: `Official no-key Federal Register API scoped to ${label}; rules and proposals are kept distinct during judgment.`,
  })),
  ...[
    // BIS/EAR and Census/AES are filings only an exporter makes. OFAC and CBP
    // reach any cross-border movement, so an importer needs them too.
    ["bis", "BIS / EAR", ["industry-and-security-bureau"], "export"],
    ["census", "Census / FTR", ["census-bureau"], "export"],
    ["ofac", "OFAC", ["foreign-assets-control-office"], "trade"],
    ["cbp", "CBP", ["u-s-customs-and-border-protection"], "trade"],
  ].map(([id, label, agencies, gate]) => ({
    id: `us-fr-export-${id}`,
    country: "United States",
    name: `Federal Register - ${label}`,
    domain: "www.federalregister.gov",
    url: federalRegister(agencies as string[], "us-export"),
    regulationType: "trade" as const,
    reliabilityStatus: "working" as const,
    parser: "federal-register-json" as const,
    view: `us-export-${id}`,
    rawFilename: `us-federal-register-export-${id}.json`,
    activation: { profileGate: gate as UsProfileGate },
    notes: `Official no-key Federal Register API scoped to ${label} export changes.`,
  })),
  {
    id: "us-fr-export-ddtc",
    country: "United States",
    name: "Federal Register - State Department / DDTC",
    domain: "www.federalregister.gov",
    url: federalRegister(["state-department"], "us-export"),
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "federal-register-json",
    view: "us-export-ddtc",
    rawFilename: "us-federal-register-export-ddtc.json",
    activation: { profileGate: "defense" },
    notes: "State Department notices are activated only when the profile records a defense, military, space, or ITAR signal.",
  },
  {
    id: "us-usitc-hts-release",
    country: "United States",
    name: "USITC - current HTS release",
    domain: "hts.usitc.gov",
    url: "https://hts.usitc.gov/reststop/currentRelease",
    regulationType: "customs",
    reliabilityStatus: "working",
    parser: "usitc-hts-release",
    view: "us-hts-release",
    rawFilename: "us-usitc-hts-release.json",
    notes:
      "Official no-key HTS API release marker. A changed release triggers retrieval and comparison by the HTS adapter; it is not classification advice by itself.",
  },
  {
    id: "us-cbp-csms",
    country: "United States",
    name: "CBP - Cargo Systems Messaging Service",
    domain: "content.govdelivery.com",
    url: "https://content.govdelivery.com/accounts/USDHSCBP/widgets/USDHSCBP_WIDGET_2.rss",
    regulationType: "customs",
    reliabilityStatus: "working",
    parser: "rss",
    view: "us-cbp-csms",
    rawFilename: "us-cbp-csms.xml",
    timeoutMs: 30_000,
    activation: { profileGate: "trade" },
    notes:
      "Official rolling feed of the latest 100 CSMS bulletins. Polling gaps can lose messages and must remain visible as a coverage caveat.",
  },
  ...[
    ["section-301", "USTR Section 301 actions", ["trade-representative-office-of-united-states"], "Section 301"],
    ["section-232-bis", "BIS Section 232 actions", ["industry-and-security-bureau"], "Section 232"],
    ["section-232-ita", "ITA Section 232 administration", ["international-trade-administration"], "Section 232"],
    ["commerce-adcvd", "Commerce AD/CVD actions", ["international-trade-administration"], "antidumping countervailing duty"],
    ["usitc-import-injury", "USITC import-injury actions", ["international-trade-commission"], "import injury"],
    ["uflpa", "DHS UFLPA Entity List actions", ["homeland-security-department"], "UFLPA Entity List"],
  ].map(([id, label, agencies, term]) => ({
    id: `us-fr-${id}`,
    country: "United States",
    name: `Federal Register - ${label}`,
    domain: "www.federalregister.gov",
    url: targetedFederalRegister(agencies as string[], term as string),
    regulationType: "trade" as const,
    reliabilityStatus: "working" as const,
    parser: "federal-register-json" as const,
    view: `us-trade-${id}`,
    rawFilename: `us-federal-register-${id}.json`,
    timeoutMs: 30_000,
    // Section 301/232, AD/CVD, import injury and UFLPA are all import-side.
    activation: { profileGate: "trade" as const },
    notes: `Official no-key Federal Register query targeted to ${label}; event coverage complements, but does not replace, complete inventories.`,
  })),
  {
    id: "us-usitc-ids-import-injury",
    country: "United States",
    name: "USITC IDS - import-injury investigations",
    domain: "ids.usitc.gov",
    url: "https://ids.usitc.gov/idata/api/v1/advanced-search",
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "usitc-ids-json",
    view: "us-usitc-import-injury",
    rawFilename: "us-usitc-ids-import-injury.json",
    timeoutMs: 60_000,
    requestMethod: "POST",
    requestBody: JSON.stringify({
      pageNumber: 1,
      pageSize: 100,
      sortColumn: "institution_start_date",
      sortOrder: "desc",
      criteria: [
        {
          field: { id: 49, name: "investigation_type_id" },
          lines: [{ value: "Import Injury", innerOperator: "is" }],
        },
      ],
      search_type: "advanced",
    }),
    requestHeaders: { "Content-Type": "application/json" },
    activation: { profileGate: "trade" },
    notes:
      "Official USITC no-key investigation search. The adapter must exhaust pagination and fail visibly on implementation-level schema drift.",
  },
  {
    id: "us-ustr-section-301-hts",
    country: "United States",
    name: "USTR - Section 301 HTS product overlay",
    domain: "ustr.gov",
    url: "https://ustr.gov/themes/custom/ustr2021/tariff/hts_new.json",
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "ustr-301-json",
    view: "us-ustr-section-301",
    rawFilename: "us-ustr-section-301-hts.json",
    timeoutMs: 45_000,
    activation: { profileGate: "trade" },
    emptyStateMarker: '"HTS_id"',
    notes:
      "Official USTR product-search dataset used as a secondary HTS overlay. Federal Register notices and HTS releases remain the legal change signals.",
  },
  {
    id: "us-trade-csl",
    country: "United States",
    name: "Trade.gov - Consolidated Screening List snapshot",
    domain: "data.trade.gov",
    url: "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json",
    regulationType: "licensing",
    reliabilityStatus: "working",
    parser: "dataset-snapshot-json",
    view: "us-screening-list-snapshot",
    rawFilename: "us-trade-csl.json",
    timeoutMs: 90_000,
    activation: { profileGate: "trade" },
    notes:
      "Official keyless CSL bulk snapshot for change detection and local party matching. A no-hit result does not establish ownership, end-use, or license clearance.",
  },
  {
    id: "us-cbp-forced-labor",
    country: "United States",
    name: "CBP - forced-labor announcements",
    domain: "www.cbp.gov",
    url: "https://www.cbp.gov/rss/trade/forced-labor",
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "rss",
    view: "us-forced-labor-announcements",
    rawFilename: "us-cbp-forced-labor.xml",
    activation: { profileGate: "trade" },
    notes:
      "Official announcement overlay with a small rolling feed; it is not the authoritative UFLPA or WRO inventory.",
  },
  {
    id: "us-dhs-uflpa-entities",
    country: "United States",
    name: "DHS - UFLPA Entity List snapshot",
    domain: "www.dhs.gov",
    url: "https://www.dhs.gov/uflpa-entity-list",
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "uflpa-html",
    view: "us-uflpa-entity-snapshot",
    rawFilename: "us-dhs-uflpa-entities.html",
    timeoutMs: 45_000,
    activation: { profileGate: "trade" },
    notes:
      "Official current UFLPA statutory-list tables. Entity identity retains statutory sublist membership because one entity can appear in multiple tables.",
  },
  {
    id: "us-cbp-wro-findings",
    country: "United States",
    name: "CBP - Withhold Release Orders and Findings",
    domain: "www.cbp.gov",
    url: "https://www.cbp.gov/document/stats/withhold-release-orders-findings",
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "cbp-wro-csv",
    view: "us-cbp-wro-findings",
    rawFilename: "us-cbp-wro-findings.csv",
    timeoutMs: 45_000,
    activation: { profileGate: "trade" },
    notes:
      "Official discovery page for the latest complete WRO/Findings CSV. Missing records are revisions to investigate, not automatic evidence of revocation.",
  },
  ...[
    [29, "labor", "Labor and OSHA"],
    [40, "environment", "Environmental protection"],
    [16, "consumer", "Commercial practices, FTC, and CPSC"],
    [15, "commerce", "Commerce and foreign trade", "export"],
    [31, "sanctions", "Treasury and OFAC", "trade"],
    [49, "transport", "Transportation and hazmat", "transport"],
    [21, "fda", "Food and drugs", "food-drug"],
    /*
     * 19 CFR — Customs Duties. The most exporter-relevant title in the CFR and
     * the conspicuous omission from the original set: Title 31 was present, but
     * that is the sanctions title, not the customs one. This is where drawback
     * (part 190), entry, valuation and origin rules live, which is exactly what
     * an exporter's duty exposure turns on. Gated on export like Title 15.
     * Live probe 16 Aug 2026: 1 substantive change in 7 days, 3 in 30.
     */
    [19, "customs", "Customs duties, drawback, entry and valuation", "trade"],
    /*
     * 26 CFR — Internal Revenue. Ungated, matching the IRS Federal Register
     * feed. Volume was the worry and it did not materialise: 3 substantive
     * changes in 7 days and 9 in 30 on the same probe, well inside what the
     * source ledger absorbs.
     */
    [26, "tax", "Internal Revenue"],
  ].map(([title, view, label, profileGate]) => ({
    id: `us-ecfr-title-${title}`,
    country: "United States",
    name: `eCFR Title ${title} - ${label}`,
    domain: "www.ecfr.gov",
    url: ecfrTitle(Number(title)),
    regulationType: view === "commerce" || view === "sanctions" ? ("trade" as const) : ("national" as const),
    reliabilityStatus: "working" as const,
    parser: "ecfr-versions-json" as const,
    view: `ecfr-${view}`,
    rawFilename: `us-ecfr-title-${title}.json`,
    timeoutMs: 25_000,
    emptyStateMarker: '"content_versions":[]',
    activation: profileGate ? { profileGate: profileGate as UsProfileGate } : undefined,
    notes:
      "Official eCFR version history; incrementally fetches every substantive section and appendix amendment since the last completed run.",
  })),
  {
    id: "us-osha-federal-register",
    country: "United States",
    name: "OSHA - Federal Register feed",
    domain: "www.osha.gov",
    url: "https://www.osha.gov/laws-regs/federalregisters.xml",
    regulationType: "national",
    reliabilityStatus: "working",
    parser: "rss",
    view: "osha-federal-register",
    rawFilename: "us-osha-federal-register.xml",
    notes: "OSHA's official RSS feed; overlaps Federal Register intentionally as a targeted safety view.",
  },
  {
    id: "us-cpsc-recalls",
    country: "United States",
    name: "CPSC - recent product recalls",
    domain: "www.saferproducts.gov",
    url: cpscRecentRecalls(),
    regulationType: "standards",
    reliabilityStatus: "working",
    parser: "cpsc-recalls-json",
    view: "cpsc-recalls",
    rawFilename: "us-cpsc-recalls.json",
    timeoutMs: 30_000,
    activation: { profileGate: "consumer-product" },
    notes: "Official CPSC recall API limited to the prior 45 days; activated for recorded consumer-product exposure.",
  },
  {
    id: "us-ofac-list-updates",
    country: "United States",
    name: "OFAC - sanctions list updates",
    domain: "ofac.treasury.gov",
    url: "https://ofac.treasury.gov/recent-actions/sanctions-list-updates",
    regulationType: "trade",
    reliabilityStatus: "working",
    parser: "dated-link-list",
    view: "ofac-list-updates",
    rawFilename: "us-ofac-list-updates.html",
    activation: { profileGate: "trade" },
    notes: "Official OFAC list-change log. This detects list updates; it does not screen a customer's counterparties.",
  },
  {
    id: "us-nc-register",
    country: "United States",
    name: "North Carolina Register - rulemaking issues",
    domain: "www.oah.nc.gov",
    url: "https://www.oah.nc.gov/documents/north-carolina-register",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "nc-register",
    view: "nc-register",
    rawFilename: "us-nc-register.html",
    activation: { state: "North Carolina", stateScope: "either" },
    notes: "Official twice-monthly register of proposed rules, hearing notices, executive orders, and rulemaking actions.",
  },
  {
    id: "us-nc-deq-news",
    country: "United States",
    name: "North Carolina DEQ - regulatory and permit updates",
    domain: "www.deq.nc.gov",
    url: "https://www.deq.nc.gov/news/press-release",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "dated-link-list",
    view: "nc-deq-news",
    rawFilename: "us-nc-deq-news.html",
    activation: { state: "North Carolina", stateScope: "facility" },
    notes: "Official DEQ releases; judgment separates general news from permit, enforcement, PFAS, air, water, and waste changes.",
  },
  {
    id: "us-nc-air-notices",
    country: "United States",
    name: "North Carolina DEQ - air rule and permit notices",
    domain: "www.deq.nc.gov",
    url: "https://www.deq.nc.gov/about/divisions/air-quality/outreach-education-engagement/air-quality-public-information",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "nc-air-notices",
    view: "nc-air-notices",
    rawFilename: "us-nc-air-notices.html",
    activation: { state: "North Carolina", stateScope: "facility" },
    notes: "Official open comment periods for NC air permits, rule development, and enforcement actions.",
  },
  {
    id: "us-nc-labor-news",
    country: "United States",
    name: "North Carolina Labor - safety and labor updates",
    domain: "www.labor.nc.gov",
    url: "https://www.labor.nc.gov/news/press-releases",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "dated-link-list",
    view: "nc-labor-news",
    rawFilename: "us-nc-labor-news.html",
    activation: { state: "North Carolina", stateScope: "facility" },
    notes: "Official NCDOL updates; NC Register remains the authority for state-plan rulemaking.",
  },
  {
    id: "us-nc-tax-updates",
    country: "United States",
    name: "North Carolina Revenue - notices and updates",
    domain: "www.ncdor.gov",
    url: "https://www.ncdor.gov/news/notices-and-updates",
    regulationType: "tax",
    reliabilityStatus: "working",
    parser: "dated-link-list",
    view: "nc-tax-updates",
    rawFilename: "us-nc-tax-updates.html",
    activation: { state: "North Carolina", stateScope: "either" },
    notes: "Official NCDOR notices including sales/use tax and law-change guidance.",
  },
  {
    id: "us-mecklenburg-air-notices",
    country: "United States",
    name: "Mecklenburg County Air Quality - industry notices",
    domain: "airquality.mecknc.gov",
    url: "https://airquality.mecknc.gov/education-engagement/comment",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "nc-air-notices",
    view: "mecklenburg-air",
    rawFilename: "us-mecklenburg-air-notices.html",
    activation: { facilityTerms: ["Charlotte", "Mecklenburg"] },
    emptyStateMarker: "Proposed Air Quality Permits",
    emptyStateDisqualifier: "<table",
    notes: "Official local air permit comment notices, activated only for a facility address explicitly naming Charlotte or Mecklenburg County.",
  },
  {
    id: "us-ca-register",
    country: "United States",
    name: "California Regulatory Notice Register",
    domain: "oal.ca.gov",
    url: currentCaliforniaRegisterMonth(),
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "dated-link-list",
    view: "ca-register",
    rawFilename: "us-ca-register.html",
    activation: { state: "California", stateScope: "either" },
    notes: "Official weekly notices of proposed California regulatory actions; current-month issues are polled.",
  },
  {
    id: "us-ny-register",
    country: "United States",
    name: "New York State Register",
    domain: "dos.ny.gov",
    url: "https://dos.ny.gov/state-register?page=0",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "dated-link-list",
    view: "ny-register",
    rawFilename: "us-ny-register.html",
    activation: { state: "New York", stateScope: "either" },
    requestHeaders: {
      "User-Agent": "Cante/0.1 compliance-monitor",
      "Accept-Language": "en-US,en;q=0.9",
    },
    notes: "Official weekly New York rulemaking register; latest issue links are polled.",
  },
  {
    id: "us-tx-register",
    country: "United States",
    name: "Texas Register",
    domain: "www.sos.state.tx.us",
    url: "https://www.sos.state.tx.us/texreg/index.shtml",
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "texas-register",
    view: "tx-register",
    rawFilename: "us-tx-register.html",
    activation: { state: "Texas", stateScope: "either" },
    notes: "Official weekly Texas rulemaking journal; parser versions the stable current-issue URL by publication date.",
  },
  ...[
    ["us-bis-ear", "BIS - Export Administration Regulations", "www.bis.gov", "https://www.bis.gov/regulations/ear", "trade", "bis-ear"],
    ["us-census-aes", "Census - AES and Foreign Trade Regulations", "www.census.gov", "https://www.census.gov/foreign-trade/aes/", "trade", "census-aes"],
    ["us-ftc-made-in-usa", "FTC - Made in USA guidance", "www.ftc.gov", "https://www.ftc.gov/business-guidance/resources/complying-made-usa-standard", "standards", "ftc-labeling"],
    ["us-cpsc-business", "CPSC - business and manufacturing", "www.cpsc.gov", "https://www.cpsc.gov/Business--Manufacturing", "standards", "cpsc-business"],
  ].map(([id, name, domain, url, regulationType, view]) => ({
    id,
    country: "United States",
    name,
    domain,
    url,
    regulationType: regulationType as SourceDefinition["regulationType"],
    reliabilityStatus: (id === "us-ftc-made-in-usa" ? "blocked" : "working") as ReliabilityStatus,
    parser: "heartbeat-html" as const,
    heartbeat: true,
    view,
    rawFilename: `${id}.html`,
    timeoutMs: 15_000,
    activation:
      id === "us-bis-ear" || id === "us-census-aes"
        ? { profileGate: "export" as const }
        : id === "us-cpsc-business"
          ? { profileGate: "consumer-product" as const }
          : undefined,
    notes:
      id === "us-ftc-made-in-usa"
        ? "Direct automated requests are bot-blocked; FTC rule changes remain covered through the official Federal Register feed."
        : "Reachability and reference check only; this does not claim complete change-feed coverage.",
  })),
];

/** Legacy helper: sources expected to produce parseable rows without caveats. */
export function fetchableSources(country = "United States"): SourceDefinition[] {
  return SOURCE_REGISTRY.filter(
    (s) => s.country === country && s.reliabilityStatus === "working",
  );
}

/**
 * Everything the monitor should attempt. Blocked sources remain excluded
 * because repeated automated hits are dishonest and unhelpful; unstable and
 * untested sources are attempted and recorded as success/failure.
 */
export function monitoredSources(
  country = "United States",
  profile?: SourceSelectionProfile | null,
): SourceDefinition[] {
  return selectMonitoredSources(country, profile).sources;
}

const STATE_ALIASES: Record<NonNullable<SourceActivation["state"]>, string[]> = {
  "North Carolina": ["North Carolina", "NC"],
  California: ["California", "CA"],
  "New York": ["New York", "NY"],
  Texas: ["Texas", "TX"],
};

/**
 * Regional Perda coverage through pasal.id, activated by customer location.
 *
 * Indonesia has 38 provinces and 500-plus regencies and cities, each issuing its
 * own Perda. Cante has official adapters for exactly two jurisdictions —
 * Surabaya city and East Java province. A customer in Sidoarjo, or one
 * distributing into Banten, had no
 * regional coverage at all and no way to get it without a new hand-built
 * adapter per city.
 *
 * pasal.id carries these nationally, so a region becomes a row here rather than
 * an adapter. Three rules keep that from turning into false coverage:
 *
 * 1. **Every slug below was verified live against the API.** Coverage is
 *    genuinely patchy and cannot be guessed from a pattern: `perda-kabupaten-
 *    mojokerto` holds 99 regulations while `perda-kota-mojokerto` does not
 *    exist, and Gresik has neither. A wrong slug returns `{"error":"Unknown
 *    issuing body"}`, which fails the source loudly — the right behaviour, but
 *    not something to rely on as a discovery mechanism.
 * 2. **Regions with a working official adapter are deliberately absent.**
 *    Surabaya and East Java are covered by `jdih.surabaya.go.id` and
 *    `api.jdih.jatimprov.go.id`. Adding a private re-publisher beside a working
 *    official feed duplicates findings under two URLs that dedup cannot match,
 *    and downgrades the evidence.
 * 3. **A recorded location that matches nothing here is disclosed**, not
 *    silently dropped — see the caveat in `selectMonitoredSources()`.
 */
interface PasalRegion {
  /** Location words that activate this region, matched case-insensitively. */
  terms: string[];
  /** Verified pasal.id issuing_body slug. */
  slug: string;
  /** Human name for the source row. */
  label: string;
}

const PASAL_REGIONS: PasalRegion[] = [
  // East Java, excluding Surabaya city and the province itself (both official).
  { terms: ["Sidoarjo"], slug: "perda-kabupaten-sidoarjo", label: "Kabupaten Sidoarjo" },
  { terms: ["Mojokerto"], slug: "perda-kabupaten-mojokerto", label: "Kabupaten Mojokerto" },
  { terms: ["Pasuruan"], slug: "perda-kota-pasuruan", label: "Kota Pasuruan" },
  // Other provinces a customer may operate in or distribute to.
  { terms: ["Banten"], slug: "perda-provinsi-banten", label: "Provinsi Banten" },
  { terms: ["Kota Tangerang", "Tangerang"], slug: "perda-kota-tangerang", label: "Kota Tangerang" },
  {
    terms: ["Kabupaten Tangerang", "Tangerang"],
    slug: "perda-kabupaten-tangerang",
    label: "Kabupaten Tangerang",
  },
  {
    terms: ["Jakarta", "DKI"],
    slug: "perda-provinsi-dki-jakarta",
    label: "Provinsi DKI Jakarta",
  },
];

/** Locations that already have an official adapter and must not be duplicated. */
const OFFICIALLY_COVERED_REGIONS = ["Surabaya", "Jawa Timur", "East Java"];

function matchedPasalRegions(
  profile?: SourceSelectionProfile | null,
  options: SourceSelectionOptions = {},
): PasalRegion[] {
  const haystack = [...(options.locations ?? []), ...(profile?.facilityAddresses ?? [])]
    .join(" ")
    .toLowerCase();
  if (!haystack.trim()) return [];
  return PASAL_REGIONS.filter((region) =>
    region.terms.some((term) => haystack.includes(term.toLowerCase())),
  );
}

/** One source per matched region, or none when no location is on file. */
export function regionalPasalSources(
  profile?: SourceSelectionProfile | null,
  options: SourceSelectionOptions = {},
): SourceDefinition[] {
  if (!process.env.PASAL_API_TOKEN?.trim()) return [];

  return matchedPasalRegions(profile, options).map((region) => ({
    id: `pasal-region-${region.slug}`,
    country: "Indonesia",
    name: `pasal.id (penerbit ulang swasta) — Perda ${region.label}`,
    domain: "pasal.id",
    // No year filter: see refreshDynamicUrl(). The ledger decides what is new.
    url: `https://pasal.id/api/v1/laws?issuing_body=${region.slug}&limit=50`,
    // A regency genuinely passing no Perda is a real quiet result, not a broken
    // parser — but only when the API says so in as many words.
    emptyStateMarker: '"total":0',
    regulationType: "regional",
    reliabilityStatus: "working",
    parser: "pasal-laws-json",
    view: `pasal-${region.slug}`,
    rawFilename: `${region.slug}.json`,
    maxAttempts: 2,
    requestHeaders: { Accept: "application/json" },
    requiresEnv: "PASAL_API_TOKEN",
    notes: `Regional Perda for ${region.label} via pasal.id, a private re-publisher. Activated by recorded customer location. No official adapter exists for this jurisdiction.`,
  }));
}

export function selectMonitoredSources(
  country = "United States",
  profile?: SourceSelectionProfile | null,
  options: SourceSelectionOptions = {},
): SourceSelection {
  const candidates = SOURCE_REGISTRY.filter(
    (source) => source.country === country && source.reliabilityStatus !== "blocked",
  );
  if (country === "Indonesia") {
    const active = [
      ...candidates.filter((source) => sourceIsActive(source, profile, options)),
      ...regionalPasalSources(profile, options),
    ].map((source) => refreshDynamicUrl(source, options));
    const coverageCaveats = [
      "JDIH Setneg mengotomatiskan UU, Perpu, PP, Perpres, Keppres, dan Inpres, tetapi belum ada sumber pusat yang andal untuk seluruh Permen/Kepmen. Cante memantau sumber kementerian yang sudah terverifikasi; kementerian lain tetap perlu pemeriksaan manual.",
    ];
    if (active.some((source) => source.id === "kemenperin-pasal")) {
      coverageCaveats.push(
        "Peraturan Menteri Perindustrian dipantau lewat pasal.id, sebuah basis data hukum swasta yang menerbitkan ulang — bukan catatan resmi pemerintah. JDIH Kemenperin dan peraturan.go.id tidak dapat diakses sejak lama, sehingga tidak ada sumber resmi yang bisa diambil otomatis untuk kementerian ini. Setiap temuan dari sumber ini harus dikonfirmasi ke dokumen resmi sebelum ditindaklanjuti.",
        "API pasal.id hanya memberi tahun, tanpa tanggal. Cante mengambil tanggal penetapan dan pengundangan secara terpisah untuk setiap Permenperin yang masuk penilaian; kalau sebuah entri tidak menyebutkan tanggal, umur peraturan itu memang belum diketahui. Tanggal mulai berlaku menurut pasal penutup tetap belum dipastikan. Hanya Permen (bukan Kepmen atau Surat Edaran) yang tersedia di sana untuk Kemenperin.",
      );
    } else {
      coverageCaveats.push(
        "Peraturan Menteri Perindustrian tidak dipantau: PASAL_API_TOKEN belum diatur, sedangkan JDIH Kemenperin dan peraturan.go.id tidak dapat diakses. Kementerian yang paling relevan untuk manufaktur ini sepenuhnya belum tercakup dan perlu pemeriksaan manual.",
      );
    }
    coverageCaveats.push(
      "JDIH Provinsi Jawa Timur memblokir permintaan otomatis. Perda, Pergub, Kepgub, instruksi, dan surat edaran tingkat provinsi tetap perlu pemeriksaan manual meskipun sumber Kota Surabaya berhasil.",
      "API OSS hanya membuktikan katalog KBLI tersedia; status NIB perusahaan, tingkat risiko, perizinan, dan kewajiban PB-UMKU memerlukan bukti OSS yang sudah dikonfirmasi.",
      "BSN PESTA adalah katalog SNI, bukan bukti bahwa suatu standar wajib untuk produk ini. Status wajib harus dibuktikan dari peraturan teknis yang berlaku.",
      "Penemuan pengumuman dokumen lingkungan DLH Surabaya memakai jendela 45 hari. Pengumuman yang lebih lama belum diaudit secara historis oleh monitor ini.",
    );
    if (
      SOURCE_REGISTRY.some(
        (source) =>
          source.country === country &&
          source.activation?.locationTerms?.length &&
          !sourceIsActive(source, profile, options),
      )
    ) {
      coverageCaveats.push(
        "Sumber provinsi/kota yang spesifik lokasi tidak diaktifkan karena lokasi yang tercatat belum cocok dengan adapter regional yang tersedia.",
      );
    }
    const regional = active.filter((source) => source.id.startsWith("pasal-region-"));
    if (regional.length > 0) {
      coverageCaveats.push(
        `Perda daerah berikut dipantau lewat pasal.id (penerbit ulang swasta, bukan catatan resmi): ${regional
          .map((source) => source.name.replace(/^.*— Perda /, ""))
          .join(", ")}. Daerah ini belum punya adapter resmi di Cante, jadi cakupannya belum tentu lengkap dan setiap temuan harus dikonfirmasi ke JDIH daerah setempat.`,
      );
    }
    const locationsOnFile = [
      ...(options.locations ?? []),
      ...(profile?.facilityAddresses ?? []),
    ].filter((value) => value.trim());
    if (locationsOnFile.length > 0 && regional.length === 0) {
      coverageCaveats.push(
        "Selain Surabaya dan Jawa Timur, belum ada sumber Perda daerah yang cocok dengan lokasi yang tercatat. Peraturan daerah di lokasi lain tersebut belum dipantau sama sekali dan perlu pemeriksaan manual.",
      );
    }
    return { sources: active, coverageCaveats };
  }
  if (country !== "United States") return { sources: candidates, coverageCaveats: [] };

  const active = [
    ...candidates
      .filter((source) => sourceIsActive(source, profile, options))
      .map((source) =>
        source.id === "us-ustr-section-301-hts"
          ? { ...source, profileCodes: normalizedHts6Codes(profile) }
          : source,
      ),
    ...htsSearchSources(profile),
    ...crossSources(profile),
  ].map((source) => refreshDynamicUrl(source, options));
  const coverageCaveats: string[] = [];
  const facilities = profile?.facilityAddresses ?? [];
  const distribution = profile?.distributionStates ?? [];
  const flags = profile?.regulatedProductFlags ?? [];

  if (!facilities.length) {
    coverageCaveats.push(
      "Location-specific state environmental, labor, permit, and local sources were not activated because no U.S. facility address is recorded.",
    );
  }
  if (!distribution.length) {
    coverageCaveats.push(
      "State distribution-rule monitoring was not activated because no distribution states are recorded.",
    );
  } else {
    const supported = new Set(Object.keys(STATE_ALIASES));
    const unsupported = distribution.filter(
      (value) => ![...supported].some((state) => matchesState(value, state as keyof typeof STATE_ALIASES)),
    );
    if (unsupported.length) {
      coverageCaveats.push(
        `No automated state-register adapter is configured yet for: ${unsupported.join(", ")}. These states remain manual-assisted.`,
      );
    }
  }
  if (!flags.length) {
    coverageCaveats.push(
      "FDA, USDA, FCC, DOT/NHTSA, CPSC recall, and DDTC-specific feeds were not activated because no regulated-product flags are recorded.",
    );
  }
  if (!hasExportProfile(profile)) {
    coverageCaveats.push(
      "BIS, Census/FTR, OFAC, CBP, and export eCFR feeds were not activated because no U.S. export classification, code, or destination is recorded.",
    );
  } else {
    coverageCaveats.push(
      "No complete free public HTS-to-PGA requirements feed exists. PGA applicability and required ACE data elements remain manual-assisted and must not be represented as fully checked.",
    );
    const recordedHtsCodes = [
      ...new Set(
        (profile?.htsScheduleBCodes ?? [])
          .map(({ code }) => code.replace(/\D/g, ""))
          .filter((code) => code.length >= 6)
          .map((code) => code.slice(0, 6)),
      ),
    ];
    if (!recordedHtsCodes.length) {
      coverageCaveats.push(
        "CBP CROSS code-specific ruling searches were not activated because no valid six-digit HTS or Schedule B code is recorded.",
      );
    } else if (recordedHtsCodes.length > CROSS_PROFILE_CODE_LIMIT) {
      coverageCaveats.push(
        `CBP CROSS searches were limited to the first ${CROSS_PROFILE_CODE_LIMIT} distinct recorded HTS-6 codes; ${recordedHtsCodes.length - CROSS_PROFILE_CODE_LIMIT} additional codes remain outside this run.`,
      );
    }
  }
  if (!options.lastCompletedAt && active.some((source) => source.parser === "ecfr-versions-json")) {
    coverageCaveats.push(
      `eCFR bootstrap coverage begins ${ecfrWindowStart(options)}. Earlier amendments were not historically audited by this monitor.`,
    );
  }
  if (!options.lastCompletedAt && active.some((source) => source.parser === "federal-register-json")) {
    coverageCaveats.push(
      `Federal Register bootstrap coverage begins ${ecfrWindowStart(options)}. Earlier documents were not historically audited by this monitor.`,
    );
  }

  return { sources: active, coverageCaveats };
}

function refreshDynamicUrl(
  source: SourceDefinition,
  options: SourceSelectionOptions = {},
): SourceDefinition {
  if (source.lookbackDays) {
    const since = new Date(options.now ?? new Date());
    since.setUTCDate(since.getUTCDate() - source.lookbackDays);
    return { ...source, windowStart: since.toISOString().slice(0, 10) };
  }
  // pasal.id has no date field to window on, so a ministry feed retrieves by
  // calendar year, recomputed per run because the registry is built once at
  // module load. Only sources that already carry a `year` are refreshed:
  // regional Perda feeds deliberately omit it, because a regency may pass no
  // Perda at all in a given year (Sidoarjo and Banten both had zero for 2026
  // while holding 8 and 137 across all years) — windowing them to the current
  // year would return nothing and look like coverage.
  if (source.parser === "pasal-laws-json") {
    const url = new URL(source.url);
    if (!url.searchParams.has("year")) return source;
    url.searchParams.set("year", String(new Date(options.now ?? new Date()).getUTCFullYear()));
    return { ...source, url: url.toString() };
  }
  if (source.id === "us-cpsc-recalls") return { ...source, url: cpscRecentRecalls() };
  if (source.parser === "federal-register-json") {
    const url = new URL(source.url);
    const windowStart = ecfrWindowStart(options);
    url.searchParams.set("conditions[publication_date][gte]", windowStart);
    return { ...source, url: url.toString(), windowStart, emptyStateMarker: '"count":0' };
  }
  // The eCFR window is relative to today, so it has to be recomputed per run —
  // the registry is built once at module load and a long-lived server would
  // otherwise keep asking for a window that ages with the process.
  const ecfrTitleMatch = source.id.match(/^us-ecfr-title-(\d+)$/);
  if (ecfrTitleMatch) {
    return {
      ...source,
      url: ecfrTitle(Number(ecfrTitleMatch[1]), ecfrWindowStart(options)),
    };
  }
  if (source.id === "us-ca-register") {
    return { ...source, url: currentCaliforniaRegisterMonth() };
  }
  return source;
}

function sourceIsActive(
  source: SourceDefinition,
  profile?: SourceSelectionProfile | null,
  options: SourceSelectionOptions = {},
): boolean {
  // A credentialed source with no credential is not selectable. It is excluded
  // here rather than left to fail at fetch time so it does not become a
  // permanent red row that trains the reader to skim failures; selection
  // discloses the resulting gap as a caveat instead.
  if (source.requiresEnv && !process.env[source.requiresEnv]?.trim()) return false;

  const activation = source.activation;
  if (!activation) return true;

  if (activation.profileGate && !matchesProfileGate(activation.profileGate, profile)) return false;
  if (activation.state) {
    const facilityMatch = (profile?.facilityAddresses ?? []).some((value) =>
      matchesState(value, activation.state!),
    );
    const distributionMatch = (profile?.distributionStates ?? []).some((value) =>
      matchesState(value, activation.state!),
    );
    const scope = activation.stateScope ?? "either";
    if (scope === "facility" && !facilityMatch) return false;
    if (scope === "distribution" && !distributionMatch) return false;
    if (scope === "either" && !facilityMatch && !distributionMatch) return false;
  }
  if (
    activation.facilityTerms &&
    !(profile?.facilityAddresses ?? []).some((address) =>
      activation.facilityTerms!.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(address)),
    )
  ) {
    return false;
  }
  if (activation.locationTerms) {
    const locations = [...(options.locations ?? []), ...(profile?.facilityAddresses ?? [])];
    if (
      !locations.some((location) =>
        activation.locationTerms!.some((term) =>
          new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(location),
        ),
      )
    ) {
      return false;
    }
  }
  return true;
}

function matchesProfileGate(
  gate: UsProfileGate,
  profile?: SourceSelectionProfile | null,
): boolean {
  if (gate === "export") return hasExportProfile(profile);
  if (gate === "trade") return hasTradeProfile(profile);
  const flags = (profile?.regulatedProductFlags ?? []).join(" ");
  const patterns: Record<Exclude<UsProfileGate, "export" | "trade">, RegExp> = {
    "consumer-product": /consumer|children|toy|household|recreation|apparel|textile/i,
    "food-drug": /food|beverage|drug|medical|device|cosmetic|biologic|agricultur/i,
    electronics: /electronic|radio|wireless|telecom|fcc/i,
    transport: /automotive|vehicle|transport|hazmat|dangerous good|battery/i,
    defense: /defense|military|space|satellite|weapon|itar|usml/i,
  };
  return patterns[gate].test(flags);
}

/** A declared side of trade, when the customer has stated one. */
function tradeSide(profile?: SourceSelectionProfile | null): string {
  return (profile?.sideOfTrade ?? "").trim().toLowerCase();
}

/**
 * Export-only sources. A stated `domestic` or `import` side suppresses them
 * even when stray codes are on file — a declared fact beats an inferred one.
 */
function hasExportProfile(profile?: SourceSelectionProfile | null): boolean {
  const side = tradeSide(profile);
  if (side === "domestic" || side === "import") return false;
  if (side === "export" || side === "both") return true;
  return Boolean(
    profile?.htsScheduleBCodes.length ||
      profile?.exportClassifications.length ||
      profile?.exportCountries.length,
  );
}

/**
 * Cross-border sources, in either direction. An importer gets Section 301,
 * AD/CVD, UFLPA and 19 CFR without ever exporting anything.
 */
function hasTradeProfile(profile?: SourceSelectionProfile | null): boolean {
  const side = tradeSide(profile);
  if (side === "domestic") return false;
  if (side === "import" || side === "export" || side === "both") return true;
  return hasExportProfile(profile);
}

function matchesState(value: string, state: keyof typeof STATE_ALIASES): boolean {
  return STATE_ALIASES[state].some((alias) =>
    new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(alias)}(?:$|[^A-Za-z])`, "i").test(value),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
