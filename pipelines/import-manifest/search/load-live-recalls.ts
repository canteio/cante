/**
 * Volza-replacement pipeline — bridges step 3's
 * queryShipmentsWithRecallMatches() to Cante's EXISTING live CPSC recall
 * feed (lib/sources/registry.ts `us-cpsc-recalls`, fetched via
 * fetchAllSources/parseCpscRecallsJson in lib/sources/fetch.ts), so a
 * caller doesn't have to know that registry plumbing exists or re-derive
 * "which SourceDefinition is the CPSC one" itself.
 *
 * This does NOT touch the manifest data source blocker (step 1) — it only
 * removes the *other* half of step 3's "not yet wired to a real DB/data
 * source" gap, the recalls side, since that source is already live and
 * already used elsewhere in the app (see app/api/checks/route.ts ->
 * lib/checks/run.ts).
 *
 * Split into a pure finder (unit-testable, no network) and a thin
 * network-calling wrapper, matching the "pure function, caller owns I/O"
 * posture used throughout this pipeline (queryShipments,
 * rankRecallMatches) — the impure half is kept as small as possible.
 */

import { fetchAllSources, type RegulationEntry } from "@/lib/sources/fetch";
import { SOURCE_REGISTRY, type SourceDefinition } from "@/lib/sources/registry";

export const CPSC_RECALLS_SOURCE_ID = "us-cpsc-recalls";

/**
 * Pure lookup: find the CPSC recalls source definition in a registry array.
 * Exposed separately from loadLiveCpscRecalls so tests can assert the
 * lookup logic without hitting the network or importing fetchAllSources'
 * side effects.
 */
export function findCpscRecallSource(
  sources: SourceDefinition[],
): SourceDefinition | undefined {
  return sources.find((source) => source.id === CPSC_RECALLS_SOURCE_ID);
}

/**
 * Fetch the live CPSC recall feed and return just the parsed entries,
 * ready to pass straight into queryShipmentsWithRecallMatches()'s `recalls`
 * argument. Throws if the source definition is missing from the registry
 * (a real bug, not a network hiccup) but returns an empty array (not a
 * throw) on a fetch/parse failure — matching fetchAllSources' own
 * "record the failure, don't crash the caller" posture, since a transient
 * CPSC outage shouldn't take down a lead-scoring run.
 */
export async function loadLiveCpscRecalls(
  rawDir: string,
): Promise<RegulationEntry[]> {
  const source = findCpscRecallSource(SOURCE_REGISTRY);
  if (!source) {
    throw new Error(
      `${CPSC_RECALLS_SOURCE_ID} is missing from SOURCE_REGISTRY — registry may have been renamed/removed.`,
    );
  }
  const report = await fetchAllSources([source], rawDir);
  return report.regulations;
}
