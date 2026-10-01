import { quoteDuty, type DutyQuote } from "@/lib/tariff/rates";
import {
  extractChapter99Refs,
  lookupSection301Measure,
  type Section301Measure,
} from "@/lib/tariff/section301";

/**
 * The tariff-stacking engine.
 *
 * This is the tool Kate Chang (Toro Company, customer-discovery interview
 * 2026-10-01) described almost verbatim: upload an HTS code + country of
 * origin, get back the total stacked rate broken down by component, with an
 * explicit explanation of what stacked with what and why, citing the
 * Federal Register notice behind each component.
 *
 * **Scope of this first pass.** Two stackable components are computed for
 * real:
 *   1. Base/Column 1 duty — from the live USITC HTS schedule (lib/tariff/rates.ts).
 *   2. China Section 301 — resolved from the HTS row's own Chapter 99
 *      cross-reference against lib/tariff/section301.ts's verified table of
 *      List 1-4A measures (which countries and rates these are, Federal
 *      Register citations, effective dates).
 *
 * Everything else Kate named — Section 232 steel/aluminum/derivative
 * status, USMCA/FTA rules-of-origin qualification beyond a claimed
 * programme symbol, AD/CVD scope, and forced-labor (UFLPA) measures — is
 * NOT computed here yet and is returned as an explicit `notEvaluated` list
 * naming exactly what is missing, per the project rule that an unverified
 * figure must never be presented as a real one. Real accuracy on what this
 * module does cover beats a fabricated total.
 */

export interface StackedDutyComponent {
  type: "base" | "section301";
  label: string;
  ratePercent: number | null;
  /** Null when the component could not be computed (and totalPercent then can't be fully computed either). */
  amount: number | null;
  citation: string[];
  explanation: string;
}

export interface StackedDutyResult {
  htsCode: string;
  countryOfOrigin: string;
  /** Sum of every resolved component's ad valorem rate, as a fraction. Null if any component is unresolved. */
  totalRatePercent: number | null;
  /** Sum of every resolved component's dollar amount, when a shipment value was given. */
  totalAmount: number | null;
  currency: "USD";
  components: StackedDutyComponent[];
  /** Plain-English stacking logic: what stacked with what, and why (or why not). */
  stackingExplanation: string[];
  /** Compliance areas this result does NOT evaluate — named, not silently omitted. */
  notEvaluated: string[];
  /** Chapter 99 cross-references on the HTS row that we found but have no verified data for. */
  unresolvedMeasures: string[];
}

const STANDING_NOT_EVALUATED = [
  "Section 232 steel/aluminum/auto-derivative tariffs (not yet in the reference table)",
  "USMCA/FTA rules-of-origin qualification beyond a claimed programme symbol (no certificate-of-origin analysis performed)",
  "Anti-dumping/countervailing duty (AD/CVD) scope determinations",
  "Forced-labor measures (e.g. UFLPA detentions/withhold-release orders)",
];

export interface StackDutyInput {
  htsCode: string;
  /** ISO-ish 2-letter country of origin, e.g. "CN", "MX". Section 301 only applies to "CN". */
  countryOfOrigin: string;
  value: number | null;
  quantity?: number | null;
  unit?: string | null;
  claimedProgramme?: string | null;
  signal?: AbortSignal;
}

export async function computeStackedDuty(input: StackDutyInput): Promise<StackedDutyResult | null> {
  const country = input.countryOfOrigin.trim().toUpperCase();

  const base: DutyQuote | null = await quoteDuty({
    htsCode: input.htsCode,
    value: input.value,
    quantity: input.quantity,
    unit: input.unit,
    claimedProgramme: input.claimedProgramme,
    signal: input.signal,
  });
  if (!base) return null;

  const components: StackedDutyComponent[] = [];
  const stackingExplanation: string[] = [];
  const unresolvedMeasures: string[] = [];

  components.push({
    type: "base",
    label: `Column 1 ${base.column === "special" ? "special (FTA/preference)" : base.column === "column2" ? "column 2" : "general (NTR)"} duty`,
    ratePercent: base.rate.parsed ? (base.rate.adValorem ?? (base.rate.free ? 0 : null)) : null,
    amount: base.computation.amount,
    citation: ["19 U.S.C. § 1202, HTSUS Column 1/2 as published by USITC"],
    explanation: base.caveats.join(" "),
  });

  const refs = extractChapter99Refs(base.additionalDutiesNote);

  if (country !== "CN") {
    if (refs.length > 0) {
      stackingExplanation.push(
        `This HTS row cross-references Chapter 99 measure(s) ${refs.join(", ")}, but the declared country of origin is "${country}", not China — the China Section 301 List measures only apply to goods of Chinese origin, so none of them stack onto this shipment.`,
      );
    } else {
      stackingExplanation.push(
        `No Chapter 99 cross-reference was published on this HTS row, and country of origin "${country}" is not China, so no Section 301 measure applies.`,
      );
    }
  } else if (refs.length === 0) {
    stackingExplanation.push(
      "Country of origin is China, but the HTS row published no Chapter 99 cross-reference, so no Section 301 List measure applies to this code.",
    );
  } else {
    for (const ref of refs) {
      const measure: Section301Measure | null = lookupSection301Measure(ref);
      if (!measure) {
        unresolvedMeasures.push(ref);
        stackingExplanation.push(
          `HTS row cross-references Chapter 99 measure ${ref}, which Cante does not yet have verified reference data for. This is NOT included in the total — treat the total below as a floor, not the full stacked rate.`,
        );
        continue;
      }
      if (measure.status === "suspended" || measure.ratePercent === null) {
        stackingExplanation.push(
          `${measure.list} (${measure.chapter99Code}) is cross-referenced on this row but was suspended and never took effect (${measure.federalRegisterCitations.join("; ")}), so it does not stack.`,
        );
        continue;
      }
      const amount =
        base.computation.amount !== null && input.value !== null
          ? Number((input.value * measure.ratePercent).toFixed(2))
          : null;
      components.push({
        type: "section301",
        label: measure.list,
        ratePercent: measure.ratePercent,
        amount,
        citation: measure.federalRegisterCitations,
        explanation: `${measure.note} Applies because the HTS row cross-references ${measure.chapter99Code} and country of origin is China (CN). Stacks ON TOP of (adds to, does not replace) the Column 1 base duty above.`,
      });
      stackingExplanation.push(
        `${measure.list} (${measure.chapter99Code}, ${(measure.ratePercent * 100).toFixed(1)}%, effective ${measure.effectiveDate}) stacks additively on top of the Column 1 base duty — Section 301 duties are assessed "in addition to all other applicable duties," per the imposing notices (${measure.federalRegisterCitations.join("; ")}).`,
      );
    }
  }

  const allAdValoremResolved = components.every((c) => c.ratePercent !== null) && unresolvedMeasures.length === 0;
  const totalRatePercent = allAdValoremResolved
    ? Number(components.reduce((sum, c) => sum + (c.ratePercent ?? 0), 0).toFixed(6))
    : null;

  const allAmountsResolved = components.every((c) => c.amount !== null) && unresolvedMeasures.length === 0;
  const totalAmount = allAmountsResolved
    ? Number(components.reduce((sum, c) => sum + (c.amount ?? 0), 0).toFixed(2))
    : null;

  return {
    htsCode: base.htsCode,
    countryOfOrigin: country,
    totalRatePercent,
    totalAmount,
    currency: "USD",
    components,
    stackingExplanation,
    notEvaluated: STANDING_NOT_EVALUATED,
    unresolvedMeasures,
  };
}
