/**
 * Section 232 steel & aluminum "basic article" (non-derivative) tariff table.
 *
 * Trade compliance discovery interviews (2026-10-01) named Section 232 as
 * one of the components importers' spreadsheets have to track by hand. This file is
 * the first real Section 232 reference data in Cante — deliberately scoped
 * to the part of the measure that is a flat, enumerable list rather than a
 * sprawling per-product Chapter 99 catalogue.
 *
 * **Scope, stated plainly.** Section 232 steel and aluminum tariffs cover
 * two very differently-shaped sets of goods:
 *   1. "Basic" (unwrought/unprocessed) steel (HTSUS Chapter 73's precursor
 *      Chapter 72 and early Chapter 73 headings) and aluminum (Chapter 76)
 *      articles — a fixed, enumerated list of headings published once in
 *      the implementing Federal Register notices and essentially stable.
 *   2. "Derivative" articles — manufactured goods (e.g. washing machines,
 *      furniture, fasteners) that merely *contain* steel or aluminum, where
 *      only the steel/aluminum *content value* (not the full article value)
 *      is dutiable, and BIS keeps adding individual HTSUS codes to this list
 *      through its ongoing "inclusions process" (407 codes added just in
 *      the August 2025 round).
 *
 * This module computes the basic-article list and one explicitly bounded
 * derivative subset: the eleven appliance/welded-wire-rack classifications
 * added effective June 23, 2025. It does not claim to cover the full or
 * actively expanding derivative list.
 *
 * Primary sources for the basic-article list and current rate:
 * - Steel: Proclamation 10896 (Feb 10, 2025) implemented at 90 FR 11249
 *   (Mar 5, 2025), new HTSUS headings 9903.81.87/9903.81.88, 25% ad valorem,
 *   effective Mar 12, 2025. Heading list and the three Chapter 72/73.7216
 *   exclusions are verified against the CBP steel HTS list PDF
 *   (content.govdelivery.com/attachments/USDHSCBP/2025/03/11/... steelHTSlist).
 * - Aluminum: Proclamation 10895 (Feb 10, 2025) implemented at 90 FR 11251
 *   (Mar 5, 2025), new heading 9903.85.02, 25% ad valorem (raised from the
 *   original 2018 10%), effective Mar 12, 2025. Heading list verified
 *   against the CBP aluminum HTS list PDF (.../2025/03/07/... aluminumHTSlist).
 * - Rate increase to 50%: Proclamation 10947 of June 3, 2025 ("Adjusting
 *   Imports of Aluminum and Steel Into the United States"), 90 FR 24199
 *   (June 9, 2025), effective 12:01 a.m. EDT June 4, 2025 — applies to both
 *   steel and aluminum basic and derivative articles, all countries except
 *   the United Kingdom.
 * - United Kingdom carve-out: the US-UK Economic Prosperity Deal, folded
 *   into Proclamation 10947's UK-specific headings (steel 9903.81.94/.95;
 *   the aluminum counterpart is structured the same way) — UK-origin steel
 *   and aluminum remain at 25% ad valorem rather than 50%, conditioned on a
 *   minimum UK-sourced content percentage CRS's June 2026 update puts at
 *   95%. That content-qualification test is NOT re-verified here; a UK
 *   claim is quoted at 25% with that caveat stated.
 */

export type Section232Category = "steel" | "aluminum";

export interface Section232BasicArticleMatch {
  category: Section232Category;
  /** Current in-force ad valorem rate for this country, as a fraction. */
  ratePercent: number;
  chapter99Code: string;
  label: string;
  federalRegisterCitations: string[];
  note: string;
}

export interface Section232DerivativeMeasure {
  category: Section232Category;
  /** Current rate applied to the metal content value, never to the full shipment value. */
  ratePercent: number;
  /** Chronological rate changes used when an import date is supplied. */
  rateHistory: Array<{ effectiveDate: string; ratePercent: number }>;
  chapter99Code: string;
  effectiveDate: string;
  contentValueField: "steelContentValue" | "aluminumContentValue";
  label: string;
  citations: string[];
  note: string;
}

export interface Section232DerivativeMatch {
  htsPrefix: string;
  measures: Section232DerivativeMeasure[];
}

/**
 * Chapter 73 steel headings covered as "basic" (non-derivative) articles
 * under HTSUS subdivision (j) of U.S. note 16 to chapter 99 subchapter III
 * (the 9903.81.87/88 list). 6-digit heading prefixes; `digits()` comparison
 * matches any statistical suffix under them.
 */
const STEEL_BASIC_HEADINGS = [
  "7206",
  "7207",
  "7208",
  "7209",
  "7210",
  "7211",
  "7212",
  "7213",
  "7214",
  "7215",
  "7216",
  "7217",
  "7218",
  "7219",
  "7220",
  "7221",
  "7222",
  "7223",
  "7224",
  "7225",
  "7226",
  "7227",
  "7228",
  "7229",
  "730110",
  "730210",
  "730240",
  "730290",
  "7304",
  "7305",
  "7306",
];

/** Three 7216 subheadings explicitly excepted from the basic-article list. */
const STEEL_BASIC_EXCLUSIONS = ["721661", "721669", "721691"];

/**
 * Chapter 76 aluminum headings covered as "basic" (non-derivative) articles
 * under HTSUS subdivision (g) of U.S. note 19 (the 9903.85.02 list).
 */
const ALUMINUM_BASIC_HEADINGS = [
  "7601",
  "7604",
  "7605",
  "7606",
  "7607",
  "7608",
  "7609",
  "76169951", // castings and forgings of aluminum, subheading 7616.99.51 only
];

const UK_COUNTRY_CODE = "GB";
const BASE_RATE = 0.5;
const UK_RATE = 0.25;
const STEEL_DERIVATIVE_EFFECTIVE_DATE = "2025-06-23";
const ALUMINUM_WIRE_RACK_EFFECTIVE_DATE = "2025-03-12";

/**
 * Verified June 23, 2025 steel-derivative tranche. Eight-digit entries match
 * every statistical suffix. Welded wire rack is limited to the published
 * ten-digit statistical reporting number.
 */
const JUNE_2025_STEEL_DERIVATIVE_PREFIXES = [
  "84181000",
  "84183000",
  "84184000",
  "84221100",
  "84501100",
  "84502000",
  "84512100",
  "84512900",
  "85098020",
  "85166040",
  "9403999020",
];

const WELDED_WIRE_RACK_PREFIX = "9403999020";

function digits(code: string): string {
  return code.replace(/\D/g, "");
}

function matchesList(codeDigits: string, headings: string[]): boolean {
  return headings.some((heading) => codeDigits.startsWith(heading));
}

/**
 * Determine whether an HTS code is one of the enumerated Section 232
 * "basic article" steel or aluminum headings, and if so, the current
 * in-force rate for the given country of origin.
 *
 * Returns `null` for any code outside the enumerated basic-article lists —
 * including every Section 232 *derivative* product code, which this module
 * deliberately does not attempt to resolve (see module doc).
 */
export function lookupSection232BasicArticle(
  htsCode: string,
  countryOfOrigin: string,
): Section232BasicArticleMatch | null {
  const code = digits(htsCode);
  if (!code) return null;
  const country = countryOfOrigin.trim().toUpperCase();

  const isSteel = matchesList(code, STEEL_BASIC_HEADINGS) && !matchesList(code, STEEL_BASIC_EXCLUSIONS);
  const isAluminum = !isSteel && matchesList(code, ALUMINUM_BASIC_HEADINGS);

  if (!isSteel && !isAluminum) return null;

  const category: Section232Category = isSteel ? "steel" : "aluminum";
  const isUK = country === UK_COUNTRY_CODE;
  const ratePercent = isUK ? UK_RATE : BASE_RATE;

  if (category === "steel") {
    return {
      category,
      ratePercent,
      chapter99Code: isUK ? "9903.81.94/9903.81.95" : "9903.81.87/9903.81.88",
      label: "Section 232 — steel (basic article)",
      federalRegisterCitations: isUK
        ? [
            "90 FR 11249 (March 5, 2025) — Proclamation 10896, initial 25% steel tariff",
            "90 FR 24199 (June 9, 2025) — Proclamation 10947, United Kingdom held at 25% under the US-UK Economic Prosperity Deal rather than raised to 50%",
          ]
        : [
            "90 FR 11249 (March 5, 2025) — Proclamation 10896, initial 25% ad valorem effective 2025-03-12",
            "90 FR 24199 (June 9, 2025) — Proclamation 10947, increased to 50% ad valorem effective 2025-06-04",
          ],
      note: isUK
        ? "UK-origin steel is quoted at 25%, conditioned on the UK-sourced-content threshold the US-UK Economic Prosperity Deal requires (reported ~95% by CRS as of mid-2026) — that content test is NOT independently verified here."
        : "50% ad valorem on the full value of the basic (non-derivative) steel article, covering HTSUS chapter 72/73 headings enumerated in subdivision (j) of U.S. note 16 to chapter 99 subchapter III, except the three 7216.61/.69/.91 subheadings carved back out.",
    };
  }

  return {
    category,
    ratePercent,
    chapter99Code: "9903.85.02",
    label: "Section 232 — aluminum (basic article)",
    federalRegisterCitations: isUK
      ? [
          "90 FR 11251 (March 5, 2025) — Proclamation 10895, initial 25% aluminum tariff",
          "90 FR 24199 (June 9, 2025) — Proclamation 10947, United Kingdom held at 25% under the US-UK Economic Prosperity Deal rather than raised to 50%",
        ]
      : [
          "90 FR 11251 (March 5, 2025) — Proclamation 10895, raised to 25% ad valorem effective 2025-03-12",
          "90 FR 24199 (June 9, 2025) — Proclamation 10947, increased to 50% ad valorem effective 2025-06-04",
        ],
    note: isUK
      ? "UK-origin aluminum is quoted at 25%, conditioned on the UK-sourced-content threshold the US-UK Economic Prosperity Deal requires (reported ~95% by CRS as of mid-2026) — that content test is NOT independently verified here."
      : "50% ad valorem on the full value of the basic (non-derivative) aluminum article, covering HTSUS chapter 76 headings enumerated in subdivision (g) of U.S. note 19 to chapter 99 subchapter III.",
  };
}

/**
 * Match only the verified appliance/welded-wire-rack derivative subset. This
 * function intentionally does not imply that codes outside this table escape
 * Section 232 derivative duties.
 */
export function lookupSection232Derivative(
  htsCode: string,
  countryOfOrigin: string,
): Section232DerivativeMatch | null {
  const code = digits(htsCode);
  const htsPrefix = JUNE_2025_STEEL_DERIVATIVE_PREFIXES.find((prefix) => code.startsWith(prefix));
  if (!htsPrefix) return null;

  const isUK = countryOfOrigin.trim().toUpperCase() === UK_COUNTRY_CODE;
  const ratePercent = isUK ? UK_RATE : BASE_RATE;
  const steelMeasure: Section232DerivativeMeasure = {
    category: "steel",
    ratePercent,
    rateHistory: [{ effectiveDate: STEEL_DERIVATIVE_EFFECTIVE_DATE, ratePercent }],
    chapter99Code: isUK ? "9903.81.98" : "9903.81.91",
    effectiveDate: STEEL_DERIVATIVE_EFFECTIVE_DATE,
    contentValueField: "steelContentValue",
    label: "Section 232 — steel derivative content",
    citations: [
      "90 FR 25208 (June 16, 2025) — appliance and welded-wire-rack steel derivatives, effective 2025-06-23",
      "CBP CSMS #65441222 — 50% of steel content value (25% for United Kingdom), corrected UK heading 9903.81.98",
    ],
    note: `The ${(ratePercent * 100).toFixed(0)}% rate applies to the supplied dutiable steel content value, not the article's full customs value. The caller must exclude any content qualifying for the U.S.-melted-and-poured exception described in 90 FR 25208.`,
  };

  const measures = [steelMeasure];
  if (code.startsWith(WELDED_WIRE_RACK_PREFIX)) {
    measures.push({
      category: "aluminum",
      ratePercent,
      rateHistory: isUK
        ? [{ effectiveDate: ALUMINUM_WIRE_RACK_EFFECTIVE_DATE, ratePercent: UK_RATE }]
        : [
            { effectiveDate: ALUMINUM_WIRE_RACK_EFFECTIVE_DATE, ratePercent: 0.25 },
            { effectiveDate: "2025-06-04", ratePercent: BASE_RATE },
          ],
      chapter99Code: isUK ? "9903.85.15" : "9903.85.08",
      effectiveDate: ALUMINUM_WIRE_RACK_EFFECTIVE_DATE,
      contentValueField: "aluminumContentValue",
      label: "Section 232 — aluminum derivative content",
      citations: [
        "90 FR 11251 (March 5, 2025) — aluminum derivatives effective 2025-03-12",
        "90 FR 24199 (June 9, 2025) — current 50% rate (25% for United Kingdom)",
        "90 FR 25208 and CBP CSMS #65441222 — 9403.99.9020 continues to be subject for its aluminum content",
      ],
      note: "The applicable historical rate applies separately to the aluminum content value, not the article's full customs value.",
    });
  }

  return { htsPrefix, measures };
}
