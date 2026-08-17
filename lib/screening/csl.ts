import { z } from "zod";

export const CSL_DATASET_URL =
  "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json";

export const SCREENING_LIMITS = {
  maxNames: 25,
  maxNameLength: 200,
  maxTotalNameLength: 2_000,
  maxMatches: 100,
  maxAddressesPerMatch: 20,
} as const;

const CACHE_TTL_MS = 15 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_DATASET_BYTES = 80_000_000;
const MAX_DATASET_RECORDS = 100_000;

const CAVEATS = [
  "This endpoint performs exact normalized-name matching only. It does not perform fuzzy matching, transliteration, or identity resolution.",
  "No hit does not clear the party or establish compliance with ownership, end-use, end-user, destination, or license obligations.",
  "Potential matches require human review and confirmation against the originating U.S. government list.",
] as const;

const ScreeningRequestSchema = z
  .object({
    names: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Names cannot be empty.")
          .max(
            SCREENING_LIMITS.maxNameLength,
            `Each name must be at most ${SCREENING_LIMITS.maxNameLength} characters.`,
          ),
      )
      .min(1, "At least one name is required.")
      .max(
        SCREENING_LIMITS.maxNames,
        `At most ${SCREENING_LIMITS.maxNames} names may be screened per request.`,
      ),
  })
  .strict();

type CslAddress = {
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

type CslRecord = {
  name: string;
  altNames: string[];
  source: string;
  sourceUrl: string;
  addresses: CslAddress[];
};

type IndexedName = {
  recordIndex: number;
  matchedName: string;
  matchField: "primary" | "alias";
};

type CslSnapshot = {
  fetchedAt: number;
  records: CslRecord[];
  names: Map<string, IndexedName[]>;
};

export type ScreeningMatch = {
  queriedName: string;
  matchedName: string;
  matchField: "primary" | "alias";
  primaryName: string;
  sourceList: string;
  sourceUrl: string;
  addresses: CslAddress[];
  addressesTruncated: boolean;
  countries: string[];
};

export type ScreeningResult = {
  source: "Trade.gov Consolidated Screening List";
  sourceUrl: string;
  matchMethod: "exact-normalized-name";
  screenedNames: string[];
  unmatchedNames: string[];
  matches: ScreeningMatch[];
  matchesTruncated: boolean;
  fetchedAt: string;
  caveats: string[];
};

export class ScreeningInputError extends Error {
  readonly status = 400;
}

export class CslUpstreamError extends Error {
  readonly status = 502;
}

let cachedSnapshot: CslSnapshot | null = null;
let pendingSnapshot: Promise<CslSnapshot> | null = null;

export function normalizeScreeningName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseScreeningRequest(input: unknown): string[] {
  const parsed = ScreeningRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ScreeningInputError(parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const totalLength = parsed.data.names.reduce((sum, name) => sum + name.length, 0);
  if (totalLength > SCREENING_LIMITS.maxTotalNameLength) {
    throw new ScreeningInputError(
      `Submitted names must total at most ${SCREENING_LIMITS.maxTotalNameLength} characters.`,
    );
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of parsed.data.names) {
    const normalized = normalizeScreeningName(name);
    if (!normalized) {
      throw new ScreeningInputError("Each name must contain at least one letter or number.");
    }
    if (!seen.has(normalized)) {
      names.push(name);
      seen.add(normalized);
    }
  }
  return names;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new CslUpstreamError(`Trade.gov CSL record field ${field} is malformed.`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function parseAddress(value: unknown): CslAddress {
  if (!isObject(value)) {
    throw new CslUpstreamError("Trade.gov CSL record contains a malformed address.");
  }
  return {
    address: optionalString(value.address, "addresses.address"),
    city: optionalString(value.city, "addresses.city"),
    state: optionalString(value.state, "addresses.state"),
    postalCode: optionalString(value.postal_code, "addresses.postal_code"),
    country: optionalString(value.country, "addresses.country"),
  };
}

function parseRecord(value: unknown): CslRecord {
  if (!isObject(value)) {
    throw new CslUpstreamError("Trade.gov CSL contains a malformed record.");
  }

  const name = optionalString(value.name, "name");
  const source = optionalString(value.source, "source");
  if (!name || !source) {
    throw new CslUpstreamError("Trade.gov CSL record is missing a name or source list.");
  }

  if (value.alt_names !== null && value.alt_names !== undefined && !Array.isArray(value.alt_names)) {
    throw new CslUpstreamError("Trade.gov CSL record field alt_names is malformed.");
  }
  const altNames = (value.alt_names ?? []).flatMap((alias, index) => {
    const parsed = optionalString(alias, `alt_names[${index}]`);
    return parsed ? [parsed] : [];
  });

  if (value.addresses !== null && value.addresses !== undefined && !Array.isArray(value.addresses)) {
    throw new CslUpstreamError("Trade.gov CSL record field addresses is malformed.");
  }
  const addresses = (value.addresses ?? []).map(parseAddress);
  const sourceUrl =
    optionalString(value.source_list_url, "source_list_url") ??
    optionalString(value.source_information_url, "source_information_url") ??
    CSL_DATASET_URL;

  return { name, altNames, source, sourceUrl, addresses };
}

function parseDataset(value: unknown): CslRecord[] {
  if (!isObject(value) || !Array.isArray(value.results)) {
    throw new CslUpstreamError("Trade.gov CSL response is missing its results array.");
  }
  if (value.results.length > MAX_DATASET_RECORDS) {
    throw new CslUpstreamError("Trade.gov CSL response exceeds the supported record limit.");
  }
  return value.results.map(parseRecord);
}

function buildSnapshot(records: CslRecord[], fetchedAt: number): CslSnapshot {
  const names = new Map<string, IndexedName[]>();
  const add = (normalized: string, candidate: IndexedName) => {
    if (!normalized) return;
    const current = names.get(normalized);
    if (current) current.push(candidate);
    else names.set(normalized, [candidate]);
  };

  records.forEach((record, recordIndex) => {
    add(normalizeScreeningName(record.name), {
      recordIndex,
      matchedName: record.name,
      matchField: "primary",
    });
    for (const alias of record.altNames) {
      add(normalizeScreeningName(alias), {
        recordIndex,
        matchedName: alias,
        matchField: "alias",
      });
    }
  });
  return { fetchedAt, records, names };
}

async function fetchSnapshot(): Promise<CslSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(CSL_DATASET_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Cante compliance screening (local exact-name matcher)",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CslUpstreamError(`Trade.gov CSL returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DATASET_BYTES) {
      throw new CslUpstreamError("Trade.gov CSL response exceeds the supported size limit.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_DATASET_BYTES) {
      throw new CslUpstreamError("Trade.gov CSL response exceeds the supported size limit.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new CslUpstreamError("Trade.gov CSL returned invalid JSON.");
    }
    return buildSnapshot(parseDataset(payload), Date.now());
  } catch (error) {
    if (error instanceof CslUpstreamError) throw error;
    if (controller.signal.aborted) {
      throw new CslUpstreamError("Trade.gov CSL request timed out.");
    }
    throw new CslUpstreamError(
      `Trade.gov CSL could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function getSnapshot(): Promise<CslSnapshot> {
  if (cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }
  if (!pendingSnapshot) {
    pendingSnapshot = fetchSnapshot()
      .then((snapshot) => {
        cachedSnapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        pendingSnapshot = null;
      });
  }
  return pendingSnapshot;
}

export async function screenExactNames(input: unknown): Promise<ScreeningResult> {
  const screenedNames = parseScreeningRequest(input);
  const snapshot = await getSnapshot();
  const matches: ScreeningMatch[] = [];
  const matchedQueries = new Set<string>();
  let matchesTruncated = false;

  for (const queriedName of screenedNames) {
    const normalized = normalizeScreeningName(queriedName);
    const candidates = snapshot.names.get(normalized) ?? [];
    const seenRecords = new Set<number>();
    for (const candidate of candidates) {
      if (seenRecords.has(candidate.recordIndex)) continue;
      seenRecords.add(candidate.recordIndex);
      matchedQueries.add(normalized);
      if (matches.length >= SCREENING_LIMITS.maxMatches) {
        matchesTruncated = true;
        continue;
      }

      const record = snapshot.records[candidate.recordIndex];
      const addresses = record.addresses.slice(0, SCREENING_LIMITS.maxAddressesPerMatch);
      matches.push({
        queriedName,
        matchedName: candidate.matchedName,
        matchField: candidate.matchField,
        primaryName: record.name,
        sourceList: record.source,
        sourceUrl: record.sourceUrl,
        addresses,
        addressesTruncated: record.addresses.length > addresses.length,
        countries: [
          ...new Set(record.addresses.map((address) => address.country).filter(Boolean)),
        ] as string[],
      });
    }
  }

  return {
    source: "Trade.gov Consolidated Screening List",
    sourceUrl: CSL_DATASET_URL,
    matchMethod: "exact-normalized-name",
    screenedNames,
    unmatchedNames: screenedNames.filter(
      (name) => !matchedQueries.has(normalizeScreeningName(name)),
    ),
    matches,
    matchesTruncated,
    fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
    caveats: [...CAVEATS],
  };
}

export function resetCslCacheForTests(): void {
  cachedSnapshot = null;
  pendingSnapshot = null;
}
