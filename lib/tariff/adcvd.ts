/**
 * AD/CVD (Antidumping / Countervailing Duty) advisory lookup.
 *
 * Importers frequently name AD/CVD scope determination as one of their
 * three stated automation priorities. This module is deliberately NOT a
 * stacked dollar component like Section 301/232 — and that is a scope
 * decision, not an oversight. Every AD/CVD order ever published states that
 * its HTS numbers are "provided for convenience and customs purposes only;
 * the written product description... is dispositive" — Commerce's own scope
 * language controls, not the HTS code. On top of that, the cash-deposit
 * rate is not one number: it is exporter-specific (and sometimes importer-
 * specific) and changes with every administrative review, so printing "the"
 * rate for a case would misstate what AD/CVD liability actually is.
 *
 * What this CAN do honestly: flag that a shipment's HTS code falls inside
 * a small set of real, currently-active, verified AD/CVD orders' commonly-
 * cited HTS prefixes, name the case number and the all-others/PRC-wide rate
 * as of a specific, cited administrative determination, and say in plain
 * terms that this is a lead to verify against the order's actual scope
 * language and the exporter's specific rate — never a computed duty.
 *
 * Deliberately small: this table is not a substitute for Commerce's
 * ~700-order ADCVD Search tool at https://access.trade.gov. Everything not
 * in this table is named in `stack.ts`'s `notEvaluated` list, not silently
 * treated as clear.
 */

export interface AdCvdOrder {
  /** Commerce case number(s), e.g. "A-570-979" (antidumping) / "C-570-980" (countervailing). */
  caseNumbers: string[];
  title: string;
  country: string;
  /** HTS prefixes commonly cited in the order's own "HTS numbers provided for convenience" list. Advisory only. */
  htsPrefixes: string[];
  /** The all-others / PRC-wide (or case-specific non-individually-reviewed) rate, as of the cited determination. Exporter-specific rates can differ materially. */
  allOthersRatePercent: number;
  asOfDeterminationCitation: string;
  scopeNote: string;
}

export const AD_CVD_ORDERS: AdCvdOrder[] = [
  {
    "caseNumbers": [
      "A-570-909"
    ],
    "title": "Certain Steel Nails",
    "country": "CN",
    "htsPrefixes": [
      "73170055",
      "73170065",
      "73170075",
      "79070060"
    ],
    "allOthersRatePercent": 118.04,
    "asOfDeterminationCitation": "90 FR 25220 (June 16, 2025): https://www.govinfo.gov/content/pkg/FR-2025-06-16/html/2025-10947.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-05-01/html/2025-07582.htm",
    "scopeNote": "China-wide AD cash-deposit rate. Scope includes dimensional and product exclusions; HTS overlap alone does not establish coverage. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-570-932"
    ],
    "title": "Steel Threaded Rod",
    "country": "CN",
    "htsPrefixes": [
      "73181550",
      "7318152095"
    ],
    "allOthersRatePercent": 206,
    "asOfDeterminationCitation": "85 FR 26668 (May 5, 2020): https://www.govinfo.gov/content/pkg/FR-2020-05-05/pdf/FR-2020-05-05.pdf; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-07-22/pdf/FR-2025-07-22.pdf",
    "scopeNote": "China-wide AD cash-deposit rate. Nonheaded steel rod with threading over more than 25 percent of its length; composition and specification exclusions require scope review. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-570-967"
    ],
    "title": "Aluminum Extrusions",
    "country": "CN",
    "htsPrefixes": [
      "76042100",
      "76042910",
      "76042930",
      "76042950",
      "76082000",
      "76090000",
      "76101000",
      "76109000"
    ],
    "allOthersRatePercent": 86.01,
    "asOfDeterminationCitation": "90 FR 33368 (July 17, 2025): https://www.govinfo.gov/content/pkg/FR-2025-07-17/html/2025-13389.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2022-11-02/pdf/FR-2022-11-02.pdf",
    "scopeNote": "China-wide AD cash-deposit rate, not the separate CVD rate. Alloy series, finished merchandise and kit exclusions require review of the written scope. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-570-890"
    ],
    "title": "Wooden Bedroom Furniture",
    "country": "CN",
    "htsPrefixes": [
      "94035090"
    ],
    "allOthersRatePercent": 216.01,
    "asOfDeterminationCitation": "90 FR 44801 (September 17, 2025): https://www.govinfo.gov/content/pkg/FR-2025-09-17/pdf/FR-2025-09-17.pdf; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-08-12/pdf/2026-16448.pdf",
    "scopeNote": "China-wide AD cash-deposit rate. Wooden bedroom furniture only; excluded products include wooden cribs. HTS scope reference: https://www.govinfo.gov/content/pkg/FR-2026-04-13/html/2026-07114.htm Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-570-084"
    ],
    "title": "Certain Quartz Surface Products",
    "country": "CN",
    "htsPrefixes": [
      "68109900",
      "68109100"
    ],
    "allOthersRatePercent": 326.15,
    "asOfDeterminationCitation": "86 FR 43520 (August 9, 2021): https://www.govinfo.gov/content/pkg/FR-2021-08-09/html/2021-16911.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-01-30/html/2025-01946.htm",
    "scopeNote": "China-wide AD cash-deposit rate; do not substitute the unadjusted dumping margin. Engineered quartz scope and glass/natural-stone exclusions control. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-570-092"
    ],
    "title": "Mattresses",
    "country": "CN",
    "htsPrefixes": [
      "940421",
      "940429"
    ],
    "allOthersRatePercent": 1731.75,
    "asOfDeterminationCitation": "84 FR 68395 (December 16, 2019): https://www.govinfo.gov/content/pkg/FR-2019-12-16/html/2019-27166.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-05-28/pdf/2025-09559.pdf",
    "scopeNote": "China-wide AD cash-deposit rate. Youth/adult mattress dimensions, construction and exclusions control; this is not a rate for every exporter. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-557-818"
    ],
    "title": "Mattresses",
    "country": "MY",
    "htsPrefixes": [
      "940421",
      "940429"
    ],
    "allOthersRatePercent": 42.92,
    "asOfDeterminationCitation": "86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm",
    "scopeNote": "All-others AD cash-deposit rate as of the original order. Youth/adult mattress construction, dimensions and exclusions control. The 2026 sunset-review institution confirms the order was in place, not that every original exporter rate remains unchanged. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-801-002"
    ],
    "title": "Mattresses",
    "country": "RS",
    "htsPrefixes": [
      "940421",
      "940429"
    ],
    "allOthersRatePercent": 112.11,
    "asOfDeterminationCitation": "86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm",
    "scopeNote": "All-others AD cash-deposit rate as of the original order. Youth/adult mattress construction, dimensions and exclusions control. The 2026 sunset-review institution confirms the order was in place, not that every original exporter rate remains unchanged. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-489-841"
    ],
    "title": "Mattresses",
    "country": "TR",
    "htsPrefixes": [
      "940421",
      "940429"
    ],
    "allOthersRatePercent": 20.03,
    "asOfDeterminationCitation": "86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm",
    "scopeNote": "All-others AD cash-deposit rate as of the original order. Youth/adult mattress construction, dimensions and exclusions control. The 2026 sunset-review institution confirms the order was in place, not that every original exporter rate remains unchanged. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    "caseNumbers": [
      "A-552-827"
    ],
    "title": "Mattresses",
    "country": "VN",
    "htsPrefixes": [
      "940421",
      "940429"
    ],
    "allOthersRatePercent": 668.38,
    "asOfDeterminationCitation": "86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm",
    "scopeNote": "Vietnam-wide AD cash-deposit rate as of the original order. Youth/adult mattress construction, dimensions and exclusions control. The 2026 sunset-review institution confirms the order was in place, not that every original exporter rate remains unchanged. Historical cited benchmark only: verify current exporter instructions before entry; never a computed duty."
  },
  {
    caseNumbers: ["A-570-979", "C-570-980"],
    title: "Crystalline Silicon Photovoltaic Cells (whether or not assembled into modules) from China",
    country: "CN",
    htsPrefixes: ["854142"],
    allOthersRatePercent: 2.38, // AD "PRC-wide" rate per the original order; CVD varies by review — flagged as advisory.
    asOfDeterminationCitation:
      "77 FR 73018 (Dec. 7, 2012) — AD order; 77 FR 73017 (Dec. 7, 2012) — CVD order; continued under 91 FR 44821 (July 17, 2026) circumvention inquiry on Ethiopia/Vietnam-assembled cells.",
    scopeNote:
      "Scope covers crystalline silicon photovoltaic cells and modules/laminates/panels from China, with product-description tests (silicon wafer origin, assembly location) that an HTS code alone cannot resolve — including an active circumvention inquiry into China-made cells assembled in Ethiopia or Vietnam.",
  },
  {
    caseNumbers: ["A-570-970", "C-570-971"],
    title: "Multilayered Wood Flooring from China",
    country: "CN",
    htsPrefixes: ["441291"], // commonly-cited HTSUS heading for assembled multilayer flooring panels; order text controls.
    allOthersRatePercent: 21.97, // most recent published non-selected-company CVD rate (2021 POR); AD rate is separate and exporter-specific.
    asOfDeterminationCitation:
      "76 FR 76690 (Dec. 8, 2011) — AD order; 76 FR 76693 (Dec. 8, 2011) — CVD order; continued under 88 FR 45142 (July 14, 2023); CVD non-selected rate per 89 FR 41939 (May 14, 2024, 2021 POR review).",
    scopeNote:
      "Scope covers multilayered wood flooring composed of two or more glued wood veneer plies with a core, with explicit species/certification exclusions the HTS code cannot encode.",
  },
];

function digits(code: string): string {
  return code.replace(/\D/g, "");
}

export interface AdCvdAdvisory extends AdCvdOrder {
  /** Always false — this module never computes a dutiable amount, by design (see module doc). */
  computed: false;
}

/**
 * Returns every AD/CVD order in the table whose advisory HTS prefix
 * overlaps the given code AND whose country matches — never a computed
 * rate, only a lead to verify.
 */
export function lookupAdCvdAdvisories(htsCode: string, countryOfOrigin: string): AdCvdAdvisory[] {
  const code = digits(htsCode);
  const country = countryOfOrigin.trim().toUpperCase();
  if (!code) return [];

  return AD_CVD_ORDERS.filter(
    (order) => order.country === country && order.htsPrefixes.some((prefix) => code.startsWith(prefix)),
  ).map((order) => ({ ...order, computed: false }));
}
