/**
 * Volza-replacement pipeline, build-sequence step 3 (see
 * docs/import-data-pipeline.md and gbrain cante/company-plan):
 * "Storage/search layer: Postgres (or similar) + simple internal search
 * (or query via Sheets/API) so Marketing can ask 'who imports baby
 * products from China' and get an instant answer."
 *
 * This is the first slice of that: a small, dependency-free query function
 * over already-loaded ImportShipment rows. Deliberately NOT a SQL/Postgres
 * layer yet — no live data source is wired up (see docs/import-data-pipeline.md
 * Path A/B), so a real query engine would have nothing to query against.
 * Once shipments.ts is merged into lib/db/schema.ts and a live feed exists,
 * this same filter logic becomes the WHERE-clause builder for a real DB
 * query (or, short term, can run directly against an array of rows pulled
 * from Sheets/API) — the filter *shape* below is designed to translate
 * 1:1 into SQL predicates later without changing the public contract.
 *
 * AI-agent usability note: this module is written to be called directly by
 * an agent (e.g. the Marketing cron job) with a plain-language-derived
 * filter object, not just by humans reading a UI — hence the flat,
 * self-descriptive `ShipmentQuery` shape (one field per question a caller
 * might ask) instead of a free-text query string an agent would have to
 * guess the syntax of.
 */

import type { ImportShipmentRow } from "../schema/shipments";
import type { RegulationEntry } from "@/lib/sources/fetch";
import {
  rankRecallMatches,
  type RecallMatch,
} from "../match/match-shipment-recalls";

/**
 * Filters map directly onto shipment columns. All fields are optional and
 * combine with AND semantics. String filters are case-insensitive substring
 * matches (cargoDescriptionContains, consigneeNameContains) so a caller
 * doesn't need to know exact casing/punctuation used in a given manifest.
 */
export interface ShipmentQuery {
  /** ISO 3166-1 alpha-2, e.g. "CN" — matches shipperCountryCode exactly. */
  shipperCountryCode?: string;
  /** 2-digit HS chapter, e.g. "95" (toys/sporting goods). */
  hsChapter?: string;
  /** Case-insensitive substring match against cargoDescription. */
  cargoDescriptionContains?: string;
  /** Case-insensitive substring match against consigneeName (the US importer). */
  consigneeNameContains?: string;
  /** Exclude rows where dataRedacted is true (CBP confidentiality opt-out, see schema). */
  excludeRedacted?: boolean;
}

/**
 * Filter a set of shipment rows against a ShipmentQuery. Pure function, no
 * I/O — callers own how rows were loaded (DB query, Sheets pull, fixture
 * array in tests). Kept pure specifically so it can be unit-tested without
 * a real database, matching the rest of this pipeline's "testable before
 * the data source is settled" posture.
 */
export function queryShipments(
  rows: ImportShipmentRow[],
  query: ShipmentQuery,
): ImportShipmentRow[] {
  return rows.filter((row) => {
    if (
      query.shipperCountryCode &&
      row.shipperCountryCode !== query.shipperCountryCode
    ) {
      return false;
    }
    if (query.hsChapter && row.hsChapter !== query.hsChapter) {
      return false;
    }
    if (
      query.cargoDescriptionContains &&
      !containsCaseInsensitive(row.cargoDescription, query.cargoDescriptionContains)
    ) {
      return false;
    }
    if (
      query.consigneeNameContains &&
      !containsCaseInsensitive(row.consigneeName, query.consigneeNameContains)
    ) {
      return false;
    }
    if (query.excludeRedacted && row.dataRedacted) {
      return false;
    }
    return true;
  });
}

function containsCaseInsensitive(
  haystack: string | null | undefined,
  needle: string,
): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * One shipment row plus every CPSC recall that overlapped it, ranked
 * strongest-first. This is the bridge between step 2 (match) and step 3
 * (search): a caller (e.g. Marketing's agent) can now run one call —
 * `queryShipmentsWithRecallMatches(rows, query, recalls)` — instead of
 * manually looping queryShipments() output through rankRecallMatches()
 * itself. Kept as a thin composition of the two existing pure functions
 * (no new matching logic) so step 2/3's independently-tested behavior is
 * reused as-is rather than duplicated.
 */
export interface ShipmentWithRecallMatches {
  shipment: ImportShipmentRow;
  recallMatches: RecallMatch[];
}

/**
 * Filter shipments by ShipmentQuery, then rank CPSC recall overlap for
 * each surviving row. `recalls` is the caller-supplied live CPSC feed
 * (see lib/sources/fetch.ts parseCpscRecallsJson) — this function does no
 * fetching itself, matching the "pure function, caller owns I/O" posture
 * of queryShipments/rankRecallMatches.
 *
 * onlyWithMatches (default true) drops shipments with zero recall overlap
 * so a caller building a lead list doesn't have to filter empty arrays
 * itself — set false to see the full filtered shipment set regardless of
 * recall overlap.
 */
export function queryShipmentsWithRecallMatches(
  rows: ImportShipmentRow[],
  query: ShipmentQuery,
  recalls: RegulationEntry[],
  options: { onlyWithMatches?: boolean } = {},
): ShipmentWithRecallMatches[] {
  const onlyWithMatches = options.onlyWithMatches ?? true;
  return queryShipments(rows, query)
    .map((shipment) => ({
      shipment,
      recallMatches: rankRecallMatches(shipment, recalls),
    }))
    .filter((row) => !onlyWithMatches || row.recallMatches.length > 0);
}
