import { quoteDuty, type DutyQuote } from "@/lib/tariff/rates";
import {
  extractChapter99Refs,
  lookupSection301Measure,
  type Section301Measure,
} from "@/lib/tariff/section301";
import { lookupSection232BasicArticle } from "@/lib/tariff/section232";
import { lookupAdCvdAdvisories, type AdCvdAdvisory } from "@/lib/tariff/adcvd";

/**
 * The tariff-stacking engine.
 *
 * This is the tool Kate Chang (Toro Company, customer-discovery interview
 * 2026-10-01) described almost verbatim: upload an HTS code + country of
 * origin, get back the total stacked rate broken down by component, with an
 * explicit explanation of what stacked with what and why, citing the
 * Federal Register notice behind each component.
 *
 * **Scope of this pass.** Three stackable components are computed for real:
 *   1. Base/Column 1 duty — from the live USITC HTS schedule (lib/tariff/rates.ts).
 *   2. China Section 301 — resolved from the HTS row's own Chapter 99
 *      cross-reference against lib/tariff/section301.ts's verified table of
 *      List 1-4A measures (which countries and rates these are, Federal
 *      Register citations, effective dates).
 *   3. Section 232 steel/aluminum "basic article" tariffs — resolved from a
 *      fixed, enumerated list of Chapter 72/73/76 headings against
 *      lib/tariff/section232.ts, at the current 50% rate (25% for UK
 *      origin under the Economic Prosperity Deal). Section 232 *derivative*
 *      products (manufactured goods merely containing steel/aluminum, e.g.
 *      washing machines or furniture) are NOT covered — BIS's derivative
 *      list is actively expanding via its "inclusions process" and
 *      presenting a snapshot of it as complete would be exactly the
 *      fabricated-coverage failure this project refuses to make. See
 *      lib/tariff/section232.ts's module doc for the full scope statement.
 *
 * Everything else Kate named — USMCA/FTA rules-of-origin qualification
 * beyond a claimed programme symbol, full AD/CVD scope/rate determination
 * (this module surfaces AD/CVD as a named, uncomputed advisory lead — see
 * lib/tariff/adcvd.ts for why a dollar figure is never fabricated there),
 * forced-labor (UFLPA) measures, and Section 232 derivative products — is
 * NOT computed here yet and is returned as an explicit `notEvaluated` list
 * naming exactly what is missing, per the project rule that an unverified
 * figure must never be presented as a real one. Real accuracy on what this
 * module does cover beats a fabricated total.
 */

export interface StackedDutyComponent {
  type: "base" | "section301" | "section232";
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
  /** Named AD/CVD leads to verify against the order's actual scope text — never a computed amount. */
  adCvdAdvisories: AdCvdAdvisory[];
}

const STANDING_NOT_EVALUATED = [
  "Section 232 steel/aluminum derivative-product tariffs (BIS's actively-expanding inclusions list is not covered — only the fixed 'basic article' heading list is)",
  "USMCA/FTA rules-of-origin qualification beyond a claimed programme symbol (no certificate-of-origin analysis performed)",
  "Anti-dumping/countervailing duty (AD/CVD) exact scope/rate determination (named leads surfaced in adCvdAdvisories below are advisory only, never a computed amount)",
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
  /**
   * ISO date (YYYY-MM-DD) the goods are/were imported. Every measure this
   * module resolves already carries its own effective date in its
   * reference table (Section 301/232 current in-force rates only), so this
   * input does not change which table row is picked — it exists so a past-
   * or future-dated entry gets an explicit caveat instead of silently being
   * quoted at today's rate as if it always applied.
   */
  importDate?: string | null;
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

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  let importDate: string | null = null;
  if (input.importDate) {
    if (ISO_DATE.test(input.importDate) && !Number.isNaN(Date.parse(input.importDate))) {
      importDate = input.importDate;
    } else {
      stackingExplanation.push(
        `Import date "${input.importDate}" is not a usable ISO date (YYYY-MM-DD), so it was ignored. Every rate below reflects today's current in-force rate, not the rate in effect on any particular historical or future date.`,
      );
    }
  } else {
    stackingExplanation.push(
      "No import date was given. Every rate below reflects today's current in-force rate. Section 301 and Section 232 rates have changed over time (see each component's effective date and citations) — a shipment that actually entered on an earlier or later date may owe a different stacked rate than shown here.",
    );
  }

  const USMCA_COUNTRIES = ["MX", "CA"];
  if (USMCA_COUNTRIES.includes(country) && !input.claimedProgramme) {
    stackingExplanation.push(
      `Country of origin is ${country === "MX" ? "Mexico" : "Canada"}. Goods that qualify under USMCA rules of origin may be entitled to the special (preferential) rate instead of the general rate quoted above — no programme symbol was claimed here, so the general rate was used. Run the goods through the USMCA tariff-shift/RVC qualification engine (lib/tariff/usmca.ts) before assuming either rate; Cante does not infer qualification from country of origin alone.`,
    );
  }

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
      if (importDate && importDate < measure.effectiveDate) {
        stackingExplanation.push(
          `${measure.list} (${measure.chapter99Code}) is cross-referenced on this row, but its current rate did not take effect until ${measure.effectiveDate}, after the given import date ${importDate}. An earlier rate may have applied instead — this is NOT included in the total below; verify the rate actually in force on ${importDate} against the citations (${measure.federalRegisterCitations.join("; ")}).`,
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

  const section232Match = lookupSection232BasicArticle(base.htsCode, country);
  if (section232Match) {
    const amount =
      input.value !== null ? Number((input.value * section232Match.ratePercent).toFixed(2)) : null;
    components.push({
      type: "section232",
      label: section232Match.label,
      ratePercent: section232Match.ratePercent,
      amount,
      citation: section232Match.federalRegisterCitations,
      explanation: `${section232Match.note} Applies because HTS ${base.htsCode} is enumerated as a basic (non-derivative) ${section232Match.category} article under Chapter 99 heading ${section232Match.chapter99Code}. Stacks ON TOP of (adds to, does not replace) the Column 1 base duty above.`,
    });
    stackingExplanation.push(
      `${section232Match.label} (${section232Match.chapter99Code}, ${(section232Match.ratePercent * 100).toFixed(1)}%) stacks additively on top of the Column 1 base duty — Section 232 duties are assessed in addition to other applicable duties, per the imposing proclamations (${section232Match.federalRegisterCitations.join("; ")}).`,
    );
  }

  const allAdValoremResolved = components.every((c) => c.ratePercent !== null) && unresolvedMeasures.length === 0;
  const totalRatePercent = allAdValoremResolved
    ? Number(components.reduce((sum, c) => sum + (c.ratePercent ?? 0), 0).toFixed(6))
    : null;

  const allAmountsResolved = components.every((c) => c.amount !== null) && unresolvedMeasures.length === 0;
  const totalAmount = allAmountsResolved
    ? Number(components.reduce((sum, c) => sum + (c.amount ?? 0), 0).toFixed(2))
    : null;

  const adCvdAdvisories = lookupAdCvdAdvisories(base.htsCode, country);
  if (adCvdAdvisories.length > 0) {
    for (const advisory of adCvdAdvisories) {
      stackingExplanation.push(
        `AD/CVD lead (not included in the total above): ${advisory.title} (${advisory.caseNumbers.join(" / ")}) commonly cites HTS prefixes overlapping ${base.htsCode}. ${advisory.scopeNote} Verify against the order's actual scope language and the specific exporter's rate at access.trade.gov before relying on this — the all-others rate as of ${advisory.asOfDeterminationCitation} was ${(advisory.allOthersRatePercent).toFixed(2)}%, but exporter-specific rates can differ materially.`,
      );
    }
  }

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
    adCvdAdvisories,
  };
}
