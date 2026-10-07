/**
 * Section 338 (Tariff Act of 1930, 19 U.S.C. 1338) — Canada-specific
 * additional duties, imposed July 20, 2026 and effective Aug 22, 2026.
 *
 * Three parallel presidential proclamations (alcoholic beverages, dairy,
 * motor vehicles/consumer goods basket) each impose a 50% ad valorem duty
 * on an enumerated list of Canadian-origin HTS lines, under new Chapter 99
 * headings 9903.03.12 (alcohol, later renumbered 9903.03.13 on 2026-09-15),
 * 9903.03.13 (dairy, originally; folded into the alcohol/other-goods
 * heading by the September modification — see note below), and 9903.03.14
 * (motor vehicle basket). This is the first new stacking component added
 * since Section 301/232, and it is deliberately scoped small and verified
 * rather than attempting the full multi-hundred-line annex.
 *
 * Primary sources:
 * - Proclamation 11046 of July 20, 2026 ("...With Respect to Alcoholic
 *   Beverages"), 91 FR 46640 (July 23, 2026, doc 2026-14991) — original
 *   heading 9903.03.12, Annex II listing dairy/alcohol/other goods.
 * - Proclamation 11047 of July 20, 2026 ("...With Respect to Dairy") —
 *   original heading 9903.03.13, FR doc 2026-14992.
 * - Proclamation 11048 of July 20, 2026 ("...With Respect to Motor
 *   Vehicles") — heading 9903.03.14, FR doc 2026-14997, Annex II (439
 *   eight-digit lines, chiefly non-vehicle consumer/industrial goods per
 *   Global Trade Alert's independent line count; standard passenger-vehicle
 *   and auto-parts HTS codes are NOT in this basket — they already sit
 *   under the pre-existing Section 232 automotive regime and are expressly
 *   excluded from Section 338 by clause (2) of each proclamation).
 * - Effective date: 12:01 a.m. ET Aug 19, 2026 per the proclamations;
 *   actually first collected Aug 22, 2026 after a 3-day suspension under
 *   Proclamation 11056 (Aug 18, 2026) lapsed without a deal — per CBP CSMS
 *   #69606660 (Aug 21, 2026) and CRS Report R49349 (Sept 14, 2026).
 * - Modification effective Sept 15, 2026 (Proclamation of Sept 8, 2026,
 *   91 FR 58312-ish, doc 2026-18838): renumbers the dairy/alcohol heading
 *   from 9903.03.12 to 9903.03.13, adds cheese/fat/hide/fur/motorboat
 *   lines, and removes two bulk-whisky/liqueur lines.
 *
 * Scope, stated plainly: this table covers a small, verified subset of
 * each basket's enumerated HTS lines (the ones the primary-source Annex
 * text and secondary legal/trade-press summaries explicitly confirm),
 * NOT the full ~554-line combined annex. Any Canada-origin HTS code not
 * in this table is left unresolved (see stack.ts's notEvaluated list) —
 * never silently treated as untaxed.
 *
 * Every Section 338 duty excludes goods already subject to Section 232
 * (steel/aluminum/autos) and civil-aircraft articles under HTSUS General
 * Note 6 — this module checks the Section 232 exclusion by deferring to
 * the caller (stack.ts only applies Section 338 when no Section 232 basic
 * or derivative measure already matched the same code).
 */

export type Section338Basket = "alcohol" | "dairy" | "motor_vehicle_basket";

export interface Section338Measure {
  basket: Section338Basket;
  /** Chapter 99 heading in force as of the given check date — see effectiveHeadings. */
  chapter99Code: string;
  ratePercent: number;
  effectiveDate: string;
  federalRegisterCitations: string[];
  note: string;
}

interface Section338TableEntry {
  htsPrefix: string;
  basket: Section338Basket;
  /** True once the Sept 15, 2026 renumbering (9903.03.12 -> 9903.03.13) applies to this line. */
  renumberedSept2026: boolean;
}

/**
 * Verified Canada-origin HTS lines, by basket. Dots stripped for prefix
 * matching. Deliberately small: these are the specific lines independently
 * confirmed across the White House Annex PDFs, EY/Dentons legal summaries,
 * and trade-press annex breakdowns (gingercontrol.com, gildispatch.com) —
 * not the full several-hundred-line schedule.
 */
const SECTION_338_LINES: Section338TableEntry[] = [
  // Alcoholic beverages (Annex II to Proclamation 11046).
  { htsPrefix: "220830", basket: "alcohol", renumberedSept2026: true }, // whisky
  { htsPrefix: "220870", basket: "alcohol", renumberedSept2026: true }, // liqueurs/cordials
  { htsPrefix: "220421", basket: "alcohol", renumberedSept2026: true }, // wine, containers <=2L
  // Dairy (Annex to Proclamation 11047 / folded into 9903.03.13).
  { htsPrefix: "040210", basket: "dairy", renumberedSept2026: true }, // milk/cream powder
  { htsPrefix: "040221", basket: "dairy", renumberedSept2026: true },
  { htsPrefix: "040410", basket: "dairy", renumberedSept2026: true }, // whey
  { htsPrefix: "040610", basket: "dairy", renumberedSept2026: true }, // fresh cheese (Sept 2026 addition)
  { htsPrefix: "040620", basket: "dairy", renumberedSept2026: true }, // grated/powdered cheese (Sept 2026 addition)
  { htsPrefix: "040630", basket: "dairy", renumberedSept2026: true }, // processed cheese (Sept 2026 addition)
  // Motor-vehicle-basket consumer/industrial goods (Annex II to Proclamation
  // 11048 — the 439-line basket that is NOT actually vehicles/auto parts).
  { htsPrefix: "940529", basket: "motor_vehicle_basket", renumberedSept2026: false }, // electric lamps (Sept 2026 ADD per Annex I Part A)
  { htsPrefix: "890331", basket: "motor_vehicle_basket", renumberedSept2026: false }, // motorboats (Sept 2026 addition)
  { htsPrefix: "890332", basket: "motor_vehicle_basket", renumberedSept2026: false },
];

const BASKET_LABELS: Record<Section338Basket, string> = {
  alcohol: "Section 338 — Canada alcoholic beverages basket",
  dairy: "Section 338 — Canada dairy basket",
  motor_vehicle_basket: "Section 338 — Canada motor-vehicle-proclamation consumer/industrial basket",
};

const RATE = 0.5;
const INITIAL_EFFECTIVE_DATE = "2026-08-22"; // actual first-collection date after the Aug 18 suspension lapsed
const RENUMBER_DATE = "2026-09-15";

const CITATIONS_BY_BASKET: Record<Section338Basket, string[]> = {
  alcohol: [
    "Proclamation 11046 of July 20, 2026 (91 FR 46640, FR doc 2026-14991) — imposing additional duties to offset Canadian discrimination re: alcoholic beverages, heading 9903.03.12, effective 12:01 a.m. ET Aug 19, 2026",
    "CBP CSMS #69606660 (Aug 21, 2026) — guidance confirming actual first-collection date of Aug 22, 2026 after the 3-day Aug 18 suspension (Proclamation 11056) lapsed without a deal",
    "Proclamation of Sept 8, 2026 (FR doc 2026-18838), effective Sept 15, 2026 — renumbers heading 9903.03.12 to 9903.03.13 and modifies covered lines",
  ],
  dairy: [
    "Proclamation 11047 of July 20, 2026 (FR doc 2026-14992) — imposing additional duties to offset Canadian discrimination re: dairy, effective 12:01 a.m. ET Aug 19, 2026 (actual collection Aug 22, 2026 per CBP CSMS #69606660)",
    "Proclamation of Sept 8, 2026 (FR doc 2026-18838), effective Sept 15, 2026 — folds dairy into heading 9903.03.13 and adds cheese lines (0406.10/.20/.30)",
  ],
  motor_vehicle_basket: [
    "Proclamation 11048 of July 20, 2026 (FR doc 2026-14997) — imposing additional duties to offset Canadian discrimination re: motor vehicles, heading 9903.03.14, effective 12:01 a.m. ET Aug 19, 2026 (actual collection Aug 22, 2026 per CBP CSMS #69606660)",
    "Proclamation of Sept 8, 2026 (FR doc 2026-18838), Annex I Part A — adds further lines effective Sept 15, 2026",
  ],
};

function digits(code: string): string {
  return code.replace(/\D/g, "");
}

/**
 * Look up whether a Canada-origin HTS code is one of the verified Section
 * 338 lines. Returns null for anything outside the small verified table —
 * this module never guesses whether an unlisted Canadian HTS code is
 * covered by the actual ~554-line combined annex.
 *
 * Section 338 duties exclude articles already subject to Section 232
 * (steel/aluminum/autos) per each proclamation's clause (2) — the caller
 * (stack.ts) is responsible for not calling this when a Section 232 basic
 * or derivative measure already matched, since that exclusion depends on
 * cross-module state this function does not have.
 */
export function lookupSection338(htsCode: string, countryOfOrigin: string): Section338Measure | null {
  if (countryOfOrigin.trim().toUpperCase() !== "CA") return null;
  const code = digits(htsCode);
  if (!code) return null;

  const entry = SECTION_338_LINES.find((line) => code.startsWith(line.htsPrefix));
  if (!entry) return null;

  return {
    basket: entry.basket,
    chapter99Code: entry.renumberedSept2026 ? "9903.03.13" : "9903.03.14",
    ratePercent: RATE,
    effectiveDate: INITIAL_EFFECTIVE_DATE,
    federalRegisterCitations: CITATIONS_BY_BASKET[entry.basket],
    note: `${BASKET_LABELS[entry.basket]}: 50% ad valorem additional duty on top of Column 1 base duty, imposed under 19 U.S.C. 1338 to offset Canadian trade discrimination. First collected ${INITIAL_EFFECTIVE_DATE} (not the nominal Aug 19 effective date — a 3-day suspension lapsed without a deal). ${entry.renumberedSept2026 ? `Reported under heading 9903.03.13 as of the ${RENUMBER_DATE} renumbering (originally 9903.03.12).` : "Reported under heading 9903.03.14 (motor-vehicle-basket proclamation)."} This duty does not apply if the code is also subject to Section 232 steel/aluminum/auto duties, or is civil aircraft under HTSUS General Note 6 — those exclusions are not independently re-verified by this lookup.`,
  };
}

export function isSection338ImportDateResolved(importDate: string | null): boolean {
  return importDate === null || importDate >= INITIAL_EFFECTIVE_DATE;
}

export { INITIAL_EFFECTIVE_DATE as SECTION_338_EFFECTIVE_DATE };
