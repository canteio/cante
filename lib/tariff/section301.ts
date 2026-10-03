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
