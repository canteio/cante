import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

import { type Finding, type ImpactAssessment, type Product, type TradeLane } from "@/lib/db/schema";
import { listProducts } from "@/lib/catalogue/products";
import { annualShipmentsOf, listLanes } from "@/lib/catalogue/lanes";
import { listClassifications, resolveProductCodes } from "@/lib/catalogue/classifications";
import { quoteDuty } from "@/lib/tariff/rates";

/**
 * Impact calculation — item 5.
 *
 * This is the file most able to damage the product's credibility, because a
 * dollar figure reads as fact in a way prose does not. Three rules hold it to
 * the same standard as everything else here:
 *
 * 1. **A missing input produces `null`, never `0`.** Zero exposure and unknown
 *    exposure are different answers, and a customer who reads "$0" concludes
 *    there is nothing to do.
 * 2. **`basis` is mandatory and printed with the number.** Every figure is
 *    reconstructible from the assumptions listed beside it.
 * 3. **`confidence` is capped by the weakest input.** An exposure computed from
 *    a lead-tier HS code is `indicative` no matter how precise the arithmetic.
 *
 * Matching is deliberately generous and honestly labelled: a candidate match on
 * an HS-6 prefix is surfaced as a prefix match, not silently promoted to an
 * exact hit, because tariff changes are usually written at 6 digits while
 * catalogues carry 8 or 10.
 */

export type MatchKind = "exact_code" | "code_prefix" | "material" | "origin" | "destination" | "catalogue_wide";
export type Confidence = "verified" | "estimated" | "indicative";

const HS_IN_TEXT = /\b(\d{4})[.\s]?(\d{2})(?:[.\s]?(\d{2}))?(?:[.\s]?(\d{2}))?\b/g;

/** Codes named anywhere in the finding's own text. */
export function codesMentionedIn(finding: Pick<Finding, "title" | "summaryEn" | "reasoning" | "regulationRef">): string[] {
  const haystack = [finding.title, finding.summaryEn, finding.reasoning].filter(Boolean).join(" ");
  const found = new Set<string>();
  for (const match of haystack.matchAll(HS_IN_TEXT)) {
    const digits = [match[1], match[2], match[3], match[4]].filter(Boolean).join("");
    // A bare 4+2 that is really a year range ("2026 12") would be noise; require
    // the canonical dotted or contiguous forms of at least 6 digits.
    if (digits.length >= 6) found.add(digits);
  }
  return [...found];
}

function digitsOf(code: string): string {
  return code.replace(/\D/g, "");
}

export interface ProductMatch {
  product: Product;
  kind: MatchKind;
  reason: string;
  /** Tier of the code that produced the match, when the match was code-based. */
  codeTier?: string;
}

/**
 * Which catalogue products a finding plausibly touches.
 *
 * Returns matches with their kind so the caller can present a prefix or
 * material match as the weaker signal it is.
 */
export async function matchProducts(
  customerId: string,
  finding: Pick<Finding, "title" | "summaryEn" | "reasoning" | "regulationRef">,
): Promise<ProductMatch[]> {
  const catalogue = await listProducts(customerId);
  const mentioned = codesMentionedIn(finding).map(digitsOf);
  const haystack = [finding.title, finding.summaryEn, finding.reasoning]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matches: ProductMatch[] = [];

  for (const product of catalogue) {
    const classifications = (await listClassifications(product.id)).filter(
      (c) => !c.supersededAt && c.status !== "rejected",
    );

    let best: ProductMatch | null = null;

    for (const classification of classifications) {
      const code = digitsOf(classification.code);
      if (!code) continue;
      for (const target of mentioned) {
        const exact = code === target;
        const prefix = !exact && (code.startsWith(target) || target.startsWith(code));
        if (!exact && !prefix) continue;
        const candidate: ProductMatch = {
          product,
          kind: exact ? "exact_code" : "code_prefix",
          reason: exact
            ? `The regulation names ${classification.code}, which is on file for ${product.sku} (${classification.tier} tier).`
            : `The regulation names ${target}, which shares a heading with ${product.sku}'s ${classification.code} (${classification.tier} tier). Tariff measures are often written at 6 digits; confirm at the full code before acting.`,
          codeTier: classification.tier,
        };
        if (!best || (best.kind === "code_prefix" && candidate.kind === "exact_code")) best = candidate;
      }
    }

    if (!best) {
      const material = product.materials.find((m) => m && haystack.includes(m.toLowerCase()));
      if (material) {
        best = {
          product,
          kind: "material",
          reason: `The regulation text mentions "${material}", which is a recorded material for ${product.sku}. This is a keyword signal, not a classification match.`,
        };
      }
    }

    if (best) matches.push(best);
  }

  return matches;
}

export interface DutyChange {
  before: number | null;
  after: number | null;
}

export interface AssessInput {
  finding: Finding;
  customerId: string;
  /** Effective date, when the source established one. */
  effectiveOn?: string | null;
  /** Duty rates as fractions (0.05 = 5%), when a source actually stated them. */
  duty?: DutyChange;
  now?: Date;
}

export interface AssessmentDraft {
  productId: string | null;
  laneId: string | null;
  matchKind: MatchKind;
  matchReason: string;
  effectiveOn: string | null;
  nextAffectedShipmentAt: string | null;
  dutyRateBefore: number | null;
  dutyRateAfter: number | null;
  estimatedAnnualExposure: number | null;
  estimatedMonthlyExposure: number | null;
  currency: string;
  delayRisk: string;
  basis: string[];
  confidence: Confidence;
  /** Filled by enrichDraftsWithTariff(); null until a rate has been resolved. */
  annualDutyAtRisk?: number | null;
  tariffCode?: string | null;
  tariffBasis?: string | null;
}

function weakestConfidence(a: Confidence, b: Confidence): Confidence {
  const order: Confidence[] = ["indicative", "estimated", "verified"];
  return order[Math.min(order.indexOf(a), order.indexOf(b))];
}

/**
 * Build (but do not store) the impact of one finding across the catalogue.
 *
 * Reads the catalogue without writing an assessment, so the caller decides
 * whether a draft is worth persisting.
 */
export async function assessImpact(input: AssessInput): Promise<AssessmentDraft[]> {
  const { finding, customerId } = input;
  const now = input.now ?? new Date();
  const effectiveOn = input.effectiveOn ?? null;
  const matches = await matchProducts(customerId, finding);
  const allLanes = await listLanes(customerId);
  const drafts: AssessmentDraft[] = [];

  if (matches.length === 0) {
    // No product matched. That is a real answer, and it is not "no impact" —
    // an empty catalogue and a genuinely irrelevant rule look identical here.
    const catalogueSize = (await listProducts(customerId)).length;
    drafts.push({
      productId: null,
      laneId: null,
      matchKind: "catalogue_wide",
      matchReason:
        catalogueSize === 0
          ? "No products are in the catalogue, so this regulation could not be matched against anything. This is a coverage gap, not a finding of no impact."
          : `None of the ${catalogueSize} catalogue products matched this regulation by code or material. Codes on file may be incomplete.`,
      effectiveOn,
      nextAffectedShipmentAt: null,
      dutyRateBefore: input.duty?.before ?? null,
      dutyRateAfter: input.duty?.after ?? null,
      estimatedAnnualExposure: null,
      estimatedMonthlyExposure: null,
      currency: "USD",
      delayRisk: "none",
      basis: [
        catalogueSize === 0
          ? "Catalogue is empty; no matching was possible."
          : "Matching used codes and materials on file; unclassified products cannot match.",
      ],
      confidence: "indicative",
    });
    return drafts;
  }

  for (const match of matches) {
    const lanes = allLanes.filter((lane) => !lane.productId || lane.productId === match.product.id);
    const targets: Array<TradeLane | null> = lanes.length ? lanes : [null];

    for (const lane of targets) {
      const basis: string[] = [match.reason];
      let confidence: Confidence =
        match.kind === "exact_code" && match.codeTier === "document" ? "estimated" : "indicative";

      if (match.codeTier && match.codeTier !== "document") {
        basis.push(
          `The matching code is ${match.codeTier} tier, not document-verified, so this whole assessment inherits that uncertainty.`,
        );
      }

      const shipments = lane ? annualShipmentsOf(lane) : null;
      const annualValue = lane?.annualValue ?? null;
      const currency = lane?.currency ?? match.product.currency ?? "USD";

      let annualExposure: number | null = null;
      const before = input.duty?.before ?? null;
      const after = input.duty?.after ?? null;

      if (before !== null && after !== null && annualValue !== null) {
        annualExposure = Number(((after - before) * annualValue).toFixed(2));
        basis.push(
          `Exposure = (${(after * 100).toFixed(2)}% − ${(before * 100).toFixed(2)}%) × ${currency} ${annualValue.toLocaleString()} declared annual lane value.`,
        );
        confidence = weakestConfidence(confidence, "estimated");
      } else {
        const missing: string[] = [];
        if (before === null || after === null) missing.push("a stated duty rate before and after");
        if (annualValue === null) missing.push("an annual lane value");
        basis.push(
          `No exposure figure: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing. Left unknown rather than reported as zero.`,
        );
        confidence = "indicative";
      }

      let nextShipment: string | null = null;
      let delayRisk = "none";
      if (lane?.nextShipmentAt) {
        nextShipment = lane.nextShipmentAt;
        if (effectiveOn && lane.nextShipmentAt >= effectiveOn) {
          const days = Math.round(
            (new Date(lane.nextShipmentAt).getTime() - now.getTime()) / 86_400_000,
          );
          delayRisk = days <= 14 ? "high" : days <= 45 ? "medium" : "low";
          basis.push(
            `Next shipment ${lane.nextShipmentAt} falls on or after the effective date ${effectiveOn} (${days} days out).`,
          );
        } else if (effectiveOn) {
          basis.push(
            `Next shipment ${lane.nextShipmentAt} is before the effective date ${effectiveOn}; it should ship under the current rule.`,
          );
        }
      } else if (lane) {
        basis.push("No next shipment date on file for this lane, so timing impact is unknown.");
      }

      if (!effectiveOn) {
        basis.push(
          "The source did not establish an effective date, so no timing conclusion can be drawn.",
        );
      }

      if (shipments === null && lane) {
        basis.push("Shipment frequency is unknown for this lane.");
      }

      drafts.push({
        productId: match.product.id,
        laneId: lane?.id ?? null,
        matchKind: match.kind,
        matchReason: match.reason,
        effectiveOn,
        nextAffectedShipmentAt: nextShipment,
        dutyRateBefore: before,
        dutyRateAfter: after,
        estimatedAnnualExposure: annualExposure,
        estimatedMonthlyExposure:
          annualExposure === null ? null : Number((annualExposure / 12).toFixed(2)),
        currency,
        delayRisk,
        basis,
        confidence,
      });
    }
  }

  return drafts;
}

/**
 * Resolve real duty rates for drafts and attach the annual duty at risk.
 *
 * Kept separate from `assessImpact()` so a tariff-service outage degrades one
 * field instead of failing the whole assessment.
 *
 * What this can and cannot know: the USITC publishes **today's** rate. For a
 * misclassification we can compute a real delta, because both codes have a
 * published rate right now. For a regulation that changes a rate in future, the
 * "after" rate does not exist yet — so this fills `annualDutyAtRisk` (the duty
 * currently flowing through the affected lane) and leaves
 * `estimatedAnnualExposure` alone. Magnitude without inventing a delta.
 */
export async function enrichDraftsWithTariff(
  drafts: AssessmentDraft[],
  options: { signal?: AbortSignal; } = {},
): Promise<AssessmentDraft[]> {
  const supabase = await createClient();
  const out: AssessmentDraft[] = [];

  for (const draft of drafts) {
    if (!draft.productId) {
      out.push(draft);
      continue;
    }

    const resolved = (await resolveProductCodes(draft.productId, "hts")).current
      ? await resolveProductCodes(draft.productId, "hts")
      : await resolveProductCodes(draft.productId, "hs");
    const classification = resolved.current ?? resolved.document[0] ?? resolved.human[0] ?? null;
    const lane = draft.laneId
      ? (cloudResult<typeof Schema.tradeLanes.$inferSelect | null>(
        await supabase
          .from("trade_lanes")
          .select("*")
          .eq("id", draft.laneId)
          .limit(1)
          .maybeSingle(),
      ) ?? undefined)
      : null;

    if (!classification || !lane?.annualValue) {
      out.push({
        ...draft,
        annualDutyAtRisk: null,
        basis: [
          ...draft.basis,
          !classification
            ? "No established classification, so no tariff rate could be looked up."
            : "No annual lane value on file, so duty at risk could not be computed.",
        ],
      });
      continue;
    }

    try {
      const quote = await quoteDuty({
        htsCode: classification.code,
        value: lane.annualValue,
        signal: options.signal,
      });

      if (!quote) {
        out.push({
          ...draft,
          annualDutyAtRisk: null,
          basis: [
            ...draft.basis,
            `No published USITC HTS row matched ${classification.code}, so no duty was computed.`,
          ],
        });
        continue;
      }

      out.push({
        ...draft,
        annualDutyAtRisk: quote.computation.amount,
        tariffCode: quote.htsCode,
        tariffBasis: `USITC HTS ${quote.column} ${quote.rate.raw}`,
        basis: [
          ...draft.basis,
          `Annual duty at risk on this lane: ${quote.computation.basis.join(" ")}`,
          ...quote.caveats,
          "This is the duty currently flowing through the lane at the published rate, not an estimate of how the rate will change.",
        ],
      });
    } catch (error) {
      // A tariff outage costs one field, not the assessment.
      out.push({
        ...draft,
        annualDutyAtRisk: null,
        basis: [
          ...draft.basis,
          `Tariff lookup failed (${error instanceof Error ? error.message : "unknown error"}), so duty at risk is unknown rather than zero.`,
        ],
      });
    }
  }

  return out;
}

/** Persist drafts for a finding, replacing any previous assessment of it. */
export async function storeImpact(
  customerId: string,
  findingId: string,
  drafts: AssessmentDraft[],
): Promise<ImpactAssessment[]> {
  const supabase = await createClient();
  const stored: ImpactAssessment[] = [];
  for (const draft of drafts) {
    const row = {
      id: randomUUID(),
      findingId,
      customerId,
      productId: draft.productId,
      laneId: draft.laneId,
      matchReason: draft.matchReason,
      matchKind: draft.matchKind,
      effectiveOn: draft.effectiveOn,
      nextAffectedShipmentAt: draft.nextAffectedShipmentAt,
      dutyRateBefore: draft.dutyRateBefore,
      dutyRateAfter: draft.dutyRateAfter,
      estimatedAnnualExposure: draft.estimatedAnnualExposure,
      estimatedMonthlyExposure: draft.estimatedMonthlyExposure,
      currency: draft.currency,
      delayRisk: draft.delayRisk,
      annualDutyAtRisk: draft.annualDutyAtRisk ?? null,
      tariffCode: draft.tariffCode ?? null,
      tariffBasis: draft.tariffBasis ?? null,
      basis: draft.basis,
      confidence: draft.confidence,
      direction: "unknown",
      createdAt: new Date().toISOString(),
    };
    stored.push(row as ImpactAssessment);
  }
  cloudResult(
    await supabase
      .rpc("replace_impact_assessments", { target_customer_id: customerId, target_finding_id: findingId, replacement: stored.map(snakeRow) }),
  );
  return stored;
}

export async function listImpactForFinding(findingId: string): Promise<ImpactAssessment[]> {
  const supabase = await createClient();
  return cloudResult<Array<typeof Schema.impactAssessments.$inferSelect>>(
    await supabase
      .from("impact_assessments")
      .select("*")
      .eq("finding_id", findingId),
  );
}

/** One human-readable block. Refuses to print a figure without its basis. */
export function renderImpact(assessment: ImpactAssessment, productSku?: string): string {
  const lines: string[] = [];
  lines.push(`${productSku ?? "Catalogue-wide"} — ${assessment.matchKind.replace(/_/g, " ")}`);
  lines.push(assessment.matchReason);
  if (assessment.effectiveOn) lines.push(`Effective ${assessment.effectiveOn}.`);
  if (assessment.nextAffectedShipmentAt) {
    lines.push(
      `Next affected shipment ${assessment.nextAffectedShipmentAt} (delay risk: ${assessment.delayRisk}).`,
    );
  }
  if (assessment.estimatedAnnualExposure !== null) {
    lines.push(
      `Estimated exposure ${assessment.currency} ${assessment.estimatedAnnualExposure.toLocaleString()}/year (${assessment.currency} ${assessment.estimatedMonthlyExposure?.toLocaleString()}/month) — ${assessment.confidence}.`,
    );
  } else {
    lines.push("Estimated exposure: not calculable from what is on file.");
  }
  lines.push(`Basis: ${assessment.basis.join(" ")}`);
  return lines.join("\n");
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
