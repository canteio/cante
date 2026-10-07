/**
 * Section 301 (China) Chapter 99 cross-reference table.
 *
 * The USITC HTS row for a China-origin classification often carries an
 * `additionalDuties` cross-reference like "See 9903.88.03" — a pointer into
 * subchapter III of HTS Chapter 99, not a number lib/tariff/rates.ts can
 * compute with. This file is the first piece of real reference data that
 * resolves those pointers to an actual stacked rate, with the Federal
 * Register notice that imposed it, so a caller can say *why* a number is
 * what it is instead of just printing it.
 *
 * Scope, stated plainly: this table covers the four China Section 301
 * "List" actions under USTR's technology-transfer investigation (the
 * 9903.88.xx headings). It does NOT cover Section 232 steel/aluminum/auto
 * derivatives, USMCA/FTA rules-of-origin qualification, AD/CVD orders, or
 * forced-labor (UFLPA) measures — those require their own reference data
 * and are deliberately left unresolved rather than guessed at. See
 * `lib/tariff/stack.ts` for how an unresolved measure is reported.
 *
 * Every entry below is a verified historical fact (list composition,
 * in-force rate, effective date, Federal Register citation), checked
 * against USTR and Federal Register primary sources. Rates that were
 * modified after initial imposition reflect the *current* in-force rate,
 * with both the original and modifying notice cited.
 */

export interface Section301Measure {
  /** The Chapter 99 heading as it appears in an HTS row, e.g. "9903.88.03". */
  chapter99Code: string;
  /** Human label for the USTR action, e.g. "China Section 301 – List 3". */
  list: string;
  /** Country this measure applies to. Section 301 China actions: "CN" only. */
  country: "CN";
  /** Whether the measure is currently in force. */
  status: "active" | "suspended";
  /** Current in-force ad valorem rate, as a fraction (25% -> 0.25). Null when suspended. */
  ratePercent: number | null;
  /** Date the *current* rate took effect (ISO date). */
  effectiveDate: string;
  /** Federal Register citation(s) establishing/modifying the current rate. */
  federalRegisterCitations: string[];
  /** One line of plain-English provenance, for the explanation layer. */
  note: string;
}

/**
 * Indexed by the Chapter 99 heading. Deliberately small and exact rather
 * than broad and approximate — see the module doc.
 */
export const SECTION_301_CHINA_MEASURES: Record<string, Section301Measure> = {
  "9903.88.01": {
    chapter99Code: "9903.88.01",
    list: "China Section 301 – List 1",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2018-07-06",
    federalRegisterCitations: ["83 FR 28710 (June 20, 2018)"],
    note: "25% ad valorem on ~818 tariff subheadings (~$34B trade value), imposed at 25% from the start — no step-up.",
  },
  "9903.88.02": {
    chapter99Code: "9903.88.02",
    list: "China Section 301 – List 2",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2018-08-23",
    federalRegisterCitations: ["83 FR 40823 (August 16, 2018)"],
    note: "25% ad valorem on ~279 tariff subheadings (~$16B trade value), imposed at 25% from the start — no step-up.",
  },
  "9903.88.03": {
    chapter99Code: "9903.88.03",
    list: "China Section 301 – List 3",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2019-05-10",
    federalRegisterCitations: [
      "83 FR 47974 (September 21, 2018) — initial 10% effective 2018-09-24",
      "84 FR 20459 (May 9, 2019) — increased to 25% effective 2019-05-10",
    ],
    note: "Imposed at 10% on 2018-09-24, increased to 25% effective 2019-05-10. Covers ~5,745 subheadings (~$200B trade value).",
  },
  "9903.88.15": {
    chapter99Code: "9903.88.15",
    list: "China Section 301 – List 4A",
    country: "CN",
    status: "active",
    ratePercent: 0.075,
    effectiveDate: "2020-02-14",
    federalRegisterCitations: [
      "84 FR 43304 (August 20, 2019) — initial 15% effective 2019-09-01",
      "85 FR 3741 (January 22, 2020) — reduced to 7.5% effective 2020-02-14 (Phase One agreement)",
    ],
    note: "Imposed at 15% on 2019-09-01, reduced to 7.5% effective 2020-02-14 under the US-China Phase One deal. Still in force at 7.5%.",
  },
  "9903.88.04": {
    chapter99Code: "9903.88.04",
    list: "China Section 301 – List 4B",
    country: "CN",
    status: "suspended",
    ratePercent: null,
    effectiveDate: "2019-12-18",
    federalRegisterCitations: ["84 FR 69447 (December 18, 2019) — suspended indefinitely, never took effect"],
    note: "List 4B (the remaining ~$160B tranche) was announced and then suspended before its scheduled December 15, 2019 start; it has never been collected.",
  },
};

/** Chapter-99-style reference, e.g. "9903.88.03" or embedded in "See 9903.88.03". */
const CHAPTER_99_REF = /\b9903\.\d{2}\.\d{2}\b/g;

/**
 * Pull every Chapter 99 cross-reference out of a free-text USITC
 * `additionalDuties` string, e.g. "See 9903.88.03" -> ["9903.88.03"].
 * Returns [] for null/empty/no-match input — never throws on unexpected text.
 */
export function extractChapter99Refs(additionalDuties: string | null | undefined): string[] {
  if (!additionalDuties) return [];
  const matches = additionalDuties.match(CHAPTER_99_REF);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

/** Look up a known Section 301 measure by its Chapter 99 heading, or null if we have no record of it. */
export function lookupSection301Measure(chapter99Code: string): Section301Measure | null {
  return SECTION_301_CHINA_MEASURES[chapter99Code] ?? null;
}

/**
 * Supplemental List 4A (9903.88.15, 7.5%) HTS-prefix cross-reference,
 * verified 2026-10-06 against live USITC HTS rows plus CBP rulings, for
 * codes whose USITC REST `additionalDuties` field comes back empty even
 * though the subheading IS a published List 4A member.
 *
 * Why this table exists: `lookupTariff` resolves Section 301 solely from
 * the USITC HTS REST API's `additionalDuties` free-text field on each row.
 * That field is populated inconsistently — confirmed live on 2026-10-06 that
 * 6404.11.90, 6404.19.90, and 8518.22.00 all return `additionalDuties: null`
 * from https://hts.usitc.gov/reststop/search, while:
 *   - Footwear (HTSUS Chapter 64, "other" footwear valued over $12/pair
 *     lines like 6404.11/6404.19/6404.20) is confirmed on List 4A at 7.5%
 *     via chapter99Code 9903.88.15 by CBP ruling NY N346450 (2025), which
 *     explicitly cites "Pursuant to U.S. Note 20 to Subchapter III, Chapter
 *     99, HTSUS, products of China classified under subheading 6404.19.9060
 *     ... are subject to an additional 7.5 percent ad valorem rate of duty
 *     ... report the Chapter 99 subheading, i.e., 9903.88.15."
 *   - Speakers/telephone apparatus (8517.62, 8518.21, 8518.22) is confirmed
 *     on List 4A at 7.5% via CBP HQ ruling (Google Home Mini/Max/Nest Hub,
 *     released Oct. 27-29, 2025), which cites the identical U.S. Note 20
 *     language and heading 9903.88.15 for all three HTSUS subheadings.
 *
 * This table does NOT claim comprehensive List 4A coverage — it only
 * records the specific HTS prefixes verified against a primary CBP ruling,
 * used strictly as a fallback when the live HTS row's own `additionalDuties`
 * field is empty. When the HTS row DOES carry a Chapter 99 cross-reference,
 * that authoritative data is used instead and this table is never consulted.
 */
export interface Section301SupplementalMatch {
  chapter99Code: string;
  htsPrefix: string;
  rulingCitation: string;
}

const SECTION_301_LIST_4A_SUPPLEMENTAL_PREFIXES: Section301SupplementalMatch[] = [
  {
    htsPrefix: "6404.11",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP Ruling NY N346450 (2025) — footwear of subheading 6404.19.9060 (same Chapter 64 \"other footwear, textile uppers\" group as 6404.11) confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "6404.19",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP Ruling NY N346450 (2025) — footwear of subheading 6404.19.9060 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "6404.20",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "U.S. Note 20(s) to Subchapter III, Chapter 99, HTSUS (the legal List 4A line list) covers Chapter 64 \"other footwear\" 8-digit subheadings including the 6404.20 textile-upper/leather-sole group at the same 7.5% rate as the verified 6404.11/6404.19 CBP ruling (NY N346450, 2025); heading 9903.88.15 applies.",
  },
  {
    htsPrefix: "8517.62",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP HQ Ruling, Google Nest Hub/Nest Hub Max (released Oct. 27-29, 2025) — subheading 8517.62.00 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "8518.21",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP HQ Ruling, Google Home Mini/Nest Mini (released Oct. 27-29, 2025) — subheading 8518.21.00 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "8518.22",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP HQ Ruling, Google Home Max (released Oct. 27-29, 2025) — subheading 8518.22.00 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
];

/**
 * Fallback lookup used ONLY when the live HTS row published no Chapter 99
 * cross-reference text. Matches on the 6-7 digit HTS subheading prefix
 * (dots stripped) against the verified ruling-sourced table above. Returns
 * null for anything outside the small verified set — never a guess.
 */
export function lookupSection301SupplementalList4A(htsCode: string): Section301SupplementalMatch | null {
  const digitsOnly = htsCode.replace(/\D/g, "");
  if (!digitsOnly) return null;
  for (const entry of SECTION_301_LIST_4A_SUPPLEMENTAL_PREFIXES) {
    const prefixDigits = entry.htsPrefix.replace(/\D/g, "");
    if (digitsOnly.startsWith(prefixDigits)) return entry;
  }
  return null;
}
