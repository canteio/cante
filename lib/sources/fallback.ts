import type { FetchReport } from "@/lib/sources/fetch";
import type { SourceDefinition } from "@/lib/sources/registry";

/**
 * Second-hand cover for an official source that failed today.
 *
 * `jdih.kemenkeu.go.id` is the customs, duty and tax feed, and it timed out on
 * two of the last three real runs. Each time the alert correctly said PMK
 * changes went unchecked — honest, but the customer still learns nothing about
 * their tax and customs exposure that day. pasal.id re-publishes the same
 * ministry (57 PMK for 2026), so a failed day can carry a partial answer
 * instead of a blank one.
 *
 * ## Why this is a fallback and not just another source
 *
 * Running it every day would report every PMK **twice** — once from the
 * official portal and once from the re-publisher, under different URLs that
 * dedup cannot match. It fires only when the primary actually failed in this
 * run, so on a healthy day it costs nothing and changes nothing.
 *
 * ## The rule this must not break
 *
 * A fallback that silently stands in for an official source is exactly the
 * failure rule 2 exists to prevent: it would turn "we could not check the tax
 * source" into what looks like a completed check. So the substitution is
 * **additive and disclosed, never a swap**. The primary's failure row stays
 * exactly as it was, the backup arrives as its own source with its own
 * `provenance`, and a code-written caveat states that the official record was
 * unreachable and that these rows are leads needing confirmation.
 *
 * East Java and BSN were considered and deliberately excluded:
 * - **East Java** is already covered by a *working official* source
 *   (`api.jdih.jatimprov.go.id`, 48 entries on the last run). pasal.id does
 *   carry it — under `PERDA`/`PERGUB`, not the empty `PERDA_PROV` — but adding
 *   a private re-publisher beside a working official feed is a downgrade.
 * - **BSN/SNI is not in pasal.id at all.** Checked live: its `PERBAN` bucket
 *   holds BPOM, OJK, BSSN, BI, BMKG, Perpusnas, BPS, BRIN, BPJPH and LAN, and
 *   no BSN. SNI are *standards*, not regulations; pasal.id has laws that make
 *   an SNI mandatory, never the standard itself. No amount of wiring fixes that.
 */

interface FallbackPairing {
  /** Source id whose failure activates the backup. */
  whenFailed: string;
  source: SourceDefinition;
}

const FALLBACKS: FallbackPairing[] = [
  {
    whenFailed: "kemenkeu-jdih",
    source: {
      id: "kemenkeu-pasal-fallback",
      country: "Indonesia",
      name: "pasal.id (cadangan penerbit ulang) — PMK Kemenkeu",
      domain: "pasal.id",
      url: "https://pasal.id/api/v1/laws?type=PERMEN&issuing_body=permenkeu&limit=50&year=2026",
      regulationType: "tax",
      reliabilityStatus: "working",
      parser: "pasal-laws-json",
      view: "kemenkeu-pmk-fallback",
      rawFilename: "kemenkeu-pasal-fallback.json",
      maxAttempts: 2,
      requestHeaders: { Accept: "application/json" },
      requiresEnv: "PASAL_API_TOKEN",
      notes:
        "Only fetched on runs where the official JDIH Kemenkeu feed failed. Private re-publisher standing in for an unreachable official record; never a replacement for it.",
    },
  },
];

/**
 * Backups whose primary failed in this run. Returns an empty list on a healthy
 * run, when the credential is missing, or when the primary was never selected.
 */
export function selectFallbackSources(
  report: FetchReport,
  options: { now?: Date } = {},
): SourceDefinition[] {
  const failed = new Set(
    report.outcomes.filter((outcome) => !outcome.success).map((outcome) => outcome.sourceId),
  );
  const year = new Date(options.now ?? new Date()).getUTCFullYear();

  return FALLBACKS.filter((pairing) => failed.has(pairing.whenFailed))
    .filter((pairing) => !pairing.source.requiresEnv || process.env[pairing.source.requiresEnv]?.trim())
    .map((pairing) => {
      const url = new URL(pairing.source.url);
      url.searchParams.set("year", String(year));
      return { ...pairing.source, url: url.toString() };
    });
}

/** The disclosure that keeps a substitution from reading as a completed check. */
export function fallbackCaveat(sourceId: string): string {
  const primary = FALLBACKS.find((pairing) => pairing.source.id === sourceId)?.whenFailed;
  if (primary === "kemenkeu-jdih") {
    return (
      "Sumber resmi JDIH Kemenkeu gagal diakses hari ini, jadi peraturan PMK di bawah diambil dari pasal.id — penerbit ulang swasta, bukan catatan resmi pemerintah. " +
      "Cakupannya belum tentu sama dengan portal resmi dan setiap temuan harus dikonfirmasi ke dokumen resmi. Ini bukan pengganti pemeriksaan sumber resmi yang gagal."
    );
  }
  return (
    "Sumber resmi gagal diakses, jadi data cadangan diambil dari pasal.id (penerbit ulang swasta). Perlakukan sebagai petunjuk awal, bukan hasil pemeriksaan sumber resmi."
  );
}
