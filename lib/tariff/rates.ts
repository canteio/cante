import {
  computeDuty,
  parseDutyRate,
  specialProgrammeCodes,
  type DutyComputation,
  type DutyRate,
} from "@/lib/tariff/duty-expression";

/**
 * Duty rates from the official USITC HTS REST endpoint.
 *
 * This is the reference-data layer Cante was missing. Before it, every
 * exposure figure in lib/impact/assess.ts required the caller to hand in
 * `duty.before` and `duty.after` — the arithmetic existed and the operands
 * never did, so almost every US assessment rendered "not calculable". The HTS
 * source was already fetching these rates on every run and flattening them
 * into prose.
 *
 * Scope, stated plainly: **US import duty only.** There is no Indonesian
 * tariff schedule here, and Indonesia does not levy export duty on PVC
 * tarpaulin anyway (bea keluar covers listed commodities). Callers must not
 * present a US rate as applying to an Indonesian movement.
 */

const HTS_SEARCH = "https://hts.usitc.gov/reststop/search";
const TIMEOUT_MS = 20_000;

export interface TariffRow {
  htsCode: string;
  description: string;
  units: string[];
  /** Column 1 general — the normal-trade-relations rate most imports pay. */
  general: DutyRate;
  /** Column 1 special — FTA/preference rates, with the programme codes. */
  special: DutyRate;
  specialProgrammes: string[];
  /** Column 2 — applies to a small set of non-NTR countries. */
  column2: DutyRate;
  /** Chapter 99 cross-references (Section 301/232 and similar), verbatim. */
  additionalDuties: string | null;
  fetchedAt: string;
}

export class TariffLookupError extends Error {
  readonly status = 502;
}

/**
 * Rates change on HTS revisions, not by the minute, so a short in-process
 * cache keeps a run from hammering the endpoint once per SKU per finding.
 */
const cache = new Map<string, { row: TariffRow | null; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export function resetTariffCacheForTests(): void {
  cache.clear();
}

function digits(code: string): string {
  return code.replace(/\D/g, "");
}

/** Prefix-compatible: a rule at 6306.12 covers a catalogue code 6306.12.00.00. */
function codesOverlap(a: string, b: string): boolean {
  const x = digits(a);
  const y = digits(b);
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

interface RawHtsRow {
  htsno?: unknown;
  description?: unknown;
  units?: unknown;
  general?: unknown;
  special?: unknown;
  other?: unknown;
  additionalDuties?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Look up the tariff row for a code.
 *
 * Returns `null` when the endpoint answered but had no matching row — a real,
 * quiet result. Throws only when the lookup itself failed, so a caller can
 * tell "no such code" from "we could not ask".
 */
export async function lookupTariff(
  code: string,
  options: { signal?: AbortSignal; now?: number } = {},
): Promise<TariffRow | null> {
  const key = digits(code);
  if (!key) throw new TariffLookupError(`"${code}" is not a usable tariff code.`);

  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.row;

  const url = `${HTS_SEARCH}?${new URLSearchParams({ keyword: code }).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let payload: unknown;
  try {
    const res = await fetch(url, {
      signal: options.signal ?? controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new TariffLookupError(`USITC HTS returned HTTP ${res.status}.`);
    payload = await res.json();
  } catch (error) {
    if (error instanceof TariffLookupError) throw error;
    throw new TariffLookupError(
      `Could not reach the USITC HTS service: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(payload)) {
    throw new TariffLookupError("USITC HTS returned an unexpected payload shape.");
  }

  // Prefer the most specific matching row — a 10-digit statistical line over
  // the heading it sits under, since that is what an entry actually declares.
  const candidates = (payload as RawHtsRow[])
    .filter((row) => {
      const htsno = str(row.htsno);
      return Boolean(htsno && codesOverlap(htsno, code));
    })
    .sort((a, b) => digits(str(b.htsno) ?? "").length - digits(str(a.htsno) ?? "").length);

  const match = candidates[0];
  if (!match) {
    cache.set(key, { row: null, expiresAt: now + CACHE_TTL_MS });
    return null;
  }

  const special = str(match.special);
  const row: TariffRow = {
    htsCode: str(match.htsno) ?? code,
    description: str(match.description) ?? "",
    units: Array.isArray(match.units) ? match.units.filter((u): u is string => typeof u === "string") : [],
    general: parseDutyRate(str(match.general)),
    special: parseDutyRate(special),
    specialProgrammes: specialProgrammeCodes(special),
    column2: parseDutyRate(str(match.other)),
    additionalDuties: str(match.additionalDuties),
    fetchedAt: new Date(now).toISOString(),
  };

  cache.set(key, { row, expiresAt: now + CACHE_TTL_MS });
  return row;
}

export interface DutyQuote {
  htsCode: string;
  /** general | special | column2 — which column was applied, and why. */
  column: "general" | "special" | "column2";
  rate: DutyRate;
  computation: DutyComputation;
  /** Chapter 99 measures that may add to this, unresolved. */
  additionalDutiesNote: string | null;
  caveats: string[];
}

/**
 * Quote the duty on a shipment.
 *
 * **Defaults to the general (NTR) column and says so.** Claiming an FTA
 * preferential rate requires a qualifying certificate of origin and a rules-of-
 * origin analysis Cante does not perform, so `special` is only quoted when the
 * caller explicitly asserts a claimed programme — and even then the quote
 * carries a caveat that eligibility is unverified.
 */
export async function quoteDuty(input: {
  htsCode: string;
  value: number | null;
  quantity?: number | null;
  unit?: string | null;
  /** An HTS special-programme symbol the importer claims, e.g. "S" for USMCA. */
  claimedProgramme?: string | null;
  signal?: AbortSignal;
}): Promise<DutyQuote | null> {
  const row = await lookupTariff(input.htsCode, { signal: input.signal });
  if (!row) return null;

  const caveats: string[] = [];
  let column: DutyQuote["column"] = "general";
  let rate = row.general;

  if (input.claimedProgramme) {
    const claimed = input.claimedProgramme.trim().toUpperCase();
    if (row.specialProgrammes.map((p) => p.toUpperCase()).includes(claimed)) {
      column = "special";
      rate = row.special;
      caveats.push(
        `Quoted at the special rate for programme "${claimed}". Cante has NOT verified that the goods satisfy that programme's rules of origin, and a claim without a valid certificate of origin is the importer's exposure, not a saving.`,
      );
    } else {
      caveats.push(
        `Programme "${claimed}" is not listed among this row's special programmes (${row.specialProgrammes.join(", ") || "none published"}), so the general rate was used.`,
      );
    }
  } else {
    caveats.push(
      "Quoted at the Column 1 general (NTR) rate. FTA preference was not claimed and is not assumed.",
    );
  }

  if (row.additionalDuties) {
    caveats.push(
      `This row cross-references additional duties (${row.additionalDuties}). Section 301/232 and similar Chapter 99 measures are NOT included in the figure below and can materially exceed the base rate.`,
    );
  }

  return {
    htsCode: row.htsCode,
    column,
    rate,
    computation: computeDuty(rate, {
      value: input.value,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
    }),
    additionalDutiesNote: row.additionalDuties,
    caveats,
  };
}

/**
 * The delta between two classifications on the same shipment — the number
 * behind "you may have overpaid" and "this reclassification costs you X".
 */
export interface DutyDelta {
  declared: DutyQuote | null;
  expected: DutyQuote | null;
  /** expected − declared. Positive means the declared code under-paid. */
  difference: number | null;
  currency: "USD";
  basis: string[];
}

export async function compareDuty(input: {
  declaredCode: string;
  expectedCode: string;
  value: number | null;
  quantity?: number | null;
  unit?: string | null;
  signal?: AbortSignal;
}): Promise<DutyDelta> {
  const [declared, expected] = await Promise.all([
    quoteDuty({ ...input, htsCode: input.declaredCode }),
    quoteDuty({ ...input, htsCode: input.expectedCode }),
  ]);

  const basis: string[] = [];
  if (!declared) basis.push(`No published HTS row was found for the declared code ${input.declaredCode}.`);
  if (!expected) basis.push(`No published HTS row was found for the expected code ${input.expectedCode}.`);

  const a = declared?.computation.amount ?? null;
  const b = expected?.computation.amount ?? null;

  if (a === null || b === null) {
    if (declared) basis.push(`Declared ${declared.htsCode}: ${declared.computation.basis.join(" ")}`);
    if (expected) basis.push(`Expected ${expected.htsCode}: ${expected.computation.basis.join(" ")}`);
    basis.push("One or both sides could not be computed, so no difference is reported.");
    return { declared, expected, difference: null, currency: "USD", basis };
  }

  basis.push(`Declared ${declared!.htsCode} (${declared!.rate.raw}): USD ${a.toFixed(2)}.`);
  basis.push(`Expected ${expected!.htsCode} (${expected!.rate.raw}): USD ${b.toFixed(2)}.`);
  basis.push(...declared!.caveats, ...expected!.caveats);

  return {
    declared,
    expected,
    difference: Number((b - a).toFixed(2)),
    currency: "USD",
    basis,
  };
}
