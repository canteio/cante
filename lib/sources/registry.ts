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
  | "klh-json"
  | "kemnaker"
  | "djbc-home"
  | "djp-list"
  | "surabaya-regulations-json"
  | "surabaya-dlh-json"
  | "federal-register-json"
  | "ecfr-versions-json"
  | "cpsc-recalls-json"
  | "rss"
  | "dated-link-list"
  | "nc-register"
  | "nc-air-notices"
  | "texas-register"
  | "heartbeat-html"
  | "generic-regulation";

export type UsProfileGate =
  | "export"
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
      "Official catalogue works interactively but Cloudflare blocks unattended fetches. Provincial Perda, Pergub, Kepgub, instructions, and circulars remain manual-assisted.",
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
    ["bis", "BIS / EAR", ["industry-and-security-bureau"]],
    ["census", "Census / FTR", ["census-bureau"]],
    ["ofac", "OFAC", ["foreign-assets-control-office"]],
    ["cbp", "CBP", ["u-s-customs-and-border-protection"]],
  ].map(([id, label, agencies]) => ({
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
    activation: { profileGate: "export" as const },
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
  ...[
    [29, "labor", "Labor and OSHA"],
    [40, "environment", "Environmental protection"],
    [16, "consumer", "Commercial practices, FTC, and CPSC"],
    [15, "commerce", "Commerce and foreign trade", "export"],
    [31, "sanctions", "Treasury and OFAC", "export"],
    [49, "transport", "Transportation and hazmat", "transport"],
    [21, "fda", "Food and drugs", "food-drug"],
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
    activation: { profileGate: "export" },
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
export function fetchableSources(country = "Indonesia"): SourceDefinition[] {
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
  country = "Indonesia",
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

export function selectMonitoredSources(
  country = "Indonesia",
  profile?: SourceSelectionProfile | null,
  options: SourceSelectionOptions = {},
): SourceSelection {
  const candidates = SOURCE_REGISTRY.filter(
    (source) => source.country === country && source.reliabilityStatus !== "blocked",
  );
  if (country === "Indonesia") {
    const active = candidates
      .filter((source) => sourceIsActive(source, profile, options))
      .map((source) => refreshDynamicUrl(source, options));
    const coverageCaveats = [
      "JDIH Setneg mengotomatiskan UU, Perpu, PP, Perpres, Keppres, dan Inpres, tetapi belum ada sumber pusat yang andal untuk seluruh Permen/Kepmen. Cante memantau sumber kementerian yang sudah terverifikasi; kementerian lain tetap perlu pemeriksaan manual.",
      "JDIH Provinsi Jawa Timur memblokir permintaan otomatis. Perda, Pergub, Kepgub, instruksi, dan surat edaran tingkat provinsi tetap perlu pemeriksaan manual meskipun sumber Kota Surabaya berhasil.",
      "API OSS hanya membuktikan katalog KBLI tersedia; status NIB perusahaan, tingkat risiko, perizinan, dan kewajiban PB-UMKU memerlukan bukti OSS yang sudah dikonfirmasi.",
      "BSN PESTA adalah katalog SNI, bukan bukti bahwa suatu standar wajib untuk produk ini. Status wajib harus dibuktikan dari peraturan teknis yang berlaku.",
      "Penemuan pengumuman dokumen lingkungan DLH Surabaya memakai jendela 45 hari. Pengumuman yang lebih lama belum diaudit secara historis oleh monitor ini.",
    ];
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
    return { sources: active, coverageCaveats };
  }
  if (country !== "United States") return { sources: candidates, coverageCaveats: [] };

  const active = candidates
    .filter((source) => sourceIsActive(source, profile, options))
    .map((source) => refreshDynamicUrl(source, options));
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
  }
  if (!options.lastCompletedAt && active.some((source) => source.parser === "ecfr-versions-json")) {
    coverageCaveats.push(
      `eCFR bootstrap coverage begins ${ecfrWindowStart(options)}. Earlier amendments were not historically audited by this monitor.`,
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
  if (source.id === "us-cpsc-recalls") return { ...source, url: cpscRecentRecalls() };
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
  const flags = (profile?.regulatedProductFlags ?? []).join(" ");
  const patterns: Record<Exclude<UsProfileGate, "export">, RegExp> = {
    "consumer-product": /consumer|children|toy|household|recreation|apparel|textile/i,
    "food-drug": /food|beverage|drug|medical|device|cosmetic|biologic|agricultur/i,
    electronics: /electronic|radio|wireless|telecom|fcc/i,
    transport: /automotive|vehicle|transport|hazmat|dangerous good|battery/i,
    defense: /defense|military|space|satellite|weapon|itar|usml/i,
  };
  return patterns[gate].test(flags);
}

function hasExportProfile(profile?: SourceSelectionProfile | null): boolean {
  return Boolean(
    profile?.htsScheduleBCodes.length ||
      profile?.exportClassifications.length ||
      profile?.exportCountries.length,
  );
}

function matchesState(value: string, state: keyof typeof STATE_ALIASES): boolean {
  return STATE_ALIASES[state].some((alias) =>
    new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(alias)}(?:$|[^A-Za-z])`, "i").test(value),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
