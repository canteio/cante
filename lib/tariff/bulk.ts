import { parseCsv } from "@/lib/catalogue/csv";

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const table = parseCsv(input);
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

    const rawValue = firstPresent(raw, VALUE_HEADER_ALIASES);
    const value = rawValue === null ? null : Number(rawValue.replace(/[,$]/g, ""));
    if (rawValue !== null && (!Number.isFinite(value) || (value as number) < 0)) {
      errors.push({ rowNumber, raw, reason: `Value "${rawValue}" is not a usable, non-negative number.` });
      return;
    }

    const rawQuantity = firstPresent(raw, QUANTITY_HEADER_ALIASES);
    const quantity = rawQuantity === null ? null : Number(rawQuantity.replace(/,/g, ""));
    if (rawQuantity !== null && (!Number.isFinite(quantity) || (quantity as number) < 0)) {
      errors.push({ rowNumber, raw, reason: `Quantity "${rawQuantity}" is not a usable, non-negative number.` });
      return;
    }

    const rawImportDate = firstPresent(raw, IMPORT_DATE_HEADER_ALIASES);
    if (rawImportDate !== null && (!ISO_DATE.test(rawImportDate) || Number.isNaN(Date.parse(rawImportDate)))) {
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
      claimedProgramme: firstPresent(raw, PROGRAMME_HEADER_ALIASES),
      importDate: rawImportDate,
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
