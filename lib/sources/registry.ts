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
  | "oss-kbli"
  | "generic-regulation";

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
  /** Listing view key, used to weight relevance during judgment. */
  view?: string;
  rawFilename?: string;
  notes?: string;
}

const LISTING_URL = "https://jdih.kemendag.go.id/peraturan";

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
    reliabilityStatus: "unstable",
    parser: "peraturan-go-id",
    view: "national-home",
    rawFilename: "peraturan-go-id-home.html",
    timeoutMs: 12_000,
    notes: "Its own homepage says 'Website dalam perbaikan'. Bonus source; expect it to fail.",
  },
  {
    id: "peraturan-go-id-uu",
    country: "Indonesia",
    name: "peraturan.go.id — Undang-Undang",
    domain: "peraturan.go.id",
    url: "https://peraturan.go.id/uu",
    regulationType: "national",
    reliabilityStatus: "unstable",
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
    reliabilityStatus: "unstable",
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
    reliabilityStatus: "unstable",
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
    reliabilityStatus: "unstable",
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
    reliabilityStatus: "untested",
    parser: "generic-regulation",
    view: "jdihn",
    rawFilename: "jdihn.html",
    timeoutMs: 12_000,
    notes: "Fallback search across every ministry's JDIH. Not yet confirmed reachable.",
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
    reliabilityStatus: "untested",
    parser: "bsn-pesta",
    view: "sni-products",
    rawFilename: "bsn-pesta-produk.html",
    timeoutMs: 12_000,
    notes: "SNI catalogue surface. Product-specific mandatory status still needs detail/source validation.",
  },
  {
    id: "oss-kbli",
    country: "Indonesia",
    name: "OSS — KBLI and business licensing portal",
    domain: "oss.go.id",
    url: "https://oss.go.id/id/kbli",
    regulationType: "licensing",
    reliabilityStatus: "working",
    parser: "oss-kbli",
    view: "oss-kbli",
    rawFilename: "oss-kbli.html",
    timeoutMs: 12_000,
    notes: "KBLI/OSS portal heartbeat. Specific KBLI obligation mapping still depends on confirmed KBLI codes and detail lookups.",
  },
];

/** Legacy helper: sources expected to produce parseable rows without caveats. */
export function fetchableSources(): SourceDefinition[] {
  return SOURCE_REGISTRY.filter((s) => s.reliabilityStatus === "working");
}

/**
 * Everything the monitor should attempt. Blocked sources remain excluded
 * because repeated automated hits are dishonest and unhelpful; unstable and
 * untested sources are attempted and recorded as success/failure.
 */
export function monitoredSources(): SourceDefinition[] {
  return SOURCE_REGISTRY.filter((s) => s.reliabilityStatus !== "blocked");
}
