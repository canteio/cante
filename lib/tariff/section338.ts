/**
 * Section 338 (Tariff Act of 1930, 19 U.S.C. 1338) — Canada-specific
 * additional duties, imposed July 20, 2026 and effective Aug 22, 2026.
 *
 * Three parallel presidential proclamations (alcoholic beverages, dairy,
 * motor vehicles/consumer goods basket) each impose a 50% ad valorem duty
 * on an enumerated list of Canadian-origin HTS lines, under Chapter 99
 * headings 9903.03.12 (alcohol), 9903.03.13 (dairy), and 9903.03.14 (motor
 * vehicle basket). This is deliberately scoped to a verified subset of
 * each basket's enumerated lines, extracted directly from the proclamation
 * Annex II PDFs (see section338-annexes.json), rather than the hand-picked
 * broad prefixes a prior version of this module used.
 *
 * Primary sources:
 * - Proclamation 11046 of July 20, 2026 ("...With Respect to Alcoholic
 *   Beverages"), 91 FR 46640 (July 23, 2026, doc 2026-14991) — heading
 *   9903.03.12, Annex II.
 * - Proclamation 11047 of July 20, 2026 ("...With Respect to Dairy") —
 *   heading 9903.03.13, FR doc 2026-14992, Annex II.
 * - Proclamation 11048 of July 20, 2026 ("...With Respect to Motor
 *   Vehicles") — heading 9903.03.14, FR doc 2026-14997, Annex II.
 * - Effective date: 12:01 a.m. ET Aug 19, 2026 per the proclamations;
 *   actually first collected Aug 22, 2026 after a 3-day suspension under
 *   Proclamation 11056 (Aug 18, 2026) lapsed without a deal — per CBP CSMS
 *   #69606660 (Aug 21, 2026) and CRS Report R49349 (Sept 14, 2026).
 * - Modification effective Sept 15, 2026 (Proclamation of Sept 8, 2026,
 *   FR doc 2026-18838): per the 2026-10-06 tariff audit (TARIFF_AUDIT.md),
 *   this modification does NOT renumber any of the three headings — a
 *   prior version of this file incorrectly claimed 9903.03.12 renumbered
 *   to 9903.03.13 on Sept 15, which this module no longer asserts. The
 *   same amendment removes the broad 8-digit 2208.30.60 and 2208.70.00
 *   alcohol lines (replacing them with narrower 10-digit sublines this
 *   module does not hold with primary-source confidence) and adds further
 *   classifications whose basket/line-level assignment the 2026-10-06
 *   audit could not fully verify. Rather than guess, this module returns
 *   null (unresolved, never a confident match) for:
 *     (a) 2208.30.60.xx / 2208.70.00.xx on or after Sept 15, 2026, and
 *     (b) any HTS line only found in the audit's unverified
 *         "septemberAlcoholAdditions" bucket, regardless of date.
 * - Import ban effective Sept 29, 2026: three further Sept 8, 2026
 *   proclamations convert each basket from a 50% duty to an outright
 *   import exclusion, effective 12:01 a.m. ET Sept 29, 2026 — Proclamation
 *   11061 (alcohol, 91 FR 58311, FR doc 2026-18835), Proclamation 11062
 *   (dairy, 91 FR 58319, FR doc 2026-18836), Proclamation 11063 (motor
 *   vehicles, FR doc 2026-18837). Each proclamation's clause (2) keeps
 *   goods imported (arrived), but not yet entered for consumption or
 *   withdrawn from warehouse, before Sept 29 at the 50% duty rate instead
 *   of the ban — so the pivot is import/arrival date, which is exactly
 *   this module's existing importDate input. Cante does NOT have each
 *   proclamation's ban Annex (which HTS lines moved from duty to ban is
 *   not the same enumerated set as the original duty annex), so this
 *   module cannot tell whether a specific matched line is banned outright
 *   or still only dutiable on or after that date — see
 *   isSection338ImportBanDateAmbiguous below, which the caller (stack.ts)
 *   uses to withhold a confident rate rather than guess 50% on a line that
 *   may actually be prohibited.
 *
 * Scope, stated plainly: this table covers the lines explicitly enumerated
 * in the Annex II PDFs for each basket's ORIGINAL (pre-Sept-15) scope —
 * 63 alcohol + 52 dairy + 439 motor-vehicle-basket = 554 eight/ten-digit
 * lines total, i.e. the full original combined annex as extracted from
 * the three Annex II PDFs (not a hand-picked subset of it, unlike the
 * prior version of this file). It is NOT the Sept 15, 2026 amended annex:
 * the two lines the amendment explicitly removed from broad alcohol
 * coverage (2208.30.60.xx, 2208.70.00.xx) are withheld as unresolved
 * on/after that date (see ALCOHOL_BROAD_LINES_REMOVED_DATE below), and the
 * amendment's additions (the JSON file's "septemberAlcoholAdditions"
 * bucket) are deliberately not wired in, pending primary-source
 * confirmation of exact basket/line assignment. Any Canada-origin HTS
 * code not in this table is left unresolved (see stack.ts's
 * notEvaluated list) — never silently treated as untaxed.
 *
 * Each basic proclamation's own carve-out excludes goods already subject
 * to Section 232 (steel/aluminum/autos) and civil-aircraft articles under
 * HTSUS General Note 6 — stack.ts only applies Section 338 when no
 * Section 232 basic or derivative measure already matched the same code.
 * IMPORTANT per the 2026-10-06 audit (TARIFF_AUDIT.md): the Sept 15, 2026
 * amendment (FR doc 2026-18838) explicitly permits the ALCOHOL basket's
 * duty to stack with Section 232 — the dairy/motor exclusions remain, but
 * a blanket 232/338 exclusion is stale for alcohol on/after that date.
 * This module exposes isAlcoholSection232StackUnresolved(measure,
 * importDate) so stack.ts's combination logic can route an alcohol-basket
 * code that also matched Section 232, on/after that date, to an explicit
 * unresolved state instead of silently keeping the old exclusion. This
 * module itself does not decide that routing — it has no visibility into
 * whether Section 232 matched the same code.
 */

import { easternIsoDate } from "@/lib/tariff/date";
import section338Annexes from "@/lib/tariff/section338-annexes.json";

export type Section338Basket = "alcohol" | "dairy" | "motor_vehicle_basket";

export interface Section338Measure {
  basket: Section338Basket;
  chapter99Code: string;
  ratePercent: number;
  effectiveDate: string;
  federalRegisterCitations: string[];
  note: string;
  /**
   * True when the given import date is on or after the Sept 29, 2026
   * ban-conversion date, meaning this basket's 50% duty may have been
   * replaced outright by an import exclusion for the goods' specific
   * HTS line — Cante does not hold the ban Annex, so the ratePercent
   * above must be treated as unresolved (not a confident 50% figure)
   * whenever this is true. See isSection338ImportBanDateAmbiguous.
   */
  banDateAmbiguous: boolean;
  /** Citation for the relevant basket's import-ban proclamation, present only when banDateAmbiguous is true. */
  banCitation: string | null;
}

const CHAPTER_99_BY_BASKET: Record<Section338Basket, string> = {
  alcohol: "9903.03.12",
  dairy: "9903.03.13",
  motor_vehicle_basket: "9903.03.14",
};

const BASKET_LABELS: Record<Section338Basket, string> = {
  alcohol: "Section 338 — Canada alcoholic beverages basket",
  dairy: "Section 338 — Canada dairy basket",
  motor_vehicle_basket: "Section 338 — Canada motor-vehicle-proclamation consumer/industrial basket",
};

const RATE = 0.5;
const INITIAL_EFFECTIVE_DATE = "2026-08-22"; // actual first-collection date after the Aug 18 suspension lapsed
/**
 * Sept 15, 2026 — effective date of the amendment that (per the 2026-10-06
 * audit) removes broad 8-digit coverage of 2208.30.60 and 2208.70.00 from
 * the alcohol basket without introducing a verified narrower replacement
 * in this module. Used only to gate those two lines to unresolved
 * (null) on/after this date — it does not renumber any heading.
 */
const ALCOHOL_BROAD_LINES_REMOVED_DATE = "2026-09-15";
const ALCOHOL_LINES_REMOVED_ON_AMENDMENT = ["22083060", "22087000"];
/**
 * 12:01 a.m. ET Sept 29, 2026 — the date on which Proclamations 11061
 * (alcohol), 11062 (dairy), and 11063 (motor vehicles) convert each
 * basket's 50% duty into an outright import exclusion for goods imported
 * (arrived) on or after this date. Goods imported before this date, even
 * if entered later, remain at the 50% duty rate per each proclamation's
 * clause (2) — so this is an import/arrival-date test, not an entry-date
 * test, matching this module's existing importDate semantics.
 */
const IMPORT_BAN_DATE = "2026-09-29";

const CITATIONS_BY_BASKET: Record<Section338Basket, string[]> = {
  alcohol: [
    "Proclamation 11046 of July 20, 2026 (91 FR 46640, FR doc 2026-14991) — imposing additional duties to offset Canadian discrimination re: alcoholic beverages, heading 9903.03.12, effective 12:01 a.m. ET Aug 19, 2026, Annex II",
    "CBP CSMS #69606660 (Aug 21, 2026) — guidance confirming actual first-collection date of Aug 22, 2026 after the 3-day Aug 18 suspension (Proclamation 11056) lapsed without a deal",
  ],
  dairy: [
    "Proclamation 11047 of July 20, 2026 (FR doc 2026-14992) — imposing additional duties to offset Canadian discrimination re: dairy, heading 9903.03.13, effective 12:01 a.m. ET Aug 19, 2026 (actual collection Aug 22, 2026 per CBP CSMS #69606660), Annex II",
  ],
  motor_vehicle_basket: [
    "Proclamation 11048 of July 20, 2026 (FR doc 2026-14997) — imposing additional duties to offset Canadian discrimination re: motor vehicles, heading 9903.03.14, effective 12:01 a.m. ET Aug 19, 2026 (actual collection Aug 22, 2026 per CBP CSMS #69606660), Annex II",
  ],
};

/**
 * Import-ban proclamation citations, by basket — the three Sept 8, 2026
 * proclamations (effective Sept 29, 2026) that convert each basket from a
 * 50% duty to an outright import exclusion. Surfaced only in the
 * unresolved explanation path (isSection338ImportBanDateAmbiguous), never
 * merged into CITATIONS_BY_BASKET, since this module cannot confirm
 * whether a specific matched line is actually in the ban Annex.
 */
const IMPORT_BAN_CITATIONS_BY_BASKET: Record<Section338Basket, string> = {
  alcohol: "Proclamation 11061 of Sept 8, 2026 (91 FR 58311, FR doc 2026-18835)",
  dairy: "Proclamation 11062 of Sept 8, 2026 (91 FR 58319, FR doc 2026-18836)",
  motor_vehicle_basket: "Proclamation 11063 of Sept 8, 2026 (FR doc 2026-18837)",
};

function digits(code: string): string {
  return code.replace(/\D/g, "");
}

/**
 * Lines extracted verbatim from each proclamation's Annex II (see
 * section338-annexes.json for sources/line counts), normalized to
 * digits-only for prefix matching. Deliberately excludes the JSON file's
 * "septemberAlcoholAdditions" bucket: the 2026-10-06 audit could not
 * confirm with primary-source confidence which basket/date those lines
 * actually belong to, so they are not wired in here — an unlisted code
 * stays unresolved (null) rather than guessed.
 */
const BASKET_LINES: Record<Section338Basket, string[]> = {
  alcohol: (section338Annexes.alcohol as string[]).map(digits),
  dairy: (section338Annexes.dairy as string[]).map(digits),
  motor_vehicle_basket: (section338Annexes.motor_vehicle_basket as string[]).map(digits),
};

/**
 * True when the given import/arrival date is on or after the Sept 29,
 * 2026 ban-conversion date for Section 338 Canada baskets. A null date is
 * treated as "imported today" using the US/Eastern calendar date, matching
 * this module's other date comparisons.
 */
export function isSection338ImportBanDateAmbiguous(importDate: string | null): boolean {
  const checkDate = importDate ?? easternIsoDate();
  return checkDate >= IMPORT_BAN_DATE;
}

/**
 * Look up whether a Canada-origin HTS code is one of the verified Section
 * 338 lines extracted from the Annex II PDFs. Returns null for anything
 * outside that verified table — this module never guesses whether an
 * unlisted Canadian HTS code is covered by the actual combined annex.
 *
 * Section 338 duties exclude articles already subject to Section 232
 * (steel/aluminum/autos) per each proclamation's clause (2) — the caller
 * (stack.ts) is responsible for not calling this when a Section 232 basic
 * or derivative measure already matched, since that exclusion depends on
 * cross-module state this function does not have.
 *
 * @param importDate ISO date (YYYY-MM-DD) the goods are/were imported, or
 *   null to use today's US/Eastern date. Used to flag banDateAmbiguous and
 *   to withhold the two alcohol lines removed from broad coverage by the
 *   Sept 15, 2026 amendment — it never otherwise changes which basket/rate
 *   table row is selected, since the 50%-duty rate itself has not changed
 *   since Aug 22, 2026.
 */
export function lookupSection338(
  htsCode: string,
  countryOfOrigin: string,
  importDate: string | null = null,
): Section338Measure | null {
  if (countryOfOrigin.trim().toUpperCase() !== "CA") return null;
  const code = digits(htsCode);
  if (!code) return null;

  let basket: Section338Basket | null = null;
  for (const b of Object.keys(BASKET_LINES) as Section338Basket[]) {
    if (BASKET_LINES[b].some((line) => code.startsWith(line))) {
      basket = b;
      break;
    }
  }
  if (!basket) return null;

  const checkDate = importDate ?? easternIsoDate();
  if (
    basket === "alcohol" &&
    checkDate >= ALCOHOL_BROAD_LINES_REMOVED_DATE &&
    ALCOHOL_LINES_REMOVED_ON_AMENDMENT.some((line) => code.startsWith(line))
  ) {
    // The Sept 15, 2026 amendment removed broad coverage of this line;
    // this module does not hold a verified narrower replacement, so the
    // only honest answer for entries on/after that date is unresolved.
    return null;
  }

  const banDateAmbiguous = isSection338ImportBanDateAmbiguous(importDate);
  const chapter99Code = CHAPTER_99_BY_BASKET[basket];

  return {
    basket,
    chapter99Code,
    ratePercent: RATE,
    effectiveDate: INITIAL_EFFECTIVE_DATE,
    federalRegisterCitations: CITATIONS_BY_BASKET[basket],
    note: `${BASKET_LABELS[basket]}: 50% ad valorem additional duty on top of Column 1 base duty, imposed under 19 U.S.C. 1338 to offset Canadian trade discrimination. First collected ${INITIAL_EFFECTIVE_DATE} (not the nominal Aug 19 effective date — a 3-day suspension lapsed without a deal). Reported under heading ${chapter99Code}. This duty does not apply if the code is also subject to Section 232 steel/aluminum/auto duties, or is civil aircraft under HTSUS General Note 6 — those exclusions are not independently re-verified by this lookup.${banDateAmbiguous ? ` For goods imported on or after ${IMPORT_BAN_DATE}, this 50% rate may have been replaced by an outright import ban under ${IMPORT_BAN_CITATIONS_BY_BASKET[basket]} — Cante does not hold that proclamation's ban Annex, so whether this specific HTS line is banned or still dutiable cannot be confirmed here; treat ratePercent as unresolved, not a confident 50%.` : ""}`,
    banDateAmbiguous,
    banCitation: banDateAmbiguous ? IMPORT_BAN_CITATIONS_BY_BASKET[basket] : null,
  };
}

/**
 * True when a matched Section 338 alcohol-basket measure, combined with an
 * already-matched Section 232 measure on the same code, falls on/after the
 * Sept 15, 2026 amendment date — meaning the two measures may now stack
 * (per TARIFF_AUDIT.md) rather than the Section 232 match excluding
 * Section 338 outright. Only the alcohol basket is affected; dairy and
 * motor-vehicle-basket exclusions are unchanged by the amendment. Exported
 * so stack.ts's combination logic is directly unit-testable without
 * depending on a real HTS code that happens to sit in both an alcohol
 * Annex II line and a Section 232 steel/aluminum heading (no such code
 * exists in the currently verified tables, but the amendment's rule is
 * written in terms of the basket and date, not any specific overlap).
 */
export function isAlcoholSection232StackUnresolved(
  measure: Section338Measure | null,
  importDate: string | null,
): boolean {
  if (!measure || measure.basket !== "alcohol") return false;
  const checkDate = importDate ?? easternIsoDate();
  return checkDate >= ALCOHOL_BROAD_LINES_REMOVED_DATE;
}

export function isSection338ImportDateResolved(importDate: string | null): boolean {
  return importDate === null || importDate >= INITIAL_EFFECTIVE_DATE;
}

export { INITIAL_EFFECTIVE_DATE as SECTION_338_EFFECTIVE_DATE, IMPORT_BAN_DATE as SECTION_338_IMPORT_BAN_DATE };
