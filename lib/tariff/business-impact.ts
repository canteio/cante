import { parseCsv, type CsvTable } from "@/lib/catalogue/csv";
import { HTS_HEADER_ALIASES, COUNTRY_HEADER_ALIASES, firstPresent, conflictingAlias, duplicateHeaders } from "./bulk";
import { isStrictIsoDate } from "./date";
import { computeStackedDuty, type StackedDutyResult } from "./stack";

export class ImpactInputError extends Error {}
const aliases = {
  sku: ["sku", "product_code", "item_code", "part_number"],
  hts: HTS_HEADER_ALIASES, origin: COUNTRY_HEADER_ALIASES,
  supplier: ["supplier", "supplier_name", "vendor"],
  annual_import_value_usd: ["annual_import_value", "annual_import_value_usd", "annual_value", "import_value"],
  current_duty_rate: ["current_duty_rate", "current_duty_rate_percent", "current_rate", "duty_rate"],
  evaluation_date: ["evaluation_date", "import_date", "entry_date", "effective_date"],
  quantity: ["quantity", "qty"],
  chapter99_codes: ["chapter99_codes", "ch99", "chapter_99", "chapter99_code"],
  exclusion_id: ["exclusion_id", "exclusion", "exclusion_number"],
  special_program_claim: ["special_program_claim", "special_program", "program_claim", "fta"],
};
export interface ImpactRow {
  input_valid: boolean; row_number: number; sku: string | null; hts: string | null; origin: string | null; supplier: string | null;
  annual_import_value_usd: number | null; current_duty_rate: number | null; evaluation_date: string | null;
  quantity: number | null; chapter99_codes: string | null; exclusion_id: string | null; special_program_claim: string | null;
  status: "computed" | "unresolved" | "error"; direction: "increase" | "decrease" | "no_change" | "unknown";
  current_annual_duty_usd: number | null; computed_annual_duty_usd: number | null;
  computed_total_rate: number | null; annual_delta_usd: number | null;
  stack_result: StackedDutyResult | null; raw_input: Record<string, string>; error: string | null;
}
function decimal(value: string | null, percent = false): number | null {
  if (value === null) return null;
  const normalized = percent ? value.replace(/%$/, "").trim() : value;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && (!percent || n <= 100) ? n / (percent ? 100 : 1) : null;
}
export function parseImpactTable(input: string, preserveHeaders = false): CsvTable {
  let table;
  try { table = parseCsv(input, { columns: 64, rawRows: 5000, cellCharacters: 2000 }, true, preserveHeaders); }
  catch { throw new ImpactInputError("Invalid CSV structure or structural limits exceeded."); }
  const duplicates = preserveHeaders ? new Set(table.headers).size !== table.headers.length : duplicateHeaders(table.headers).length > 0;
  if (!table.rows.length || table.rows.length > 500 || duplicates || table.headers.some(h => !h.trim())) {
    throw new ImpactInputError("CSV must have unique headers and 1–500 data rows.");
  }
  return table;
}
export function parseBusinessImpact(input: string): ImpactRow[] {
  return parseImpactRows(parseImpactTable(input).rows);
}

/** Confirmed canonical rows bypass alias discovery; raw evidence stays as uploaded. */
export function parseMappedBusinessImpact(rows: Record<string, string>[], originals: Record<string, string>[]): ImpactRow[] {
  return parseImpactRows(rows, true, originals);
}
function parseImpactRows(rows: Record<string, string>[], canonical = false, originals = rows): ImpactRow[] {
  return rows.map((raw, i) => {
    const values = Object.fromEntries(Object.entries(aliases).map(([key, group]) => [key, canonical ? raw[key]?.trim() || null : firstPresent(raw, group)])) as Record<keyof typeof aliases, string | null>;
    const errors: string[] = [];
    for (const [key, group] of Object.entries(aliases)) {
      if (!canonical && conflictingAlias(raw, group)) errors.push(`Conflicting ${key} columns.`);
      if (!["evaluation_date", "quantity", "chapter99_codes", "exclusion_id", "special_program_claim"].includes(key) && !values[key as keyof typeof aliases]) errors.push(`Missing ${key}.`);
    }
    const quantity = decimal(values.quantity);
    if (values.quantity !== null && quantity === null) errors.push("Quantity must be a non-negative decimal.");
    for (const key of ["chapter99_codes", "exclusion_id", "special_program_claim"] as const) {
      if ((values[key]?.length ?? 0) > 500) errors.push(`${key} exceeds 500 characters.`);
    }
    const value = decimal(values.annual_import_value_usd);
    const rate = decimal(values.current_duty_rate, true);
    if (value === null) errors.push("Annual import value must be a non-negative decimal.");
    if (rate === null) errors.push("Current duty rate must be 0–100 percentage points.");
    if (values.hts && !/^\d{4}(?:\.?\d{1,4}){0,4}$/.test(values.hts)) errors.push("Invalid HTS syntax.");
    if (values.origin && !/^[a-z]{2}$/i.test(values.origin)) errors.push("Origin must be a two-letter code.");
    if (values.evaluation_date && !isStrictIsoDate(values.evaluation_date)) errors.push("Invalid import date.");
    return {
      input_valid: !errors.length, row_number: i + 1, sku: values.sku, hts: values.hts, origin: values.origin?.toUpperCase() ?? null, supplier: values.supplier,
      quantity, chapter99_codes: values.chapter99_codes, exclusion_id: values.exclusion_id, special_program_claim: values.special_program_claim,
      annual_import_value_usd: value, current_duty_rate: rate,
      evaluation_date: values.evaluation_date && isStrictIsoDate(values.evaluation_date) ? values.evaluation_date : null,
      status: errors.length ? "error" : "unresolved", direction: "unknown",
      current_annual_duty_usd: value !== null && rate !== null ? value * rate : null,
      computed_annual_duty_usd: null, computed_total_rate: null, annual_delta_usd: null,
      stack_result: null, raw_input: originals[i], error: errors.length ? errors.join(" ") : null,
    };
  });
}
export async function evaluateBusinessImpact(rows: ImpactRow[], compute = computeStackedDuty, signal?: AbortSignal): Promise<ImpactRow[]> {
  const output = rows.map(row => ({ ...row }));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, async () => {
    while (next < output.length) {
      const row = output[next++];
      if (row.status === "error") continue;
      try {
        // Quantity and customer Chapter 99/exclusion/program claims are context only.
        // Wiring them into computeStackedDuty qualification/quantity parameters is future work.
        const result = await compute({ htsCode: row.hts!, countryOfOrigin: row.origin!, value: row.annual_import_value_usd, importDate: row.evaluation_date, signal });
        row.stack_result = result;
        if (!result) { row.status = "error"; row.error = "No published HTS row matched."; continue; }
        if (result.totalAmount === null || result.totalRatePercent === null || result.unresolvedMeasures.length || !Number.isFinite(result.totalAmount) || !Number.isFinite(result.totalRatePercent)) continue;
        const delta = result.totalAmount - row.current_annual_duty_usd!;
        if (!Number.isFinite(delta)) { row.status = "error"; row.error = "Duty calculation exceeds numeric limits."; continue; }
        row.status = "computed";
        row.computed_annual_duty_usd = result.totalAmount;
        row.computed_total_rate = result.totalRatePercent;
        row.annual_delta_usd = delta;
        row.direction = delta > 0 ? "increase" : delta < 0 ? "decrease" : "no_change";
      } catch { row.status = "error"; row.error = "Tariff calculation unavailable."; }
    }
  }));
  return output;
}
export function summarizeBusinessImpact(rows: ImpactRow[]) {
  const computed = rows.filter(r => r.status === "computed");
  const errors = rows.filter(r => r.status === "error").length;
  const unresolved = rows.filter(r => r.status === "unresolved").length;
  const subtotal = computed.reduce((sum, row) => sum + row.annual_delta_usd!, 0);
  if (!Number.isFinite(subtotal)) throw new ImpactInputError("Portfolio exceeds numeric limits.");
  const dates = new Set(rows.map(r => r.evaluation_date));
  const dateStatus = dates.size === 1 ? (dates.has(null) ? "not_provided" : "single") : "mixed";
  return {
    source_count: rows.length, accepted_count: rows.filter(r => r.input_valid).length,
    computed_count: computed.length, unresolved_count: unresolved, error_count: errors,
    affected_sku_count: new Set(computed.filter(r => r.annual_delta_usd !== 0).map(r => r.sku)).size,
    unique_supplier_count: new Set(rows.map(r => r.supplier).filter(Boolean)).size,
    resolved_annual_delta_subtotal_usd: subtotal,
    estimated_annual_duty_delta_usd: errors || unresolved ? null : subtotal,
    effective_date: dateStatus === "single" ? rows[0].evaluation_date : null,
    effective_date_status: dateStatus, currency: "USD" as const,
  };
}
export function exportBusinessImpact(rows: ImpactRow[]): string {
  const headers = ["sku", "hts_code", "country_of_origin", "supplier", "annual_import_value", "current_duty_rate_percent", "import_date", "status", "computed_total_rate_percent", "current_annual_duty_usd", "computed_annual_duty_usd", "annual_delta_usd", "direction", "citations", "unresolved", "ad_cvd_advisories", "error", "quantity", "chapter99_codes", "exclusion_id", "special_program_claim"];
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows.map(r => [r.sku, r.hts, r.origin, r.supplier, r.annual_import_value_usd, r.current_duty_rate === null ? null : r.current_duty_rate * 100, r.evaluation_date, r.status, r.computed_total_rate === null ? null : r.computed_total_rate * 100, r.current_annual_duty_usd, r.computed_annual_duty_usd, r.annual_delta_usd, r.direction, r.stack_result?.components.flatMap(c => c.citation).join("; "), r.stack_result?.unresolvedMeasures.join("; "), r.stack_result ? JSON.stringify(r.stack_result.adCvdAdvisories) : null, r.error, r.quantity, r.chapter99_codes, r.exclusion_id, r.special_program_claim])].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const MAX_BYTES = 2 * 1024 * 1024;
export class ImpactBodyTooLarge extends Error {}
export async function readImpactBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new ImpactBodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new ImpactBodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
