/**
 * Stub fetcher for CBP AMS ocean manifest data.
 *
 * This is intentionally NOT functional yet. There are two real paths
 * documented in docs/import-data-pipeline.md:
 *
 *   1. A CBP FOIA/SecureRelease bulk-data subscription (what ImportYeti says
 *      it did: requested ~70M bills of lading under 19 CFR 103.31). That
 *      needs an actual filing + an ongoing production-cost fee, which is a
 *      business decision for the founder, not something this stub should
 *      silently attempt.
 *   2. A parser for CBP's published CAMIR fixed-width record layouts
 *      (M01/P01/H01), which we CAN build and test today against sample
 *      records without needing live access yet.
 *
 * This stub implements the shape of (2): given raw CAMIR-format manifest
 * text, parse it into rows matching pipelines/import-manifest/schema/shipments.ts.
 * Wire in a real fetch source (FOIA delivery drop, AMS feed, etc.) by
 * replacing `loadRawManifestText`.
 */

export interface RawManifestRecord {
  /** One CAMIR "M01" vessel record line, 80 chars fixed-width per CBP spec. */
  vesselLine?: string;
  /** One CAMIR "P01" port record line, per CBP spec. */
  portLine?: string;
  /** Free-form cargo declaration line(s) for this bill of lading. */
  cargoLines: string[];
}

export interface ParsedShipment {
  vesselName: string | null;
  voyageNumber: string | null;
  carrierScac: string | null;
  portOfLadingCode: string | null;
  portOfUnladingCode: string | null;
}

/**
 * Parse a CAMIR M01 (vessel) record line per the CBP Automated Manifest
 * Download spec: fixed column positions, NOT delimited.
 * https://www.cbp.gov/sites/default/files/2025-09/ImportOcean_IG_CAMIR_Automated%20Mfst%20Dwnld_2025Sept_508_0.pdf
 */
export function parseM01VesselLine(line: string): {
  carrierScac: string | null;
  vesselName: string | null;
  voyageNumber: string | null;
} {
  // Positions are 1-indexed in the CBP spec; slice() is 0-indexed, hence -1.
  if (!line || line.slice(0, 3) !== "M01") {
    return { carrierScac: null, vesselName: null, voyageNumber: null };
  }
  const carrierScac = line.slice(3, 7).trim() || null; // pos 4-7
  const vesselName = line.slice(11, 34).trim() || null; // pos 12-34
  const voyageNumber = line.slice(34, 39).trim() || null; // pos 35-39
  return { carrierScac, vesselName, voyageNumber };
}

/**
 * Parse a CAMIR P01 (port) record line.
 */
export function parseP01PortLine(line: string): {
  carrierScac: string | null;
  portOfUnladingCode: string | null;
} {
  if (!line || line.slice(0, 3) !== "P01") {
    return { carrierScac: null, portOfUnladingCode: null };
  }
  const carrierScac = line.slice(3, 7).trim() || null; // pos 4-7
  const portOfUnladingCode = line.slice(7, 11).trim() || null; // pos 8-11
  return { carrierScac, portOfUnladingCode };
}

/** Placeholder — no live source is wired up yet. See docs/import-data-pipeline.md. */
export async function loadRawManifestText(): Promise<string> {
  throw new Error(
    "No manifest data source configured yet. This requires either a CBP " +
      "FOIA/SecureRelease bulk subscription or a sample CAMIR export file. " +
      "See docs/import-data-pipeline.md for the two documented paths."
  );
}

/** Entry point placeholder — run via `tsx pipelines/import-manifest/fetch/fetch-manifests.ts`. */
async function main() {
  const raw = await loadRawManifestText();
  console.log("Loaded raw manifest text, length:", raw.length);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
