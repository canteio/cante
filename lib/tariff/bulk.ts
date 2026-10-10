import { parseCsv } from "@/lib/catalogue/csv";
import { isStrictIsoDate } from "@/lib/tariff/date";
import type { UsmcaQualificationInput } from "@/lib/tariff/stack";

/**
 * Bulk input for the tariff-stacking calculator — exactly what the trade
 * compliance team asked for: "upload some HTS codes and countries of origin
 * and it spits out the tariff rate and how you got there," as a spreadsheet,
 * not a one-row-at-a-time form.
 *
 * Accepts a small set of header aliases because customs/trade teams do not
 * agree on column names (an importer's own spreadsheet uses different headers than
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

export const HTS_HEADER_ALIASES = [
  "hts_code", "htscode", "hts", "code", "classification", "tariff_code", "tariff", "tariff_item", "tariff_line", "tariff_heading",
  "hs_code", "hscode", "hs", "commodity_code", "tariff_no", "tariff_number", "harmonized_code", "harmonized_tariff", "hts10", "htscode10",
];
export const COUNTRY_HEADER_ALIASES = [
  "country_of_origin", "countryoforigin", "country", "origin", "coo",
  "origin_country", "source_country", "made_in", "madein", "country_code", "ctry", "origin_ctry", "source",
];
const VALUE_HEADER_ALIASES = [
  "value", "customs_value", "shipment_value", "declared_value",
  "fob_value", "entered_value", "amount", "total_value", "usd_value",
  "cost", "price", "total_price", "line_total", "customs_val", "declared_val", "item_value", "extended_price", "ext_price",
];
const QUANTITY_HEADER_ALIASES = ["quantity", "qty", "units", "pieces", "count"];
const UNIT_HEADER_ALIASES = ["unit", "uom", "unit_of_measure", "qty_unit"];
const PROGRAMME_HEADER_ALIASES = ["programme", "program", "fta", "claimed_programme", "special_programme", "special_program"];
const IMPORT_DATE_HEADER_ALIASES = [
  "import_date", "importdate", "date", "entry_date", "shipment_date",
  "clearance_date", "arrival_date",
];
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

export const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  china: "CN", prc: "CN", chn: "CN",
  vietnam: "VN", "viet nam": "VN", vnm: "VN",
  "united states": "US", usa: "US", us: "US",
  canada: "CA", can: "CA",
  mexico: "MX", mex: "MX",
  germany: "DE", deu: "DE", ger: "DE",
  japan: "JP", jpn: "JP",
  taiwan: "TW", twn: "TW",
  "united kingdom": "GB", uk: "GB", gbr: "GB",
  "south korea": "KR", korea: "KR", kor: "KR",
  france: "FR", fra: "FR",
  italy: "IT", ita: "IT",
  india: "IN", ind: "IN",
  indonesia: "ID", idn: "ID",
  malaysia: "MY", mys: "MY",
  thailand: "TH", tha: "TH",
};

export function normalizeHtsCode(raw: string): string {
  const cleaned = raw.trim().replace(/^hts\s*[:#]?\s*/i, "").replace(/[\s-]+/g, ".");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10 && !cleaned.includes(".")) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8)}`;
  }
  if (digits.length === 8 && !cleaned.includes(".")) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
  }
  if (digits.length === 6 && !cleaned.includes(".")) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
  }
  return cleaned;
}

export function normalizeCountryCode(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  return COUNTRY_NAME_TO_CODE[lower] ?? (trimmed.length === 2 ? trimmed.toUpperCase() : trimmed);
}

export function firstPresent(row: Record<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  // Tolerant fallback for variations with dashes, slashes, numbers, etc. (e.g. "HTS-Code", "HTS #", "Customs Value ($)")
  const normalizedAliases = new Set(aliases.map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [key, val] of Object.entries(row)) {
    if (val && val.trim() !== "") {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalizedAliases.has(normalizedKey)) return val.trim();
    }
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
export function conflictingAlias(row: Record<string, string>, aliases: string[]): string | null {
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
export function duplicateHeaders(headers: string[]): string[] {
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

    const rawHts = firstPresent(raw, HTS_HEADER_ALIASES);
    const rawCountry = firstPresent(raw, COUNTRY_HEADER_ALIASES);

    if (!rawHts || !rawCountry) {
      errors.push({
        rowNumber,
        raw,
        reason: !rawHts
          ? "No HTS code column recognised (expected one of: hts_code, hts, code, classification)."
          : "No country-of-origin column recognised (expected one of: country_of_origin, country, origin, coo).",
      });
      return;
    }
    const htsCode = normalizeHtsCode(rawHts);
    const countryOfOrigin = normalizeCountryCode(rawCountry);

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
    const normalizedValue = rawValue?.replace(/[$€£¥]/g, "").replace(/\b(?:usd|eur|cad|aud|cny|rmb)\b/gi, "").replace(/,/g, "").trim() ?? null;
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

export const impactFieldAliases = {
  qualification_verified: ["qualification_verified", "qualified", "verified"],
  qualification_basis: ["qualification_basis", "basis", "qualification_notes"],
  entry_id: ["entry_id", "entry_number", "entry_no", "entry", "customs_entry", "declaration_no"],
  line_number: ["line_number", "entry_line", "line_id", "line", "line_no", "item_no"],
  customs_value_usd: ["customs_value_usd", "customs_value", "entered_value", "declared_value", "fob_value", "cif_value", "value_usd", "value"],
  paid_duty_usd: ["paid_duty_usd", "paid_duty", "duty_paid", "duty_amount", "duties_paid", "customs_duty", "tariff_paid", "import_tariff_paid", "duty", "duties"],
  sku: ["sku", "product_code", "item_code", "part_number", "part_no", "part_num", "material_number", "model", "item", "part", "part_#", "part_id"],
  hts: HTS_HEADER_ALIASES, origin: COUNTRY_HEADER_ALIASES,
  supplier: ["supplier", "supplier_name", "vendor", "shipper", "exporter", "manufacturer"],
  annual_import_value_usd: ["annual_import_value", "annual_import_value_usd", "annual_value", "import_value", "total_import_value", "spend"],
  current_duty_rate: ["current_duty_rate", "current_duty_rate_percent", "current_rate", "duty_rate", "rate", "tariff_rate"],
  evaluation_date: ["evaluation_date", "import_date", "entry_date", "effective_date", "date", "clearance_date"],
  quantity: ["quantity", "qty", "amount", "units", "count"],
  unit: ["unit", "quantity_unit", "uom", "unit_of_measure"],
  chapter99_codes: ["chapter99_codes", "ch99", "chapter_99", "chapter99_code"],
  exclusion_id: ["exclusion_id", "exclusion", "exclusion_number"],
  special_program_claim: ["special_program_claim", "special_program", "program_claim", "fta", "preference_claim"],
};
