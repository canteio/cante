import { parseCsv } from "@/lib/catalogue/csv";
import { isStrictIsoDate } from "@/lib/tariff/date";
import type { UsmcaQualificationInput } from "@/lib/tariff/stack";

/**
 * Bulk input for the tariff-stacking calculator — exactly what Kate Chang
 * asked for: "upload some HTS codes and countries of origin and it spits
 * out the tariff rate and how you got there," as a spreadsheet, not a
 * one-row-at-a-time form.
 *
 * Accepts a small set of header aliases because customs/trade teams do not
 * agree on column names (Toro's own spreadsheet uses different headers than
 * a classification system export would).
 */
export interface StackRequestRow {
  rowNumber: number;
  htsCode: string;
  countryOfOrigin: string;
  value: number | null;
  quantity: number | null;
  unit: string | null;
  claimedProgramme: string | null;
  importDate: string | null;
  steelContentValue: number | null;
  aluminumContentValue: number | null;
  usmcaQualification: UsmcaQualificationInput | null;
}

export interface StackRequestRowError {
  rowNumber: number;
  raw: Record<string, string>;
  reason: string;
}

export interface ParsedStackRequest {
  rows: StackRequestRow[];
  errors: StackRequestRowError[];
}

const HTS_HEADER_ALIASES = ["hts_code", "htscode", "hts", "code", "classification", "tariff_code"];
const COUNTRY_HEADER_ALIASES = ["country_of_origin", "countryoforigin", "country", "origin", "coo"];
const VALUE_HEADER_ALIASES = ["value", "customs_value", "shipment_value", "declared_value"];
const QUANTITY_HEADER_ALIASES = ["quantity", "qty"];
const UNIT_HEADER_ALIASES = ["unit", "uom", "unit_of_measure"];
const PROGRAMME_HEADER_ALIASES = ["programme", "program", "fta", "claimed_programme", "special_programme"];
const IMPORT_DATE_HEADER_ALIASES = ["import_date", "importdate", "date", "entry_date", "shipment_date"];
const STEEL_CONTENT_VALUE_ALIASES = ["steel_content_value", "steelcontentvalue", "steel_value"];
const ALUMINUM_CONTENT_VALUE_ALIASES = [
  "aluminum_content_value",
  "aluminium_content_value",
  "aluminumcontentvalue",
  "aluminiumcontentvalue",
  "aluminum_value",
  "aluminium_value",
];
const USMCA_VERIFIED_ALIASES = ["usmca_verified", "usmcaverified", "usmca_qualification_verified"];
const USMCA_DECISION_ALIASES = ["usmca_decision", "usmcadecision", "usmca_qualification_decision"];
const USMCA_DETAILS_ALIASES = ["usmca_details", "usmcadetails", "usmca_qualification_details"];

function firstPresent(row: Record<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Detects when a row has values under two *different* recognised aliases
 * for the same logical field that disagree (e.g. both `country` and `coo`
 * present with different values). Silently picking the first alias in
 * priority order would discard the conflicting data without telling the
 * uploader, which is a real risk on hand-edited trade spreadsheets that
 * accumulate duplicate/legacy columns. Agreeing duplicates are harmless and
 * not flagged.
 */
function conflictingAlias(row: Record<string, string>, aliases: string[]): string | null {
  const present = aliases
    .map((alias) => ({ alias, value: row[alias]?.trim() ?? "" }))
    .filter((entry) => entry.value !== "");
  if (present.length < 2) return null;
  const distinctValues = new Set(present.map((entry) => entry.value.toLowerCase()));
  if (distinctValues.size <= 1) return null;
  return present.map((entry) => `${entry.alias}="${entry.value}"`).join(" vs. ");
}

/**
 * Detects a CSV whose header row names the same normalized column twice
 * (e.g. two literal "country" columns). lib/catalogue/csv.ts's generic
 * parser silently keeps only the last duplicate's value per row, which is
 * the right behaviour for existing catalogue imports but would otherwise
 * let a bulk tariff upload lose a column with no error at all here.
 */
function duplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) duplicates.add(header);
    seen.add(header);
  }
  return [...duplicates];
}

/** Bound bulk uploads so one request cannot hang the USITC lookup indefinitely. */
export const MAX_BULK_ROWS = 500;

export function parseStackRequestRows(input: string): ParsedStackRequest {
  let table;
  try {
    // rawRows is intentionally generous (10x MAX_BULK_ROWS): the request body
    // is already bounded to 2 MiB upstream (see app/api/tariff/stack/bulk/
    // route.ts's readBoundedText), so a file with more rows than the bulk
    // processing cap should still parse and get the friendly "only the first
    // N were processed" truncation message below, not a blunt structural
    // rejection. columns/cellCharacters are what close the real amplification
    // gap (a tiny file with thousands of columns) — those stay tight.
    table = parseCsv(input, { columns: 64, rawRows: MAX_BULK_ROWS * 10, cellCharacters: 2_000 });
  } catch {
    return { rows: [], errors: [{ rowNumber: 0, raw: {}, reason: `CSV exceeds structural limits (64 columns, ${MAX_BULK_ROWS * 10} raw rows, 2000 characters per cell).` }] };
  }
  const rows: StackRequestRow[] = [];
  const errors: StackRequestRowError[] = [];

  const dupes = duplicateHeaders(table.headers);
  if (dupes.length > 0) {
    errors.push({
      rowNumber: 0,
      raw: {},
      reason: `Header row repeats column(s) ${dupes.join(", ")} — only the last matching value per row would be kept, so this file was not processed. Rename the duplicate column(s) and re-upload.`,
    });
    return { rows, errors };
  }

  table.rows.slice(0, MAX_BULK_ROWS).forEach((raw, index) => {
    const rowNumber = index + 1;

    const htsConflict = conflictingAlias(raw, HTS_HEADER_ALIASES);
    if (htsConflict) {
      errors.push({ rowNumber, raw, reason: `Conflicting HTS code columns: ${htsConflict}.` });
      return;
    }
    const countryConflict = conflictingAlias(raw, COUNTRY_HEADER_ALIASES);
    if (countryConflict) {
      errors.push({ rowNumber, raw, reason: `Conflicting country-of-origin columns: ${countryConflict}.` });
      return;
    }
    const optionalAliasGroups: Array<[string, string[]]> = [
      ["shipment value", VALUE_HEADER_ALIASES],
      ["quantity", QUANTITY_HEADER_ALIASES],
      ["unit", UNIT_HEADER_ALIASES],
      ["programme", PROGRAMME_HEADER_ALIASES],
      ["import date", IMPORT_DATE_HEADER_ALIASES],
      ["steel content value", STEEL_CONTENT_VALUE_ALIASES],
      ["aluminum content value", ALUMINUM_CONTENT_VALUE_ALIASES],
      ["USMCA verified", USMCA_VERIFIED_ALIASES],
      ["USMCA decision", USMCA_DECISION_ALIASES],
      ["USMCA details", USMCA_DETAILS_ALIASES],
    ];
    for (const [label, aliases] of optionalAliasGroups) {
      const conflict = conflictingAlias(raw, aliases);
      if (conflict) {
        errors.push({ rowNumber, raw, reason: `Conflicting ${label} columns: ${conflict}.` });
        return;
      }
    }

    const htsCode = firstPresent(raw, HTS_HEADER_ALIASES);
    const countryOfOrigin = firstPresent(raw, COUNTRY_HEADER_ALIASES);

    if (!htsCode || !countryOfOrigin) {
      errors.push({
        rowNumber,
        raw,
        reason: !htsCode
          ? "No HTS code column recognised (expected one of: hts_code, hts, code, classification)."
          : "No country-of-origin column recognised (expected one of: country_of_origin, country, origin, coo).",
      });
      return;
    }
    if (htsCode.length > 64) {
      errors.push({ rowNumber, raw, reason: "HTS code must be 64 characters or fewer." });
      return;
    }
    if (!/^\d{4}(?:\.?\d{1,4}){0,4}$/.test(htsCode)) {
      errors.push({ rowNumber, raw, reason: "Invalid HTS syntax." });
      return;
    }
    if ((firstPresent(raw, UNIT_HEADER_ALIASES)?.length ?? 0) > 32) {
      errors.push({ rowNumber, raw, reason: "Unit must be 32 characters or fewer." });
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(countryOfOrigin)) {
      errors.push({ rowNumber, raw, reason: "Country of origin must be a 2-letter code." });
      return;
    }
    const claimedProgramme = firstPresent(raw, PROGRAMME_HEADER_ALIASES);
    if (claimedProgramme !== null && claimedProgramme.length > 32) {
      errors.push({ rowNumber, raw, reason: "Programme must be 32 characters or fewer." });
      return;
    }

    const rawValue = firstPresent(raw, VALUE_HEADER_ALIASES);
    const normalizedValue = rawValue?.replace(/[,$]/g, "").trim() ?? null;
    const value = rawValue === null
      ? null
      : normalizedValue === ""
        ? Number.NaN
        : Number(normalizedValue);
    if (rawValue !== null && (!Number.isFinite(value) || (value ?? -1) < 0)) {
      errors.push({ rowNumber, raw, reason: `Value "${rawValue}" is not a usable, non-negative number.` });
      return;
    }

    const rawQuantity = firstPresent(raw, QUANTITY_HEADER_ALIASES);
    const normalizedQuantity = rawQuantity?.replace(/,/g, "").trim() ?? null;
    const quantity = rawQuantity === null
      ? null
      : normalizedQuantity === ""
        ? Number.NaN
        : Number(normalizedQuantity);
    if (rawQuantity !== null && (!Number.isFinite(quantity) || (quantity ?? -1) < 0)) {
      errors.push({ rowNumber, raw, reason: `Quantity "${rawQuantity}" is not a usable, non-negative number.` });
      return;
    }

    const rawSteelContentValue = firstPresent(raw, STEEL_CONTENT_VALUE_ALIASES);
    const normalizedSteelContentValue = rawSteelContentValue?.replace(/[,$]/g, "").trim() ?? null;
    const steelContentValue = rawSteelContentValue === null
      ? null
      : normalizedSteelContentValue === ""
        ? Number.NaN
        : Number(normalizedSteelContentValue);
    if (rawSteelContentValue !== null && (!Number.isFinite(steelContentValue) || (steelContentValue ?? -1) < 0)) {
      errors.push({ rowNumber, raw, reason: `Steel content value "${rawSteelContentValue}" is not a usable, non-negative number.` });
      return;
    }

    const rawAluminumContentValue = firstPresent(raw, ALUMINUM_CONTENT_VALUE_ALIASES);
    const normalizedAluminumContentValue = rawAluminumContentValue?.replace(/[,$]/g, "").trim() ?? null;
    const aluminumContentValue = rawAluminumContentValue === null
      ? null
      : normalizedAluminumContentValue === ""
        ? Number.NaN
        : Number(normalizedAluminumContentValue);
    if (rawAluminumContentValue !== null && (!Number.isFinite(aluminumContentValue) || (aluminumContentValue ?? -1) < 0)) {
      errors.push({ rowNumber, raw, reason: `Aluminum content value "${rawAluminumContentValue}" is not a usable, non-negative number.` });
      return;
    }
    if (
      value !== null &&
      ((steelContentValue !== null && steelContentValue > value) ||
        (aluminumContentValue !== null && aluminumContentValue > value) ||
        (steelContentValue ?? 0) + (aluminumContentValue ?? 0) > value)
    ) {
      errors.push({ rowNumber, raw, reason: "Metal content values cannot individually or together exceed shipment value." });
      return;
    }

    const rawUsmcaVerified = firstPresent(raw, USMCA_VERIFIED_ALIASES);
    const normalizedUsmcaVerified = rawUsmcaVerified?.trim().toLowerCase() ?? null;
    if (normalizedUsmcaVerified !== null && !["true", "false", "yes", "no"].includes(normalizedUsmcaVerified)) {
      errors.push({ rowNumber, raw, reason: `USMCA verified value "${rawUsmcaVerified}" must be true/false or yes/no.` });
      return;
    }
    const rawUsmcaDecision = firstPresent(raw, USMCA_DECISION_ALIASES);
    const normalizedUsmcaDecision = rawUsmcaDecision?.trim().toLowerCase().replace(/[ -]+/g, "_") ?? null;
    if (normalizedUsmcaDecision !== null && normalizedUsmcaDecision !== "qualifies" && normalizedUsmcaDecision !== "does_not_qualify") {
      errors.push({ rowNumber, raw, reason: `USMCA decision "${rawUsmcaDecision}" must be qualifies or does_not_qualify.` });
      return;
    }
    const usmcaDecision: UsmcaQualificationInput["decision"] =
      normalizedUsmcaDecision === "qualifies" || normalizedUsmcaDecision === "does_not_qualify"
        ? normalizedUsmcaDecision
        : null;
    const usmcaDetails = firstPresent(raw, USMCA_DETAILS_ALIASES);
    if (usmcaDetails !== null && usmcaDetails.length > 2_000) {
      errors.push({ rowNumber, raw, reason: "USMCA details must be 2000 characters or fewer." });
      return;
    }
    const usmcaQualification = rawUsmcaVerified === null && rawUsmcaDecision === null && usmcaDetails === null
      ? null
      : {
          verified: normalizedUsmcaVerified === "true" || normalizedUsmcaVerified === "yes",
          decision: usmcaDecision,
          details: usmcaDetails,
        };

    const rawImportDate = firstPresent(raw, IMPORT_DATE_HEADER_ALIASES);
    if (rawImportDate !== null && !isStrictIsoDate(rawImportDate)) {
      errors.push({ rowNumber, raw, reason: `Import date "${rawImportDate}" is not a usable ISO date (expected YYYY-MM-DD).` });
      return;
    }

    rows.push({
      rowNumber,
      htsCode,
      countryOfOrigin,
      value: rawValue === null ? null : (value as number),
      quantity: rawQuantity === null ? null : (quantity as number),
      unit: firstPresent(raw, UNIT_HEADER_ALIASES),
      claimedProgramme,
      importDate: rawImportDate,
      steelContentValue,
      aluminumContentValue,
      usmcaQualification,
    });
  });

  if (table.rows.length > MAX_BULK_ROWS) {
    errors.push({
      rowNumber: MAX_BULK_ROWS + 1,
      raw: {},
      reason: `File has ${table.rows.length} data rows; only the first ${MAX_BULK_ROWS} were processed.`,
    });
  }

  return { rows, errors };
}
