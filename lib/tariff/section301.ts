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
      "84 FR 43304 (August 20, 2019) — initially announced 10%",
      "84 FR 45821 — raised initial collection rate to 15% effective 2019-09-01",
      "85 FR 3741 (January 22, 2020) — reduced to 7.5% effective 2020-02-14 (Phase One agreement)",
    ],
    note: "Imposed at 15% on 2019-09-01, reduced to 7.5% effective 2020-02-14 under the US-China Phase One deal. Still in force at 7.5%.",
  },
  "9903.88.04": {
    chapter99Code: "9903.88.04",
    list: "China Section 301 – List 3 (U.S. note 20(g))",
    country: "CN",
    status: "active",
    ratePercent: 0.25,
    effectiveDate: "2019-05-10",
    federalRegisterCitations: [
      "83 FR 47974 (September 21, 2018) — initial 10% effective 2018-09-24",
      "84 FR 20459 (May 9, 2019) — increased to 25% effective 2019-05-10",
    ],
    note: "Active companion List 3 heading for the subheadings enumerated in U.S. note 20(g); increased from 10% to 25% effective 2019-05-10.",
  },
  "9903.88.16": {
    chapter99Code: "9903.88.16",
    list: "China Section 301 – List 4B",
    country: "CN",
    status: "suspended",
    ratePercent: null,
    effectiveDate: "2019-12-15",
    federalRegisterCitations: ["84 FR 69447 (December 18, 2019) — suspended indefinitely as of its planned 2019-12-15 effective date"],
    note: "List 4B (Annex C of 84 FR 43304) was suspended before collection began; heading 9903.88.16 has never been active.",
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
 * Bounded fallback for rows with no additionalDuties text. Membership is
 * supported only at the exact 8- or 10-digit scope cited below; a ruling
 * about one classification is not evidence for its whole six-digit family.
 * This is not a comprehensive list or a historical rate schedule.
 */
export interface Section301SupplementalMatch {
  chapter99Code: string;
  htsPrefix: string;
  rulingCitation: string;
}

const SECTION_301_SUPPLEMENTAL_CODES: Section301SupplementalMatch[] = [
  // 6404.11 is split between active List 4A and suspended List 4B at the
  // 8-digit level. Never use a broad 6-digit 6404.11 fallback: it would
  // incorrectly assess suspended 6404.11.41/.49/.51/.59/.61/.69/.75/.85.
  ...["20", "71", "79", "81", "89", "90"].map((suffix) => ({
    htsPrefix: `6404.11.${suffix}`,
    chapter99Code: "9903.88.15",
    rulingCitation:
      "84 FR 43304, Annex A (August 20, 2019), as modified by 84 FR 45821 and 85 FR 3741 — this exact 8-digit 6404.11 subheading is in active List 4A under 9903.88.15 at 7.5%; CBP Ruling NY N346450 (2025) confirms the Chapter 64 List 4A mechanism.",
  })),
  {
    htsPrefix: "6404.19.9060",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP Ruling NY N346450 (2025) — footwear of subheading 6404.19.9060 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "8517.62.00",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP HQ Ruling, Google Nest Hub/Nest Hub Max (released Oct. 27-29, 2025) — subheading 8517.62.00 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "8518.21.00",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP HQ Ruling, Google Home Mini/Nest Mini (released Oct. 27-29, 2025) — subheading 8518.21.00 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "8518.22.00",
    chapter99Code: "9903.88.15",
    rulingCitation:
      "CBP HQ Ruling, Google Home Max (released Oct. 27-29, 2025) — subheading 8518.22.00 confirmed subject to the additional 7.5% List 4A duty under heading 9903.88.15, per U.S. Note 20 to Subchapter III, Chapter 99, HTSUS.",
  },
  {
    htsPrefix: "3916.90.30",
    chapter99Code: "9903.88.02",
    rulingCitation:
      "CBP Ruling N296007 classifies PLA/ABS 3D-printer filament under 3916.90.30.00. USITC's official China Tariffs reference list (Last Updated January 1, 2026) maps 3916.90.30 to 9903.88.02; 83 FR 40823 (August 16, 2018) imposed List 2 at 25% effective 2018-08-23.",
  },
];

/**
 * Exact cited classification lookup. Eight-digit entries include their
 * ten-digit statistical children; ten-digit rulings match only that line.
 * Incomplete, malformed, and unsupported classifications remain unresolved.
 */
export function lookupSection301Supplemental(htsCode: string): Section301SupplementalMatch | null {
  if (!/^(?:\d{8}|\d{10}|\d{4}\.\d{2}\.\d{2}(?:\.?\d{2})?)$/.test(htsCode)) return null;
  const digitsOnly = htsCode.replace(/\./g, "");
  for (const entry of SECTION_301_SUPPLEMENTAL_CODES) {
    const prefixDigits = entry.htsPrefix.replace(/\./g, "");
    if (digitsOnly === prefixDigits || (prefixDigits.length === 8 && digitsOnly.length === 10 && digitsOnly.startsWith(prefixDigits))) return entry;
  }
  return null;
}
