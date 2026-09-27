import { z } from "zod";
import { completeJson } from "@/lib/llm";
import type { LlmProvider } from "@/lib/llm/types";
import { lookupTariff, type TariffRow } from "@/lib/tariff/rates";
import { getProductBySku, listProducts } from "@/lib/catalogue/products";
import {
  approveClassification,
  listClassifications,
  recordClassification,
  ClassificationApprovalError,
} from "@/lib/catalogue/classifications";
import { db } from "@/lib/db/client";
import { productClassifications, products, type Product } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SUGGESTION_CONFIDENCE_LEVELS } from "./suggest-contract";

/**
 * Model-suggested tariff classification — Quickcode's core, with this
 * project's discipline welded on.
 *
 * Classification is a legal determination with money and liability attached.
 * A model that emits a plausible-looking code is the single most dangerous
 * thing this codebase could contain, so three constraints hold it down and
 * none of them are optional:
 *
 * 1. **The model chooses; it never invents.** Candidate headings are fetched
 *    from the official USITC schedule first, and a returned code that is not in
 *    that candidate set is rejected outright. The model cannot hallucinate a
 *    tariff line into existence because it is only ever picking from real rows.
 * 2. **A suggestion lands as `lead`, always.** `recordSuggestion()` cannot
 *    produce any other tier, and `approveClassification()` already refuses to
 *    approve a lead. So a model suggestion is structurally unable to become an
 *    approved classification without a human act in between.
 * 3. **That human act is its own step, and it transfers responsibility.**
 *    `adoptSuggestion()` promotes lead → human and demands a named person and a
 *    written reason. It is the same shape as confirming a Memory row: the model
 *    proposes, a person adopts, and only an adopted code can then be approved.
 *
 * What this is not: a customs ruling. Every suggestion carries the alternatives
 * considered, what would change the answer, and whether it needs a licensed
 * broker. Binding classification comes from CBP, not from here.
 */

const CROSS_SEARCH = "https://rulings.cbp.gov/api/search";
const MAX_CANDIDATES = 30;
/** Slots reserved per search term, so one broad word cannot flood the set. */
const PER_TERM_CANDIDATES = 6;
const MAX_RULINGS = 5;

export interface CandidateHeading {
  code: string;
  description: string;
  generalRate: string;
  units: string[];
}

export interface SupportingRuling {
  ref: string;
  title: string;
  url: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "made", "type", "size", "grade", "new",
  "product", "products", "item", "items", "unit", "units", "colour", "color",
  "blue", "green", "red", "black", "white", "large", "small", "heavy", "light",
]);

/**
 * Search terms from a product, most specific first.
 *
 * Two things learned the hard way against the live endpoint:
 *
 * - **Single words only.** The USITC endpoint does keyword matching, not phrase
 *   matching. `"coated tarpaulin"` returns nothing useful while `"tarpaulin"`
 *   alone returns exactly 6306.12.00.00.
 * - **Length is not specificity, but it correlates.** `"tarpaulin"` must be
 *   tried before `"coated"`, which matches chewing gum, confectioners' coatings
 *   and medicated dressings. Ordering longest-first puts the distinctive noun
 *   ahead of the generic adjective.
 *
 * The minimum length is 3, not 4: `PVC`, `PET` and `ABS` are among the most
 * discriminating terms a materials list can carry, and a `> 3` filter silently
 * dropped every one of them.
 */
export function searchTermsFor(product: Pick<Product, "name" | "description" | "materials">): string[] {
  const words = [product.name, product.description ?? "", ...(product.materials ?? [])]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));

  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 6);
}

interface RawHtsRow {
  htsno?: unknown;
  description?: unknown;
  general?: unknown;
  units?: unknown;
}

/**
 * Real HTS rows the model may choose from.
 *
 * Only rows carrying a code and a rate are kept: the schedule contains
 * indent-only heading rows with no code of their own, and offering one as a
 * candidate would invite a classification to a line that cannot be declared.
 */
export async function searchCandidateHeadings(
  terms: string[],
  options: { signal?: AbortSignal } = {},
): Promise<CandidateHeading[]> {
  const found = new Map<string, CandidateHeading>();

  for (const term of terms) {
    if (found.size >= MAX_CANDIDATES) break;
    // Per-term quota. Without it a broad word fills every slot on a
    // first-come-first-served basis and the specific noun that would have
    // found the right heading never gets queried — which is exactly how a
    // tarpaulin ended up being offered chewing gum and medicated dressings.
    const quotaForTerm = found.size + PER_TERM_CANDIDATES;
    let payload: unknown;
    try {
      const res = await fetch(
        `https://hts.usitc.gov/reststop/search?${new URLSearchParams({ keyword: term })}`,
        { signal: options.signal, headers: { Accept: "application/json" } },
      );
      if (!res.ok) continue;
      payload = await res.json();
    } catch {
      continue;
    }
    if (!Array.isArray(payload)) continue;

    for (const raw of payload as RawHtsRow[]) {
      const code = typeof raw.htsno === "string" ? raw.htsno.trim() : "";
      const description = typeof raw.description === "string" ? raw.description.trim() : "";
      const general = typeof raw.general === "string" ? raw.general.trim() : "";
      // A row without its own code is a heading label, not a declarable line.
      if (!code || !description || code.replace(/\D/g, "").length < 8) continue;
      if (found.has(code)) continue;
      found.set(code, {
        code,
        description,
        generalRate: general || "not published",
        units: Array.isArray(raw.units) ? raw.units.filter((u): u is string => typeof u === "string") : [],
      });
      if (found.size >= quotaForTerm || found.size >= MAX_CANDIDATES) break;
    }
  }

  return [...found.values()];
}

/** CBP rulings on similar goods. Research evidence, never binding here. */
export async function searchSupportingRulings(
  terms: string[],
  options: { signal?: AbortSignal } = {},
): Promise<SupportingRuling[]> {
  const term = terms[0];
  if (!term) return [];

  try {
    const res = await fetch(
      `${CROSS_SEARCH}?${new URLSearchParams({
        term,
        collection: "ALL",
        pageSize: "20",
        page: "1",
        sortBy: "DATE_DESC",
      })}`,
      { signal: options.signal, headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as { rulings?: unknown };
    if (!Array.isArray(payload.rulings)) return [];

    return payload.rulings
      .slice(0, MAX_RULINGS)
      .map((raw): SupportingRuling | null => {
        if (typeof raw !== "object" || raw === null) return null;
        const row = raw as Record<string, unknown>;
        const ref = typeof row.rulingNumber === "string" ? row.rulingNumber : null;
        if (!ref) return null;
        return {
          ref,
          title: typeof row.subject === "string" ? row.subject : "",
          url: `https://rulings.cbp.gov/ruling/${ref}`,
        };
      })
      .filter((r): r is SupportingRuling => r !== null);
  } catch {
    return [];
  }
}

const SuggestionSchema = z.object({
  /**
   * The escape hatch that stops a forced wrong answer.
   *
   * The first live run proved why this is needed: the model correctly judged
   * that none of the retrieved candidates covered a PVC-coated tarpaulin and
   * said so in its uncertainties — but the prompt told it to pick the closest
   * anyway, so a nonwoven-fabric code was recorded for a good that belongs in
   * heading 6306. Being unable to decline turned an honest model into a wrong
   * database row.
   */
  noSuitableCandidate: z
    .boolean()
    .describe("True when none of the candidates actually covers this good."),
  recommendedCode: z
    .string()
    .describe("A code copied verbatim from the candidate list, or \"\" when noSuitableCandidate is true."),
  confidence: z.enum(SUGGESTION_CONFIDENCE_LEVELS),
  griApplied: z
    .string()
    .describe("Which General Rule of Interpretation drove the choice, e.g. 'GRI 1' or 'GRI 3(b)'."),
  rationale: z.string().describe("Why this heading covers this good, in plain words."),
  alternatives: z
    .array(z.object({ code: z.string(), whyNotChosen: z.string() }))
    .describe("Candidates seriously considered and rejected, with the reason."),
  uncertainties: z
    .array(z.string())
    .describe("Facts that would change the answer if they turned out different."),
  needsExpertReview: z
    .boolean()
    .describe("True when this genuinely needs a licensed customs broker."),
});

export type Suggestion = z.infer<typeof SuggestionSchema>;

const SYSTEM = `You classify goods under the Harmonized Tariff Schedule.

You are proposing a candidate classification for a human to review. You are not
issuing a ruling and your output will never be treated as one.

Hard rules:
- recommendedCode MUST be copied verbatim from the candidate list you are given.
  Never output a code that is not in that list, even if you believe a better one
  exists.
- If none of the candidates actually covers the good, set noSuitableCandidate to
  true, leave recommendedCode as an empty string, and name the heading you would
  expect in uncertainties. Declining is the correct answer here and is always
  preferred to picking the closest wrong code. The candidate list is produced by
  a keyword search that can miss the right heading entirely; you are not being
  asked to salvage it.
- Apply the General Rules of Interpretation in order and name the one you relied
  on. GRI 1 (heading terms and notes) governs unless it genuinely cannot resolve
  the good.
- Composite goods and mixtures usually turn on GRI 3(b) essential character. Say
  what you took the essential character to be and why.
- List the alternatives you seriously considered and why you rejected each. A
  suggestion with no alternatives considered is rarely honest.
- uncertainties must name facts that would change the answer — material
  composition, weight per square metre, coating, intended use, state of assembly.
  If you needed a fact you were not given, that belongs here.
- Set needsExpertReview true whenever the good is a composite, the candidates
  differ materially in rate, or the description you were given is thin.

Do not flatter the description you were given. If it is too vague to classify,
say that plainly rather than producing a confident answer.`;

export interface SuggestionResult {
  suggestion: Suggestion;
  candidates: CandidateHeading[];
  rulings: SupportingRuling[];
  /** The chosen row, re-fetched so the rate shown is the official one. */
  chosenRow: TariffRow | null;
  caveats: string[];
}

export class SuggestionError extends Error {
  readonly status = 400;
}

/**
 * Suggest a classification for a product.
 *
 * Returns null candidates rather than a guess when the official schedule
 * yields nothing to choose from — an unclassifiable description is a real
 * answer, and inventing a heading to fill the gap is the failure this whole
 * module is shaped to prevent.
 */
export async function suggestClassification(
  provider: LlmProvider,
  input: { customerId: string; sku: string; signal?: AbortSignal },
): Promise<SuggestionResult> {
  const product = getProductBySku(input.customerId, input.sku);
  if (!product) throw new SuggestionError(`No product with SKU "${input.sku}".`);

  const terms = searchTermsFor(product);
  if (terms.length === 0) {
    throw new SuggestionError(
      `${product.sku} has no usable name, description or materials to search on. Add a description before requesting a suggestion.`,
    );
  }

  const [candidates, rulings] = await Promise.all([
    searchCandidateHeadings(terms, { signal: input.signal }),
    searchSupportingRulings(terms, { signal: input.signal }),
  ]);

  if (candidates.length === 0) {
    throw new SuggestionError(
      `No official HTS rows matched ${product.sku} on the terms ${terms.join(", ")}. ` +
        "No suggestion was produced — an empty candidate set means the description needs improving, not that a code should be guessed.",
    );
  }

  const prompt = [
    "## Product",
    `SKU: ${product.sku}`,
    `Name: ${product.name}`,
    product.description ? `Description: ${product.description}` : "Description: (none recorded)",
    product.materials.length ? `Materials: ${product.materials.join(", ")}` : "Materials: (none recorded)",
    product.originCountry ? `Country of origin: ${product.originCountry}` : "",
    product.unitOfMeasure ? `Unit of measure: ${product.unitOfMeasure}` : "",
    "",
    "## Candidate HTS rows — choose one of these, verbatim",
    ...candidates.map((c) => `- ${c.code} — ${c.description} (general rate ${c.generalRate}${c.units.length ? `, units ${c.units.join("/")}` : ""})`),
    "",
    rulings.length
      ? "## CBP rulings on related goods (research only, not binding for this product)"
      : "## CBP rulings: none found for these terms",
    ...rulings.map((r) => `- ${r.ref}: ${r.title}`),
    "",
    "Return JSON matching the schema.",
  ]
    .filter(Boolean)
    .join("\n");

  const { value } = await completeJson(provider, SuggestionSchema, {
    system: SYSTEM,
    prompt,
    timeoutMs: 120_000,
  });

  // The model judged that retrieval missed the right heading. That is a real
  // answer about the search, not a classification, so nothing is recorded.
  if (value.noSuitableCandidate) {
    throw new SuggestionError(
      `The model found none of the ${candidates.length} retrieved candidates suitable for ${product.sku}` +
        `${value.uncertainties.length ? `: ${value.uncertainties.join(" ")}` : "."} ` +
        "No classification was recorded. Improve the product description, or classify by hand.",
    );
  }

  // The load-bearing guardrail. A code outside the candidate set is a
  // hallucinated tariff line, and it is rejected rather than recorded.
  const codes = new Set(candidates.map((c) => c.code));
  if (!codes.has(value.recommendedCode)) {
    throw new SuggestionError(
      `The model returned ${value.recommendedCode}, which was not among the ${candidates.length} official candidate rows it was given. ` +
        "The suggestion was discarded rather than recorded — a code outside the candidate set is not a classification.",
    );
  }

  const chosenRow = await lookupTariff(value.recommendedCode, { signal: input.signal }).catch(
    () => null,
  );

  const caveats = [
    "This is a model suggestion, not a customs ruling. It is recorded as an unconfirmed lead and cannot be approved until a person adopts it.",
    `Chosen from ${candidates.length} official USITC rows on the search terms: ${terms.join(", ")}.`,
  ];
  if (value.needsExpertReview) {
    caveats.push("The model flagged this as needing a licensed customs broker.");
  }
  if (value.confidence === "low") {
    caveats.push("The model reported low confidence in this choice.");
  }
  if (rulings.length === 0) {
    caveats.push("No CBP rulings were found for these terms, so no ruling supports this suggestion.");
  }

  return { suggestion: value, candidates, rulings, chosenRow, caveats };
}

/**
 * Record a suggestion against a product.
 *
 * Hard-wired to `lead` tier. There is deliberately no parameter to change
 * that — a caller cannot ask this function for a stronger tier, so no future
 * refactor can quietly turn a model suggestion into an established fact.
 */
export function recordSuggestion(
  productId: string,
  result: SuggestionResult,
  options: { system?: string; jurisdiction?: string | null } = {},
) {
  const { suggestion } = result;
  const rationale = [
    `${suggestion.griApplied}: ${suggestion.rationale}`,
    suggestion.alternatives.length
      ? `Alternatives considered: ${suggestion.alternatives.map((a) => `${a.code} (${a.whyNotChosen})`).join("; ")}`
      : "No alternatives were recorded, which is unusual for a genuine classification decision.",
    suggestion.uncertainties.length
      ? `Would change the answer: ${suggestion.uncertainties.join("; ")}`
      : "",
    suggestion.needsExpertReview ? "Flagged as needing a licensed customs broker." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return recordClassification({
    productId,
    system: options.system ?? "hts",
    jurisdiction: options.jurisdiction ?? null,
    code: suggestion.recommendedCode,
    tier: "lead",
    basis:
      `Model suggestion (${suggestion.confidence} confidence) chosen from ${result.candidates.length} official USITC candidate rows on ${new Date().toISOString().slice(0, 10)}. ` +
      "Not verified against a document and not confirmed by a person.",
    rationale,
    supportingRefs: [
      ...result.rulings.map((r) => ({
        kind: "cbp_ruling",
        ref: r.ref,
        title: r.title,
        url: r.url,
      })),
      ...(result.chosenRow
        ? [
            {
              kind: "hts_row",
              ref: result.chosenRow.htsCode,
              title: result.chosenRow.description,
              url: `https://hts.usitc.gov/search?query=${encodeURIComponent(result.chosenRow.htsCode)}`,
            },
          ]
        : []),
    ],
  });
}

/**
 * Adopt a model suggestion: `lead` → `human`.
 *
 * The deliberate act that transfers responsibility from the model to a person.
 * It is separate from approval on purpose — adopting says "I have read this and
 * I stand behind it", approving says "this is the code we use". Collapsing the
 * two would let one click carry a model's guess all the way to an approved
 * classification, which is exactly what `approveClassification()` refuses to do
 * for lead-tier codes.
 */
export function adoptSuggestion(
  classificationId: string,
  adoptedBy: string,
  reason: string,
) {
  const row = db
    .select()
    .from(productClassifications)
    .where(eq(productClassifications.id, classificationId))
    .get();

  if (!row) throw new SuggestionError("Classification not found.");
  if (row.tier !== "lead") {
    throw new SuggestionError(
      `Only a lead-tier suggestion can be adopted; this one is ${row.tier} tier.`,
    );
  }
  if (!adoptedBy.trim()) throw new SuggestionError("Adopting requires a named person.");
  if (!reason.trim()) {
    throw new SuggestionError(
      "Adopting requires a written reason. You are taking responsibility for a model's suggestion.",
    );
  }

  const basis =
    `${row.basis} Adopted by ${adoptedBy.trim()} on ${new Date().toISOString().slice(0, 10)}: ${reason.trim()}`;

  db.update(productClassifications)
    .set({ tier: "human", basis })
    .where(eq(productClassifications.id, classificationId))
    .run();

  return { ...row, tier: "human", basis };
}

/** Suggestions awaiting a human, across the catalogue. */
export function pendingSuggestions(customerId: string) {
  const out: Array<{
    productSku: string;
    classificationId: string;
    code: string;
    system: string;
    basis: string;
    rationale: string | null;
  }> = [];

  for (const product of listProducts(customerId)) {
    for (const row of listClassifications(product.id)) {
      if (row.tier !== "lead" || row.supersededAt || row.status === "rejected") continue;
      if (!row.basis.startsWith("Model suggestion")) continue;
      out.push({
        productSku: product.sku,
        classificationId: row.id,
        code: row.code,
        system: row.system,
        basis: row.basis,
        rationale: row.rationale,
      });
    }
  }
  return out;
}

/** Re-exported so callers need one import for the whole review flow. */
export { approveClassification, ClassificationApprovalError, products };
