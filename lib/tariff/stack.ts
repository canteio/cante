import { quoteDuty, type DutyQuote } from "@/lib/tariff/rates";
import {
  extractChapter99Refs,
  lookupSection301Measure,
  lookupSection301Coverage,
  SECTION_301_COVERAGE_CITATION,
  type Section301Measure,
} from "@/lib/tariff/section301";
import {
  lookupSection232BasicArticle,
  lookupSection232Derivative,
} from "@/lib/tariff/section232";
import { lookupSection232Live } from "@/lib/tariff/section232-live";
import {
  lookupSection338,
  SECTION_338_EFFECTIVE_DATE,
  SECTION_338_IMPORT_BAN_DATE,
  isAlcoholSection232StackUnresolved,
} from "@/lib/tariff/section338";
import { lookupAdCvdAdvisories, type AdCvdAdvisory } from "@/lib/tariff/adcvd";
import { lookupUflpaAdvisories, UFLPA_SCOPE_CAVEAT, type UflpaAdvisory } from "@/lib/tariff/uflpa";
import { easternIsoDate, isStrictIsoDate } from "@/lib/tariff/date";

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
 *      cross-reference, or the comprehensive USITC China Tariffs snapshot when
 *      that field is empty, against lib/tariff/section301.ts's verified table of
 *      List 1-4A measures (which countries and rates these are, Federal
 *      Register citations, effective dates).
 *   3. Section 232 steel/aluminum tariffs — basic articles plus the bounded
 *      appliance/welded-wire-rack derivative subset added June 23, 2025. The
 *      derivative amount is computed only from caller-supplied steel/aluminum
 *      content value and is never presented as a shipment-value percentage.
 *
 * Everything else Kate named — USMCA qualification analysis (the calculator
 * accepts an explicit audited decision but does not make one), full AD/CVD
 * scope/rate determination (this module surfaces AD/CVD as a named,
 * uncomputed advisory lead — see lib/tariff/adcvd.ts for why a dollar figure
 * is never fabricated there), forced-labor (UFLPA) measures, and Section 232
 * derivative products outside the bounded verified subset — is returned in
 * `notEvaluated` rather than silently omitted.
 */

export interface StackedDutyComponent {
  type: "base" | "section301" | "section232" | "section338";
  label: string;
  /** Ad valorem rate on total shipment value. Null for content-value measures. */
  ratePercent: number | null;
  /** Assessment rate when the legal basis is a metal content value. */
  contentRatePercent?: number;
  contentValue?: number;
  contentCategory?: "steel" | "aluminum";
  /** Null when the component could not be computed. */
  amount: number | null;
  citation: string[];
  explanation: string;
}

export type UsmcaQualificationDecision = "qualifies" | "does_not_qualify";

export interface UsmcaQualificationInput {
  verified: boolean;
  decision: UsmcaQualificationDecision | null;
  details: string | null;
}

export type UsmcaQualificationAudit =
  | { status: "not_applicable" | "not_provided"; specialRateRequested: false; explanation: string }
  | {
      status: "incomplete";
      specialRateRequested: false;
      decision: UsmcaQualificationDecision | null;
      details: string | null;
      explanation: string;
    }
  | {
      status: "verified";
      specialRateRequested: boolean;
      decision: UsmcaQualificationDecision;
      details: string;
      explanation: string;
    };

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
  /** Unresolved measures from live references, snapshot coverage, or other applicability gaps. */
  unresolvedMeasures: string[];
  /** Auditable USMCA decision and whether it was allowed to request programme S. */
  usmcaQualification: UsmcaQualificationAudit;
  /** Named AD/CVD leads to verify against the order's actual scope text — never a computed amount. */
  adCvdAdvisories: AdCvdAdvisory[];
  /** FLETF high-priority UFLPA sector matches — never a forced-labor determination, see lib/tariff/uflpa.ts. */
  uflpaAdvisories: UflpaAdvisory[];
}

const SECTION232_FULL_VALUE_REGIME_EFFECTIVE_DATE = "2026-04-06";
const SECTION232_FULL_VALUE_REGIME_CITATION =
  "Presidential Proclamation, Strengthening Actions Taken to Adjust Imports of Aluminum, Steel, and Copper Into the United States (Apr. 2, 2026), clauses 1-4";

const STANDING_NOT_EVALUATED = [
  "Section 232 derivative products outside the verified June 23, 2025 appliance/welded-wire-rack subset (the BIS inclusions list is broader and actively expanding) for imports dated BEFORE 2026-04-06 -- on or after that date, the live Section 232 data pipeline covers the full current Annex I-A/I-B/II/III/IV regime for any HTS code it has ingested, superseding this bounded historical subset",
  "US-content-only (melt/pour/smelt-and-cast) reduced Section 232 rates: the live regime publishes a reduced rate for derivatives made entirely from US-origin metal, but Cante does not collect or verify metal-content-origin facts, so the base (non-US-content) rate is always quoted even when a lower rate might legally apply",
  "Russian aluminum smelt/cast exposure when Russia is not the declared country of origin (the inputs do not collect smelt/cast countries)",
  "USMCA rules-of-origin analysis (a special rate is used only from an explicit caller-supplied verified decision and supporting details)",
  "Anti-dumping/countervailing duty (AD/CVD) exact scope/rate determination (named leads surfaced in adCvdAdvisories below are advisory only, never a computed amount)",
  `Forced-labor measures (UFLPA): this engine now flags whether the HTS code falls in one of FLETF's ten HTS-mappable high-priority enforcement sectors for Chinese-origin goods (see uflpaAdvisories below) — it does NOT determine actual Xinjiang production or UFLPA Entity List membership, which requires supply-chain evidence no HTS code can supply. ${UFLPA_SCOPE_CAVEAT}`,
  "Section 338 Canada duties outside the small verified alcohol/dairy/motor-vehicle-basket HTS lines in lib/tariff/section338.ts (the actual combined annex across all three proclamations covers roughly 554 eight-digit lines; only a verified subset is resolved here)",
  "Section 338 Canada duties for goods imported on or after Sept 29, 2026: three Sept 8, 2026 proclamations convert each basket's 50% duty into an outright import ban for lines in a separate ban Annex Cante does not hold; this is reported as unresolved per matched line rather than guessed as a 50% duty or a ban (see section338.ts banDateAmbiguous)",
  "Section 338 Canada duties' Section 232 / civil-aircraft exclusion is applied only when this calculator's own Section 232 lookup already matched the same code — a code covered by Section 232 under data Cante does not have would be incorrectly stacked rather than excluded",
];

export interface StackDutyInput {
  htsCode: string;
  /** ISO-ish 2-letter country of origin, e.g. "CN", "MX". Section 301 only applies to "CN". */
  countryOfOrigin: string;
  value: number | null;
  quantity?: number | null;
  unit?: string | null;
  claimedProgramme?: string | null;
  steelContentValue?: number | null;
  aluminumContentValue?: number | null;
  usmcaQualification?: UsmcaQualificationInput | null;
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

function resolveUsmcaQualification(
  country: string,
  input: UsmcaQualificationInput | null | undefined,
): UsmcaQualificationAudit {
  if (country !== "MX" && country !== "CA") {
    return {
      status: "not_applicable",
      specialRateRequested: false,
      explanation: "USMCA preference was not considered because the declared origin is neither Mexico nor Canada.",
    };
  }

  if (!input) {
    return {
      status: "not_provided",
      specialRateRequested: false,
      explanation: `No verified USMCA qualification decision was supplied for ${country === "MX" ? "Mexico" : "Canada"}, so the Column 1 general rate was requested. Country of origin alone does not establish qualification.`,
    };
  }

  const details = input.details?.trim() || null;
  if (!input.verified || !input.decision || !details) {
    return {
      status: "incomplete",
      specialRateRequested: false,
      decision: input.decision,
      details,
      explanation: "The USMCA input was incomplete or not verified. A verified decision and supporting details are both required, so the Column 1 general rate was requested.",
    };
  }

  const specialRateRequested = input.decision === "qualifies";
  return {
    status: "verified",
    specialRateRequested,
    decision: input.decision,
    details,
    explanation: specialRateRequested
      ? `Caller verified that the goods qualify for USMCA and supplied this basis: ${details} Programme S was requested from the published USITC row.`
      : `Caller verified that the goods do not qualify for USMCA and supplied this basis: ${details} The Column 1 general rate was requested.`,
  };
}

export async function computeStackedDuty(
  input: StackDutyInput,
  section232LiveLookupFn: typeof lookupSection232Live = lookupSection232Live,
): Promise<StackedDutyResult | null> {
  const country = input.countryOfOrigin.trim().toUpperCase();
  const usmcaQualification = resolveUsmcaQualification(country, input.usmcaQualification);
  const legacyProgramme = input.claimedProgramme?.trim().toUpperCase() || null;
  const isUsmcaProgramme = legacyProgramme === "S" || legacyProgramme === "S+";
  const claimedProgramme = usmcaQualification.specialRateRequested
    ? isUsmcaProgramme
      ? legacyProgramme
      : "S"
    : isUsmcaProgramme
      ? null
      : legacyProgramme;

  const base: DutyQuote | null = await quoteDuty({
    htsCode: input.htsCode,
    value: input.value,
    quantity: input.quantity,
    unit: input.unit,
    claimedProgramme,
    signal: input.signal,
  });
  if (!base) return null;

  const components: StackedDutyComponent[] = [];
  const stackingExplanation: string[] = [];
  const unresolvedMeasures: string[] = [];

  let importDate: string | null = null;
  if (input.importDate) {
    if (isStrictIsoDate(input.importDate)) {
      importDate = input.importDate;
      const today = easternIsoDate();
      if (importDate > today) {
        unresolvedMeasures.push(`Future import date ${importDate}: rates after ${today} are not yet established`);
        stackingExplanation.push(
          `Import date ${importDate} is after today's date (${today}). Components below show only current published rates for context; aggregate totals are withheld because later legal changes cannot be known yet.`,
        );
      }
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

  stackingExplanation.push(usmcaQualification.explanation);
  if (isUsmcaProgramme && !usmcaQualification.specialRateRequested) {
    stackingExplanation.push(
      `Programme ${legacyProgramme} was present, but Cante did not send it to the USITC quote because an explicit verified USMCA qualifying decision with supporting details was not supplied.`,
    );
  }

  components.push({
    type: "base",
    label: `Column 1 ${base.column === "special" ? "special (FTA/preference)" : base.column === "column2" ? "column 2" : "general (NTR)"} duty`,
    ratePercent: base.rate.parsed && base.rate.specificAmount === null ? (base.rate.adValorem ?? (base.rate.free ? 0 : null)) : null,
    amount: base.computation.amount,
    citation: ["19 U.S.C. § 1202, HTSUS Column 1/2 as published by USITC"],
    explanation: base.caveats.join(" "),
  });

  if (!base.rate.parsed || (base.rate.specificAmount !== null && base.computation.amount === null)) {
    unresolvedMeasures.push(base.rate.specificAmount !== null
      ? `Base specific duty requires quantity in ${base.rate.specificUnit} and any required shipment value`
      : "Base duty expression could not be parsed");
  }

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
  } else {
    const coverage = !base.additionalDutiesNote?.trim()
      ? lookupSection301Coverage(input.htsCode)
      : null;
    const resolvedRefs = coverage ? [coverage.chapter99Code] : refs;
    const provenance = coverage
      ? `${SECTION_301_COVERAGE_CITATION} (matched HTS ${coverage.matchedCode})`
      : "the live HTS row's Chapter 99 cross-reference";
    if (coverage) stackingExplanation.push(`Section 301 coverage resolved from ${provenance}. The live row's additionalDuties field was empty. This snapshot requires periodic re-sync; product-specific exclusions are not evaluated.`);
    if (!resolvedRefs.length) {
      unresolvedMeasures.push("Section 301 applicability: no supported Chapter 99 reference or USITC snapshot match");
      stackingExplanation.push("Country of origin is China, but the live row has no supported Chapter 99 reference and no eligible USITC China Tariffs snapshot fallback was found. This remains unresolved, not a zero duty or an exemption.");
    }
    for (const ref of resolvedRefs) {
      const measure: Section301Measure | null = lookupSection301Measure(ref);
      if (!measure) {
        unresolvedMeasures.push(ref);
        stackingExplanation.push(
          `Coverage source (${provenance}) references Chapter 99 measure ${ref}, which Cante does not yet have verified reference data for. This is NOT included in the total — treat the total below as a floor, not the full stacked rate.`,
        );
        continue;
      }
      if (measure.status === "suspended" || measure.ratePercent === null) {
        stackingExplanation.push(
          `${measure.list} (${measure.chapter99Code}) is referenced by ${provenance} but was suspended and never took effect (${measure.federalRegisterCitations.join("; ")}), so it does not stack.`,
        );
        continue;
      }
      if (importDate && importDate < measure.effectiveDate) {
        unresolvedMeasures.push(`${measure.chapter99Code} historical rate before ${measure.effectiveDate}`);
        stackingExplanation.push(
          `${measure.list} (${measure.chapter99Code}) is referenced by ${provenance}, but its current rate did not take effect until ${measure.effectiveDate}, after the given import date ${importDate}. An earlier rate may have applied instead — this is NOT included in the total below; verify the rate actually in force on ${importDate} against the citations (${measure.federalRegisterCitations.join("; ")}).`,
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
        citation: [...measure.federalRegisterCitations, ...(coverage ? [SECTION_301_COVERAGE_CITATION] : [])],
        explanation: `${measure.note} Applies because ${provenance} identifies ${measure.chapter99Code} and country of origin is China (CN). Stacks ON TOP of (adds to, does not replace) the Column 1 base duty above.`,
      });
      stackingExplanation.push(
        `${measure.list} (${measure.chapter99Code}, ${(measure.ratePercent * 100).toFixed(1)}%, effective ${measure.effectiveDate}) stacks additively on top of the Column 1 base duty — Section 301 duties are assessed "in addition to all other applicable duties," per the imposing notices (${measure.federalRegisterCitations.join("; ")}).`,
      );
    }
  }

  // Section 232 basic articles: the live-data pipeline
  // (scripts/ingest-section232-proclamation.ts + verify-section232-
  // proposal.ts) now holds the REAL current regime (Proclamation 11021,
  // effective 2026-04-06 -- Annexes I-A/I-B/II/III/IV, which added copper
  // and restructured rates away from the flat 50%/25% steel-or-aluminum
  // scheme this static table was built on). For any CURRENT or FUTURE-
  // dated import (no importDate, or importDate on/after the live regime's
  // effective date), the live Supabase data is checked FIRST and takes
  // priority; the static table below is used only for genuinely
  // historical imports before the live regime existed. A live-lookup
  // failure is treated as unresolved, never silently as "no Section 232
  // applies" -- see Section232LiveLookupError handling.
  const LIVE_SECTION232_REGIME_START = "2026-04-06";
  const wantsLiveSection232 = !importDate || importDate >= LIVE_SECTION232_REGIME_START;
  let liveSection232Match: Awaited<ReturnType<typeof lookupSection232Live>> = null;
  let liveSection232Failed: string | null = null;
  if (wantsLiveSection232) {
    try {
      liveSection232Match = await section232LiveLookupFn(base.htsCode, input.signal);
    } catch (error) {
      liveSection232Failed = error instanceof Error ? error.message : "Live Section 232 lookup failed.";
    }
  }

  if (liveSection232Failed) {
    // Degrade, don't refuse: matches this codebase's established pattern
    // (lib/impact/assess.ts: "a tariff outage costs one field, not the
    // assessment"). Universally nulling totalAmount/totalRatePercent for
    // EVERY duty calculation whenever the live Section 232 store is
    // briefly unreachable -- even for an unrelated product like wire
    // cable -- is a real availability regression the static table never
    // had. Fall back to the 2025-vintage static table instead, with an
    // explicit staleness caveat, so a transient outage degrades data
    // freshness, not correctness-of-availability.
    stackingExplanation.push(
      `Section 232 live data was unreachable (${liveSection232Failed}); falling back to a known-outdated static reference table rather than withholding every duty figure on this shipment. Re-run after live data is restored to confirm Section 232 treatment under the current regime.`,
    );
  } else if (liveSection232Match) {
    const isUk = country === "GB";
    const rate = isUk && liveSection232Match.ukRatePercent !== null ? liveSection232Match.ukRatePercent : liveSection232Match.ratePercent;
    components.push({
      type: "section232",
      label: `Section 232 — ${liveSection232Match.annex} (current regime)`,
      ratePercent: rate,
      amount: input.value !== null ? Number((input.value * rate).toFixed(2)) : null,
      citation: [`${liveSection232Match.sourceTitle}, ${liveSection232Match.sourceDocumentNumber} (${liveSection232Match.sourcePdfUrl})`],
      explanation: `${liveSection232Match.annex} under the current Section 232 regime (effective ${LIVE_SECTION232_REGIME_START}): ${(rate * 100).toFixed(1)}% on full customs value${isUk ? " (United Kingdom rate)" : ""}. US-content-only derivatives may qualify for a reduced rate (${liveSection232Match.usContentRatePercent !== null ? `${(liveSection232Match.usContentRatePercent * 100).toFixed(0)}%` : "not published for this annex"}) -- not applied here because melt/pour/smelt-and-cast content origin was not supplied.`,
    });
    stackingExplanation.push(
      `${liveSection232Match.annex} (current regime, effective ${LIVE_SECTION232_REGIME_START}) stacks additively on top of the Column 1 base duty at ${(rate * 100).toFixed(1)}%, sourced from ${liveSection232Match.sourceDocumentNumber} via Cante's auto-verified Section 232 data pipeline.`,
    );
  }

  // Skip the legacy static basic-article table only when live data
  // actually resolved this code (avoid double-counting). On a live-
  // lookup FAILURE, fall through to the static table as a degraded-but-
  // available fallback -- see the liveSection232Failed branch above.
  const section232Match = liveSection232Match ? null : lookupSection232BasicArticle(base.htsCode, country);
  if (section232Match) {
    // Basic (non-derivative) articles were never touched by the April 2026
    // proclamation — that change is documented (see STANDING_NOT_EVALUATED)
    // as affecting derivative assessment only, so no post-regime gate applies
    // here. Russian aluminum still needs separate evaluation regardless of
    // date, and a date before the initial effective date is unresolved.
    const reason = section232Match.category === "aluminum" && country === "RU"
      ? "Russian aluminum treatment requires separate evaluation."
      : importDate && importDate < "2025-03-12"
        ? "Section 232 historical treatment before 2025-03-12 is unresolved."
        : null;
    // No import date means "imported today" — use the current in-force rate
    // lookupSection232BasicArticle already returned. A date between the
    // initial 25% effective date and the June 2025 rate increase uses 25%.
    const rate = reason
      ? null
      : importDate && importDate < "2025-06-04"
        ? 0.25
        : section232Match.ratePercent;
    if (reason) unresolvedMeasures.push(`${section232Match.chapter99Code}: ${reason}`);
    components.push({
      type: "section232",
      label: section232Match.label,
      ratePercent: rate,
      amount: rate !== null && input.value !== null ? Number((input.value * rate).toFixed(2)) : null,
      citation: section232Match.federalRegisterCitations,
      explanation: reason ?? `Section 232 basic ${section232Match.category} article: ${rate! * 100}% on full customs value${importDate ? ` for ${importDate}` : " (today's current in-force rate; no import date was given)"}. ${country === "GB" ? section232Match.note : ""}`,
    });
    stackingExplanation.push(reason ?? `${section232Match.label} (${section232Match.chapter99Code}) stacks additively on top of the Column 1 base duty at ${rate! * 100}%, per the imposing proclamations (${section232Match.federalRegisterCitations.join("; ")}).`);
  }

  // Skip the legacy static derivative table only when live data actually
  // resolved this code (avoid double-counting). On a live-lookup
  // FAILURE, fall through to the static table as a degraded-but-
  // available fallback, consistent with the basic-article gate above.
  const section232Derivative = liveSection232Match ? null : lookupSection232Derivative(base.htsCode, country);
  if (section232Derivative) {
    const steelContentValue = input.steelContentValue ?? null;
    const aluminumContentValue = input.aluminumContentValue ?? null;
    const combinedContentValue = (steelContentValue ?? 0) + (aluminumContentValue ?? 0);

    for (const measure of section232Derivative.measures) {
      if (importDate && importDate < measure.effectiveDate && !(measure.category === "aluminum" && country === "RU")) {
        stackingExplanation.push(
          `${measure.label} under ${measure.chapter99Code} did not take effect until ${measure.effectiveDate}, after the given import date ${importDate}, so this measure was not added. Verify any other Section 232 measure that may have applied on the entry date.`,
        );
        continue;
      }

      if (!importDate || importDate >= SECTION232_FULL_VALUE_REGIME_EFFECTIVE_DATE) {
        const reason = !importDate
          ? `An import date is required because Section 232 derivative treatment changed on ${SECTION232_FULL_VALUE_REGIME_EFFECTIVE_DATE}.`
          : `The verified content-value rule is not used on or after ${SECTION232_FULL_VALUE_REGIME_EFFECTIVE_DATE}; a later proclamation changed assessment to full customs value and revised the covered-product annexes and rates.`;
        unresolvedMeasures.push(`${measure.chapter99Code} entry-date Section 232 treatment for HTS ${base.htsCode}`);
        components.push({
          type: "section232",
          label: measure.label,
          ratePercent: null,
          contentCategory: measure.category,
          amount: null,
          citation: [...measure.citations, SECTION232_FULL_VALUE_REGIME_CITATION],
          explanation: `${reason} This bounded calculator therefore withholds the measure and aggregate totals instead of extending the 2025 content-value rule beyond its verified date range.`,
        });
        stackingExplanation.push(reason);
        continue;
      }

      if (measure.category === "aluminum" && country === "RU") {
        unresolvedMeasures.push(`Russian aluminum derivative treatment for HTS ${base.htsCode}`);
        components.push({
          type: "section232",
          label: measure.label,
          ratePercent: null,
          contentCategory: measure.category,
          amount: null,
          citation: [...measure.citations, "CBP CSMS #64348288 (Mar. 7, 2025), Duties for Aluminum from Russia"],
          explanation: "Russian-origin aluminum derivatives were subject to a separate 200% full-entered-value regime during this period. This bounded content-value calculator does not compute that regime, so the measure and aggregate totals are withheld.",
        });
        stackingExplanation.push(
          "The declared country is Russia, so the ordinary aluminum-content derivative rate cannot be used. The separate Russian aluminum regime must be evaluated before a legal total is shown.",
        );
        continue;
      }

      const applicableRate = [...measure.rateHistory]
        .reverse()
        .find((period) => importDate >= period.effectiveDate)?.ratePercent ?? measure.ratePercent;
      const contentValue = measure.contentValueField === "steelContentValue"
        ? steelContentValue
        : aluminumContentValue;
      const contentInvalid =
        contentValue !== null &&
        (!Number.isFinite(contentValue) ||
          contentValue < 0 ||
          (input.value !== null && contentValue > input.value) ||
          (input.value !== null && combinedContentValue > input.value));
      const unresolvedLabel = `${measure.chapter99Code} ${measure.category} content value for HTS ${base.htsCode}`;

      if (contentValue === null || contentInvalid) {
        unresolvedMeasures.push(unresolvedLabel);
        components.push({
          type: "section232",
          label: measure.label,
          ratePercent: null,
          contentRatePercent: applicableRate,
          contentCategory: measure.category,
          amount: null,
          citation: measure.citations,
          explanation: contentInvalid
            ? `${measure.note} The supplied content value is invalid or exceeds the shipment value, so no duty amount was computed.`
            : `${measure.note} This HTS classification is in the verified derivative subset, but ${measure.contentValueField} was not supplied, so no duty amount was computed.`,
        });
        stackingExplanation.push(
          `${measure.label} applies to this verified derivative classification at ${(applicableRate * 100).toFixed(0)}% of ${measure.category} content value. The required content value is missing or invalid, so both legal totals are withheld rather than treating the charge as a percentage of total shipment value.`,
        );
        continue;
      }

      const amount = Number((contentValue * applicableRate).toFixed(2));
      components.push({
        type: "section232",
        label: measure.label,
        ratePercent: null,
        contentRatePercent: applicableRate,
        contentValue,
        contentCategory: measure.category,
        amount,
        citation: measure.citations,
        explanation: `${measure.note} USD ${contentValue.toFixed(2)} ${measure.category} content value × ${(applicableRate * 100).toFixed(0)}% = USD ${amount.toFixed(2)}.`,
      });
      stackingExplanation.push(
        `${measure.label} (${measure.chapter99Code}, effective ${measure.effectiveDate}) adds USD ${amount.toFixed(2)}, calculated only from the supplied USD ${contentValue.toFixed(2)} ${measure.category} content value. It is not represented as an ad valorem rate on total shipment value.`,
      );
    }
  }

  // Section 338 — Canada-specific additional duties (new Aug 2026). Only
  // applied when no Section 232 measure already matched this code (both
  // basic-article and derivative), mirroring each proclamation's explicit
  // carve-out for goods already subject to Section 232 steel/aluminum/auto
  // duties. This module cannot independently verify the civil-aircraft
  // exclusion (HTSUS General Note 6) or the full annex, so it is scoped to
  // the verified table in lib/tariff/section338.ts (see
  // STANDING_NOT_EVALUATED for what that leaves out).
  //
  // Per the 2026-10-06 tariff audit (TARIFF_AUDIT.md), the Sept 15, 2026
  // amendment explicitly permits the ALCOHOL basket's Section 338 duty to
  // stack with Section 232 (dairy/motor exclusions remain unchanged). A
  // Canada-origin code that matches BOTH a Section 232 measure AND the
  // Section 338 alcohol basket, checked on/after that date, is therefore
  // left unresolved below rather than silently excluded — this engine does
  // not hold a verified computation for how the two stack together.
  const section338AlcoholOnlyMatch =
    (section232Match || section232Derivative) && country.trim().toUpperCase() === "CA"
      ? lookupSection338(base.htsCode, country, importDate)
      : null;
  if (isAlcoholSection232StackUnresolved(section338AlcoholOnlyMatch, importDate)) {
    unresolvedMeasures.push(
      `${section338AlcoholOnlyMatch!.chapter99Code}: Section 338 alcohol basket may stack with Section 232 per the Sept 15, 2026 amendment — this engine does not hold a verified computation for that stack`,
    );
    components.push({
      type: "section338",
      label: section338AlcoholOnlyMatch!.note.split(":")[0] ?? "Section 338 — Canada alcoholic beverages basket",
      ratePercent: null,
      amount: null,
      citation: section338AlcoholOnlyMatch!.federalRegisterCitations,
      explanation: `The Sept 15, 2026 amendment (FR doc 2026-18838) permits this alcohol-basket Section 338 duty to stack with the already-matched Section 232 measure on this code, instead of being excluded by it. This engine does not hold a verified computation for how the two measures combine, so this component and the aggregate total are withheld rather than guessed.`,
    });
  } else if (!section232Match && !section232Derivative) {
    const section338Match = lookupSection338(base.htsCode, country, importDate);
    if (section338Match) {
      const beforeEffectiveDate = importDate !== null && importDate < SECTION_338_EFFECTIVE_DATE;
      if (beforeEffectiveDate) {
        unresolvedMeasures.push(`${section338Match.chapter99Code}: import date before Section 338 effective date ${SECTION_338_EFFECTIVE_DATE}`);
        components.push({
          type: "section338",
          label: section338Match.chapter99Code,
          ratePercent: null,
          amount: null,
          citation: section338Match.federalRegisterCitations,
          explanation: `Section 338 duties did not take effect until ${SECTION_338_EFFECTIVE_DATE}, after the given import date ${importDate}. This measure was not added for this entry.`,
        });
        stackingExplanation.push(
          `Section 338 Canada duties did not take effect until ${SECTION_338_EFFECTIVE_DATE}, after the given import date ${importDate}, so this measure was not added.`,
        );
      } else if (section338Match.banDateAmbiguous) {
        // Three Sept 8, 2026 proclamations (effective Sept 29, 2026)
        // convert this basket's 50% duty into an outright import ban for
        // goods in the ban Annex. Cante does not hold that Annex, so it
        // cannot tell whether THIS specific HTS line is banned or still
        // dutiable at 50% on or after that date — report unresolved
        // rather than guess either a rate or a ban. See section338.ts.
        unresolvedMeasures.push(`${section338Match.chapter99Code}: import date on/after the Sept 29, 2026 Section 338 ban-conversion date, basket-specific Annex not held`);
        components.push({
          type: "section338",
          label: section338Match.note.split(":")[0] ?? "Section 338 — Canada additional duty",
          ratePercent: null,
          amount: null,
          citation: [...section338Match.federalRegisterCitations, ...(section338Match.banCitation ? [section338Match.banCitation] : [])],
          explanation: section338Match.note,
        });
        stackingExplanation.push(
          `Section 338 (${section338Match.chapter99Code}) is NOT included in the total: for goods imported on or after ${SECTION_338_IMPORT_BAN_DATE}, ${section338Match.banCitation} converted this basket's 50% duty into an outright import ban for the proclamation's covered lines. Cante does not hold that ban Annex, so it cannot confirm whether this exact HTS line is banned outright or still dutiable at 50% — treat this component as unresolved, not a confident 50% or a confident ban, until verified against the Annex.`,
        );
      } else {
        const amount =
          base.computation.amount !== null && input.value !== null
            ? Number((input.value * section338Match.ratePercent).toFixed(2))
            : null;
        components.push({
          type: "section338",
          label: section338Match.note.split(":")[0] ?? "Section 338 — Canada additional duty",
          ratePercent: section338Match.ratePercent,
          amount,
          citation: section338Match.federalRegisterCitations,
          explanation: section338Match.note,
        });
        stackingExplanation.push(
          `Section 338 (${section338Match.chapter99Code}, ${(section338Match.ratePercent * 100).toFixed(0)}%) stacks additively on top of the Column 1 base duty — imposed under 19 U.S.C. 1338 to offset Canadian trade discrimination, effective ${SECTION_338_EFFECTIVE_DATE} (${section338Match.federalRegisterCitations.join("; ")}).`,
        );
      }
    }
  }
  for (const component of components) {
    if (component.amount !== null && !Number.isFinite(component.amount)) {
      component.amount = null;
      unresolvedMeasures.push(`${component.label}: arithmetic overflow`);
    }
  }
  if (!Number.isFinite(components.reduce((sum, c) => sum + (c.amount ?? 0), 0))) {
    unresolvedMeasures.push("Aggregate duty arithmetic overflow");
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

  const uflpaAdvisories = lookupUflpaAdvisories(base.htsCode, country);
  if (uflpaAdvisories.length > 0) {
    for (const advisory of uflpaAdvisories) {
      stackingExplanation.push(
        `UFLPA forced-labor lead (not a duty, not included in the total above): HTS ${base.htsCode} falls in FLETF's "${advisory.sector}" high-priority enforcement sector (${advisory.citation}). This is NOT a determination that this shipment was produced in Xinjiang or by a UFLPA Entity List member — review actual supply-chain evidence before relying on this. ${advisory.note}`,
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
    usmcaQualification,
    adCvdAdvisories,
    uflpaAdvisories,
  };
}
