import type { RegulationEntry } from "@/lib/sources/fetch";

/**
 * Enactment dates for pasal.id entries.
 *
 * The pasal.id REST API returns no date field anywhere — not in the listing and
 * not in a detail response — so a Permenperin arrives knowing only its year.
 * That breaks the oldest rule this monitor has: never assert recency from a
 * listing alone. Without a date, "Permenperin 22/2026" could have been signed
 * last week or eight months ago, and the alert cannot tell the reader which.
 *
 * The dates do exist. pasal.id's crawler scrapes them off peraturan.go.id's
 * detail-page tables into `works.tanggal_penetapan` / `tanggal_pengundangan`
 * (migration 018), and its own web page renders them. They are simply not
 * exposed through the API yet — an upstream gap, not a missing fact.
 *
 * So this module reads them from the rendered page, under three constraints:
 *
 * 1. **Only for entries entering judgment.** `runCheck()` calls this *after*
 *    the `source_documents` ledger diff, so the input is the handful of new or
 *    changed regulations, never the whole year. Steady state is roughly two
 *    fetches a month against ~23 Permenperin a year.
 * 2. **Never fails a run.** A date is an enrichment. Every failure degrades to
 *    "date unknown", which is exactly the state the entry was already in.
 * 3. **Forward-compatible by design.** `hasDates()` skips any entry that already
 *    carries dates, so the day pasal.id exposes them in the API — see the
 *    upstream issue referenced in CLAUDE.md — the parser fills them, this module
 *    finds nothing to do, and no code has to change.
 */

/** Bounded so a bad ledger diff can never turn into a crawl. */
const MAX_LOOKUPS_PER_RUN = 25;
const TIMEOUT_MS = 20_000;

const INDO_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

export interface PasalDates {
  /** Date the minister signed it (Tanggal Penetapan). */
  penetapan: string | null;
  /** Date it was promulgated in Berita Negara (Tanggal Pengundangan). */
  pengundangan: string | null;
  /** Berita Negara citation, e.g. "LN 2026 No. 529". */
  beritaNegara: string | null;
}

/** "15 Juli 2026" / "Jakarta, 15 Juli 2026" → "2026-07-15". */
export function parseIndonesianDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = INDO_MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Read the dates out of a rendered pasal.id law page.
 *
 * The markup is a definition list: `<dt>Penetapan</dt><dd>Jakarta, 15 Juli
 * 2026</dd>`. Matching on `<dt>`/`<dd>` deliberately ignores the React server
 * payload earlier in the document, which repeats the same values in a different
 * shape — and, more importantly, also contains the UI's translation bundle where
 * the word "Penetapan" appears as a *label* with no date attached.
 */
export function parsePasalDatesFromHtml(html: string): PasalDates {
  const field = (label: string): string[] => {
    const re = new RegExp(
      `<dt[^>]*>\\s*${label}\\s*</dt>\\s*((?:<dd[^>]*>[^<]*</dd>\\s*)+)`,
      "i",
    );
    const block = html.match(re)?.[1];
    if (!block) return [];
    return [...block.matchAll(/<dd[^>]*>([^<]*)<\/dd>/g)].map((m) => m[1].trim());
  };

  const penetapanCells = field("Penetapan");
  const pengundanganCells = field("Pengundangan");

  return {
    penetapan: parseIndonesianDate(penetapanCells[0]),
    pengundangan: parseIndonesianDate(pengundanganCells[0]),
    beritaNegara: pengundanganCells.find((cell) => /^(LN|BN|TLN|TBN)\b/i.test(cell)) ?? null,
  };
}

/** True when this entry already knows when it was made, from any source. */
function hasDates(entry: RegulationEntry): boolean {
  return Boolean(entry.effectiveOn) || /Ditetapkan|Diundangkan/i.test(entry.datesNote ?? "");
}

export interface EnrichmentResult {
  attempted: number;
  resolved: number;
  /** Code-written, so a silent enrichment failure cannot read as a dated entry. */
  caveats: string[];
}

/**
 * Fill in enactment dates for pasal.id entries, in place.
 *
 * Mutates `datesNote` rather than `effectiveOn`, matching what the Setneg parser
 * already does with the same two Indonesian dates: signing and promulgation are
 * facts about when a rule was *made*, while the date it takes legal effect is
 * usually stated in its own closing article and may be later. Recording them as
 * an effective date would assert something no source here established.
 */
export async function enrichPasalDates(
  entries: RegulationEntry[],
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<EnrichmentResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const targets = entries.filter((entry) => entry.domain === "pasal.id" && !hasDates(entry));
  if (targets.length === 0) return { attempted: 0, resolved: 0, caveats: [] };

  const budgeted = targets.slice(0, MAX_LOOKUPS_PER_RUN);
  let resolved = 0;
  let failed = 0;

  for (const entry of budgeted) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let html: string;
      try {
        const response = await doFetch(entry.url, {
          headers: { Accept: "text/html" },
          signal: options.signal ?? controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        html = await response.text();
      } finally {
        clearTimeout(timer);
      }

      const dates = parsePasalDatesFromHtml(html);
      if (!dates.penetapan && !dates.pengundangan) {
        failed += 1;
        continue;
      }

      const parts = [
        dates.penetapan ? `Ditetapkan ${dates.penetapan}` : null,
        dates.pengundangan ? `Diundangkan ${dates.pengundangan}` : null,
        dates.beritaNegara,
      ].filter(Boolean);
      entry.datesNote = `${parts.join("; ")}. Tanggal berlaku menurut pasal penutup belum dipastikan.`;
      resolved += 1;
    } catch {
      // A missing date leaves the entry exactly as honest as it already was.
      failed += 1;
    }
  }

  const caveats: string[] = [];
  if (failed > 0) {
    caveats.push(
      `Tanggal penetapan tidak berhasil diambil untuk ${failed} dari ${budgeted.length} peraturan pasal.id — peraturan tersebut hanya diketahui tahunnya, jadi jangan anggap baru atau lama.`,
    );
  }
  if (targets.length > budgeted.length) {
    caveats.push(
      `Pencarian tanggal dibatasi ${MAX_LOOKUPS_PER_RUN} peraturan per run; ${targets.length - budgeted.length} peraturan pasal.id lainnya masuk penilaian tanpa tanggal.`,
    );
  }
  return { attempted: budgeted.length, resolved, caveats };
}
