/**
 * Volza-replacement pipeline, build-sequence step 2 (see
 * docs/import-data-pipeline.md and gbrain cante/company-plan):
 * "cross-reference shipment HS chapter/commodity description against
 * CPSC/FDA/FSIS recall data to auto-flag 'this importer just got
 * recalled/flagged for X' — turns raw data into a lead-scoring engine."
 *
 * This module is the first slice of that: given one parsed import shipment
 * (pipelines/import-manifest/schema/shipments.ts) and the live CPSC recall
 * feed Cante already fetches (lib/sources/registry.ts `us-cpsc-recalls`,
 * parsed by parseCpscRecallsJson in lib/sources/fetch.ts into
 * RegulationEntry rows), score how well the recall's product description
 * overlaps the shipment's cargo description.
 *
 * Deliberately a small explicit token-overlap scorer, not a fuzzy/embedding
 * match: the CPSC feed only supplies free-text product titles/descriptions,
 * and a wrong automated "this is the same product" guess is worse than a
 * missed one when the output feeds a sales lead list (same judgment call
 * `deriveShipperCountryCode` made for country matching in
 * fetch-manifests.ts). Every match names exactly which words overlapped so
 * a human (or Marketing's agent) can sanity-check it before treating it as
 * a lead, matching the "research candidate, not a final determination"
 * posture used throughout lib/sources/fetch.ts.
 */

import type { RegulationEntry } from "@/lib/sources/fetch";

/** The subset of a shipment row this matcher actually needs. */
export interface ShipmentForMatching {
  cargoDescription: string | null;
  hsChapter: string | null;
  consigneeName: string | null;
}

export interface RecallMatch {
  recall: RegulationEntry;
  /** Number of significant words shared between cargo description and recall text. */
  score: number;
  /** The actual overlapping words, lowercased, for human review. */
  matchedTerms: string[];
}

/**
 * Stopwords common enough in both shipping cargo descriptions and CPSC
 * recall titles that they would otherwise dominate every match with noise
 * ("units", "product", "company", generic packaging terms). Kept short and
 * explicit rather than a general English stopword list — this list only
 * needs to remove terms that are common to BOTH corpora, not all of English.
 */
const NOISE_WORDS = new Set([
  "the", "and", "for", "with", "from", "units", "product", "products",
  "company", "inc", "llc", "ltd", "co", "recall", "recalled", "import",
  "imports", "importer", "sold", "manufactured", "distributed", "various",
  "assorted", "general", "other", "unit", "case", "cases", "carton",
  "cartons", "box", "boxes",
]);

/** Lowercased, de-duplicated significant (4+ char) words from free text. */
function significantWords(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !NOISE_WORDS.has(word));
  return new Set(words);
}

/**
 * Score one shipment against one recall entry. Returns null (not a
 * zero-score match) when there is nothing to compare — a shipment with no
 * cargo description, or a recall with no title, is unchecked, not "no
 * match", matching the rest of this codebase's rule that absence of data
 * must never present as a negative result.
 */
export function scoreShipmentAgainstRecall(
  shipment: ShipmentForMatching,
  recall: RegulationEntry
): RecallMatch | null {
  const cargoWords = significantWords(shipment.cargoDescription);
  // fullTitle carries the recall's product/hazard detail; listingTitle alone
  // is often just the headline company+product name repeated from fullTitle,
  // so comparing against fullTitle catches more real overlap.
  const recallWords = significantWords(recall.fullTitle || recall.listingTitle);
  if (cargoWords.size === 0 || recallWords.size === 0) return null;

  const matchedTerms = [...cargoWords].filter((word) => recallWords.has(word)).sort();
  if (matchedTerms.length === 0) return null;

  return { recall, score: matchedTerms.length, matchedTerms };
}

/**
 * Rank every recall against one shipment, strongest overlap first. This is
 * the "who imports X that just got recalled" primitive step 3 of the build
 * sequence (storage/search layer) will eventually expose as a query —
 * today it is a plain in-memory scan, matching the scale of the current
 * scaffold (no live feed wired up yet, see fetch-manifests.ts).
 */
export function rankRecallMatches(
  shipment: ShipmentForMatching,
  recalls: RegulationEntry[]
): RecallMatch[] {
  return recalls
    .map((recall) => scoreShipmentAgainstRecall(shipment, recall))
    .filter((match): match is RecallMatch => match !== null)
    .sort((a, b) => b.score - a.score);
}
