import type { RegulationEntry } from "@/lib/sources/fetch";

/**
 * Entries in, verdicts out.
 *
 * `source_results` proves what was *fetched*. Nothing proved what was
 * *judged* — an entry the model silently skipped and an entry it read and
 * cleared both left no row, so a run could parse 30 Kemendag entries, return
 * verdicts on none of them, and still read as "checked, nothing found". That
 * is the exact failure rule 2 exists to prevent, one stage further down.
 *
 * Not every entry needs a verdict: anything already in the seen log was
 * deliberately withheld ("do not flag these again"). Those are accounted for
 * separately from entries nobody has ever said anything about.
 */

export interface VerdictCoverage {
  totalEntries: number;
  judged: number;
  alreadySeen: number;
  /** Never judged in this run, and never seen in any earlier run. */
  unaccounted: RegulationEntry[];
  /** Caveats written by code, not by the model. */
  caveats: string[];
}

/** Exported so a second-pass judgment retry can match its findings back to the exact entries it was asked about. */
export function normalizeUrlKey(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}
const key = normalizeUrlKey;

/**
 * Indonesian instrument names and their abbreviations, collapsed to one token.
 *
 * The same regulation is cited both ways in the wild — a Setneg row reads
 * "Peraturan Pemerintah 27 Tahun 2026" while a Kemnaker row reads "PP 27 Tahun
 * 2026". Type is what separates them from each other: PP 11/2026, Perpres
 * 11/2026 and Permenaker 11/2026 are three different regulations that share a
 * number and a year, so the type must be part of the identity, never dropped.
 */
const INSTRUMENT_ALIASES: [RegExp, string][] = [
  [/\bperaturan\s+menteri\s+ketenagakerjaan\b|\bpermenaker\b/, "permenaker"],
  [/\bperaturan\s+menteri\s+perdagangan\b|\bpermendag\b/, "permendag"],
  [/\bperaturan\s+menteri\s+perindustrian\b|\bpermenperin\b/, "permenperin"],
  [/\bperaturan\s+menteri\s+keuangan\b|\bpmk\b/, "permenkeu"],
  [/\bperaturan\s+menteri\s+lingkungan\s+hidup\b|\bpermenlh\b|\bperaturan\s+menteri\s+lh\b/, "permenlh"],
  [/\bperaturan\s+pemerintah\s+pengganti\b|\bperppu\b/, "perppu"],
  [/\bperaturan\s+pemerintah\b|\bpp\b/, "pp"],
  [/\bperaturan\s+presiden\b|\bperpres\b/, "perpres"],
  [/\bkeputusan\s+presiden\b|\bkeppres\b/, "keppres"],
  [/\binstruksi\s+presiden\b|\binpres\b/, "inpres"],
  [/\bundang[-\s]?undang\b|\buu\b/, "uu"],
  [/\bperaturan\s+daerah\b|\bperda\b/, "perda"],
  [/\bperaturan\s+gubernur\b|\bpergub\b/, "pergub"],
  [/\bperaturan\s+wali\s*kota\b|\bperwali\b/, "perwali"],
  [/\bkeputusan\s+direktur\s+jenderal\b|\bkeputusan\s+dirjen\b|\bkepdirjen\b/, "kepdirjen"],
  [/\bkeputusan\s+menteri\b|\bkepmen\b/, "kepmen"],
  [/\bperaturan\s+menteri\b|\bpermen\b/, "permen"],
];

/**
 * The legal identity of a regulation: instrument type + number + year.
 *
 * One regulation is often fetched from two portals under two URLs — Setneg and
 * Kemnaker both carry PP 27/2026. Exact-URL matching alone therefore reported a
 * regulation the model had already judged as "never checked", which is a false
 * alarm in the one place the product cannot afford them. Returns null when the
 * citation cannot be read confidently; callers must treat null as "no match",
 * never as a match, so an unparseable title stays unaccounted rather than being
 * silently absorbed.
 */
export function regulationIdentityKey(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  // "Nomor 12 Tahun 2026", then a bare "12 Tahun 2026", then the composite
  // decree format ministries use for Keputusan Dirjen — "Nomor
  // 3/1920/PK.01.02/III/2026" — which carries its year inside the number and
  // matches none of the "Tahun" shapes.
  const match =
    normalized.match(/\bnomor\s+([\w./-]+)\s+tahun\s+(\d{4})\b/) ??
    normalized.match(/\b([\w./-]*\d[\w./-]*)\s+tahun\s+(\d{4})\b/) ??
    normalized.match(/\b(?:nomor\s+)?(\d[\w.-]*(?:\/[\w.-]+)+\/(\d{4}))\b/);
  if (!match) return null;

  const number = match[1].replace(/[^\w]/g, "");
  const year = match[2];
  // Only the text before the number can name the instrument; anything after it
  // is the subject matter and routinely cites *other* regulations.
  const beforeNumber = normalized.slice(0, match.index ?? 0);
  const instrument = INSTRUMENT_ALIASES.find(([pattern]) => pattern.test(beforeNumber))?.[1];
  if (!instrument || !number) return null;
  return `${instrument}|${number}|${year}`;
}

export function auditVerdictCoverage(
  regulations: RegulationEntry[],
  judgedUrls: (string | null)[],
  seenUrls: (string | null)[],
  language: "id" | "en" = "id",
  /**
   * Citations of regulations judged in earlier runs, in any form. Supplying
   * these stops the same regulation, fetched from a second portal under a
   * different URL, being reported as never checked.
   */
  seenCitations: (string | null)[] = [],
): VerdictCoverage {
  const judged = new Set(judgedUrls.map(key).filter(Boolean));
  const seen = new Set(seenUrls.map(key).filter(Boolean));
  const seenIdentities = new Set(
    seenCitations.map(regulationIdentityKey).filter((value): value is string => Boolean(value)),
  );

  let judgedCount = 0;
  let seenCount = 0;
  let seenElsewhereCount = 0;
  const unaccounted: RegulationEntry[] = [];

  for (const entry of regulations) {
    const k = key(entry.url);
    if (judged.has(k)) {
      judgedCount += 1;
      continue;
    }
    if (seen.has(k)) {
      seenCount += 1;
      continue;
    }
    // Same regulation, different portal. Judged already — just not at this URL.
    const identity = regulationIdentityKey(entry.label) ?? regulationIdentityKey(entry.fullTitle);
    if (identity && seenIdentities.has(identity)) {
      seenElsewhereCount += 1;
      continue;
    }
    unaccounted.push(entry);
  }
  seenCount += seenElsewhereCount;

  const caveats: string[] = [];
  const elsewhere =
    seenElsewhereCount > 0
      ? language === "en"
        ? ` (${seenElsewhereCount} of them the same regulation already judged from another source)`
        : ` (${seenElsewhereCount} di antaranya peraturan yang sama dan sudah dinilai dari sumber lain)`
      : "";
  caveats.push(
    language === "en"
      ? `Coverage audit: ${regulations.length} fetched entries; ${judgedCount} received a verdict ` +
          `this run; ${seenCount} were already judged in an earlier run${elsewhere}; ${unaccounted.length} remain unaccounted.`
      : `Audit cakupan: ${regulations.length} entri diambil; ${judgedCount} mendapat penilaian ` +
          `run ini; ${seenCount} sudah dinilai di run sebelumnya${elsewhere}; ${unaccounted.length} belum terhitung.`,
  );
  if (unaccounted.length > 0) {
    const examples = unaccounted
      .slice(0, 5)
      .map((e) => e.label || e.fullTitle.slice(0, 60))
      .join("; ");
    caveats.push(
      language === "en"
        ? `${unaccounted.length} of ${regulations.length} fetched entries received no verdict ` +
            `in this run and have no exact-URL match in earlier runs. Treat them as unchecked, ` +
            `not as "nothing relevant"` +
            (examples ? `: ${examples}` : "") +
            (unaccounted.length > 5 ? ", and others." : ".")
        : `${unaccounted.length} dari ${regulations.length} entri yang berhasil diambil tidak ` +
            `mendapat penilaian pada pengecekan ini dan juga belum pernah muncul di run sebelumnya — ` +
            `anggap belum diperiksa, bukan "tidak ada yang relevan"` +
            (examples ? `: ${examples}` : "") +
            (unaccounted.length > 5 ? ", dan lainnya." : "."),
    );
  }

  return {
    totalEntries: regulations.length,
    judged: judgedCount,
    alreadySeen: seenCount,
    unaccounted,
    caveats,
  };
}
