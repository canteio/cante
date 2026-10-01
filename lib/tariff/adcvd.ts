/**
 * AD/CVD (Antidumping / Countervailing Duty) advisory lookup.
 *
 * Kate Chang (Toro Company) named AD/CVD scope determination as one of her
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
