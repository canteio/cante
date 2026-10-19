import { parseCsv } from "@/lib/catalogue/csv";

export const DEMO_LABEL = "SYNTHETIC DEMO - NOT CUSTOMER DATA";
export const DEMO_COMPANY = "Fieldwork Equipment (fictional)";
export const DEMO_QUESTION = "If this tariff hits tomorrow, how much more do we pay?";
export const DEMO_STORAGE_KEY = "cante:equipment-demo:v1";
export const DEMO_MAX_BYTES = 1_000_000;
export type DemoInput = { catalogueCsv: string; historyCsv: string; regulationId: string };
export type DemoProduct = { sku: string; name: string; hts: string; origin: string; unitValueCents: number; annualUnits: number; baselineBps: number };
export type DemoImport = { entryId: string; line: number; date: string; sku: string; hts: string; origin: string; units: number; customsValueCents: number; paidDutyCents: number };
export type DemoRegulation = { id: string; title: string; origins: string[]; htsPrefixes: string[]; addedBps: number; description: string };
export const DEMO_REGULATIONS: DemoRegulation[] = [
  { id: "sim-cn-25", title: "China equipment surcharge · +25 percentage points", origins: ["CN"], htsPrefixes: ["843311", "843390", "840790", "850131", "848340"], addedBps: 2500, description: "Invented surcharge on selected China-origin mowers, parts, engines, DC motors and gearboxes. No exclusions, stacking or legal authority are assumed." },
  { id: "sim-parts-10", title: "China / Vietnam components · +10 percentage points", origins: ["CN", "VN"], htsPrefixes: ["841330", "848210", "853710"], addedBps: 1000, description: "Invented surcharge on selected China- and Vietnam-origin pumps, bearings and control panels." },
  { id: "sim-control", title: "No change · control scenario", origins: ["CN"], htsPrefixes: ["843311"], addedBps: 0, description: "A zero-rate control to verify that unchanged rates produce zero added duty." },
];
const headers = ["dataset_label", "sku", "product_name", "hts_code", "origin_country", "unit_customs_value_usd", "annual_import_units", "baseline_duty_rate_percent"];
// Codes captured from the public USITC search API. Their assignment to fictional
// products and all baseline rates remain demo assumptions, never classifications.
const families: [string, string, string, number, number, number][] = [
  ["MOW", "Battery rotary mower", "8433.11.00.10", 185000, 1500, 0],
  ["DEK", "Mower cutting-deck assembly", "8433.90.10.90", 38500, 4000, 0],
  ["ENG", "Air-cooled spark-ignition engine", "8407.90.10.60", 46000, 3000, 0],
  ["MOT", "DC drive motor 500W", "8501.31.40.00", 13800, 5500, 400],
  ["PMP", "Engine fuel pump", "8413.30.90.30", 4200, 7000, 250],
  ["GEA", "Fixed-ratio gearbox", "8483.40.50.10", 27500, 2800, 250],
  ["BRG", "Flanged ball bearing", "8482.10.50.16", 1850, 18000, 900],
  ["CTL", "Low-voltage programmable controller", "8537.10.91.60", 12500, 2400, 270],
  ["SPR", "Powered sprayer replacement assembly", "8424.90.90.20", 7200, 3500, 0],
  ["WHL", "Mower wheel and tire assembly", "8433.90.10.10", 5400, 6500, 0],
];
export function exampleProducts(): DemoProduct[] {
  return families.flatMap(([prefix, name, hts, value, volume, baselineBps]) => [0, 1, 2, 3, 4].map(i => ({
    sku: `DEMO-${prefix}-${String(i + 1).padStart(3, "0")}`, name: `${name} · series ${i + 1}`, hts,
    origin: ["CN", "CN", "VN", "MX", "CN"][i], unitValueCents: value + i * Math.round(value * 0.12),
    annualUnits: volume + i * Math.round(volume * 0.15), baselineBps,
  })));
}
function safe(n: number | bigint, label: string): number {
  const value = Number(n);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} exceeds the supported integer range.`);
  return value;
}
function amount(raw: string, label: string): number {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${label} must be a non-negative decimal with at most two places.`);
  const [whole, fraction = ""] = raw.split(".");
  return safe(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")), label);
}
function positive(raw: string, label: string): number {
  if (!/^[1-9]\d{0,7}$/.test(raw)) throw new Error(`${label} must be a whole number between 1 and 99,999,999.`);
  return Number(raw);
}
const code = (raw: string) => {
  const digits = raw.replace(/\./g, "");
  if (!/^\d{10}$/.test(digits)) throw new Error("HTS must contain exactly 10 digits.");
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}.${digits.slice(8)}`;
};
const origin = (raw: string) => {
  const value = raw.toUpperCase();
  if (!["CN", "VN", "MX", "TW", "JP", "DE", "US", "CA", "IN", "KR"].includes(value)) throw new Error("Use a supported two-letter origin: CN, VN, MX, TW, JP, DE, US, CA, IN or KR.");
  return value;
};
function table(csv: string, required: string[], maxRows: number) {
  if (new TextEncoder().encode(csv).byteLength > DEMO_MAX_BYTES) throw new Error("Demo CSV must be under 1 MB.");
  const parsed = parseCsv(csv, { columns: 20, rawRows: maxRows + 2, cellCharacters: 500 }, true);
  if (new Set(parsed.headers).size !== parsed.headers.length || required.some(h => !parsed.headers.includes(h))) throw new Error(`Required unique columns: ${required.join(", ")}.`);
  if (!parsed.rows.length || parsed.rows.length > maxRows) throw new Error(`Use 1–${maxRows} rows.`);
  if (parsed.rows.some(r => r.dataset_label !== DEMO_LABEL)) throw new Error(`Every row must carry dataset_label="${DEMO_LABEL}". This playground accepts labelled fictional data only.`);
  return parsed.rows;
}
export function parseDemoCatalogue(csv: string): DemoProduct[] {
  const seen = new Set<string>();
  return table(csv, headers, 500).map((r, i) => {
    if (!/^DEMO-[A-Z0-9-]{1,40}$/.test(r.sku) || seen.has(r.sku)) throw new Error(`Row ${i + 2}: use a unique DEMO- SKU.`);
    seen.add(r.sku);
    if (!r.product_name || r.product_name.length > 150) throw new Error(`Row ${i + 2}: product name is required (maximum 150 characters).`);
    const baselineBps = amount(r.baseline_duty_rate_percent, "Baseline duty rate");
    if (baselineBps > 10000) throw new Error("Baseline duty rate cannot exceed 100%.");
    return { sku: r.sku, name: r.product_name, hts: code(r.hts_code), origin: origin(r.origin_country), unitValueCents: amount(r.unit_customs_value_usd, "Unit customs value"), annualUnits: positive(r.annual_import_units, "Annual units"), baselineBps };
  });
}
export const dutyCents = (value: number, bps: number) => safe((BigInt(value) * BigInt(bps) + 5000n) / 10000n, "Duty");
const sum = (values: number[]) => safe(values.reduce((a, b) => a + BigInt(b), 0n), "Total");
export function exampleHistory(products = exampleProducts()): DemoImport[] {
  const weights = [7, 6, 6, 7, 9, 11, 14, 15, 14, 12, 10, 9]; // sum = 120
  return products.flatMap(p => {
    let remaining = p.annualUnits;
    return weights.map((weight, i) => {
      const units = i === 11 ? remaining : Math.floor(p.annualUnits * weight / 120); remaining -= units;
      const date = `${i < 3 ? 2025 : 2026}-${String((i + 9) % 12 + 1).padStart(2, "0")}-15`;
      const customsValueCents = safe(BigInt(p.unitValueCents) * BigInt(units), "Customs value");
      return { entryId: `DEMO-ENTRY-${date.slice(0, 7).replace("-", "")}-${p.sku.slice(5)}`, line: 1, date, sku: p.sku, hts: p.hts, origin: p.origin, units, customsValueCents, paidDutyCents: dutyCents(customsValueCents, p.baselineBps) };
    });
  });
}
const historyHeaders = ["dataset_label", "entry_id", "line_number", "entry_date", "sku", "hts_code", "origin_country", "quantity", "customs_value_usd", "paid_duty_usd"];
export function parseDemoHistory(csv: string, products: DemoProduct[]): DemoImport[] {
  if (!csv.trim()) return [];
  const bySku = new Map(products.map(p => [p.sku, p])); const seen = new Set<string>();
  return table(csv, historyHeaders, 6000).map((r, i) => {
    const product = bySku.get(r.sku); const line = positive(r.line_number, "Line number"); const key = JSON.stringify([r.entry_id, line]);
    if (!product || !r.entry_id.startsWith("DEMO-") || seen.has(key)) throw new Error(`History row ${i + 2}: unknown SKU, duplicate entry/line, or missing DEMO- entry ID.`);
    seen.add(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.entry_date) || !Number.isFinite(Date.parse(r.entry_date)) || new Date(r.entry_date).toISOString().slice(0, 10) !== r.entry_date) throw new Error(`History row ${i + 2}: invalid date.`);
    const hts = code(r.hts_code), country = origin(r.origin_country);
    if (hts !== product.hts || country !== product.origin) throw new Error(`History row ${i + 2}: HTS/origin differs from its catalogue product.`);
    return { entryId: r.entry_id, line, date: r.entry_date, sku: r.sku, hts, origin: country, units: positive(r.quantity, "Quantity"), customsValueCents: amount(r.customs_value_usd, "Customs value"), paidDutyCents: amount(r.paid_duty_usd, "Paid duty") };
  });
}
export function calculateDemo(input: DemoInput) {
  const products = parseDemoCatalogue(input.catalogueCsv);
  const history = parseDemoHistory(input.historyCsv, products);
  const regulation = DEMO_REGULATIONS.find(r => r.id === input.regulationId);
  if (!regulation) throw new Error("Select a known simulated regulation.");
  const rows = products.map(p => {
    const covered = regulation.origins.includes(p.origin) && regulation.htsPrefixes.some(prefix => p.hts.replace(/\./g, "").startsWith(prefix));
    const addedBps = covered ? regulation.addedBps : 0;
    const annualValueCents = safe(BigInt(p.unitValueCents) * BigInt(p.annualUnits), "Annual customs value");
    const beforeCents = dutyCents(annualValueCents, p.baselineBps);
    const afterCents = dutyCents(annualValueCents, p.baselineBps + addedBps);
    const extraCents = afterCents - beforeCents;
    return { ...p, addedBps, annualValueCents, beforeCents, afterCents, extraCents, affected: addedBps > 0, matchReason: !covered ? "Origin or HTS outside scenario scope" : addedBps === 0 ? "Zero-rate control" : `Origin ${p.origin} + HTS ${p.hts.slice(0, 7)} matches the simulated rule` };
  });
  const affected = rows.filter(r => r.affected);
  const totalExtraCents = sum(rows.map(r => r.extraCents));
  return {
    label: DEMO_LABEL, company: DEMO_COMPANY, regulation, productCount: rows.length, affectedCount: affected.length,
    unaffectedCount: rows.length - affected.length, annualValueCents: sum(rows.map(r => r.annualValueCents)),
    affectedValueCents: sum(affected.map(r => r.annualValueCents)), beforeCents: sum(rows.map(r => r.beforeCents)),
    afterCents: sum(rows.map(r => r.afterCents)), totalExtraCents, monthlyEquivalentCents: safe((BigInt(totalExtraCents) + 6n) / 12n, "Monthly equivalent"),
    topFive: [...affected].sort((a, b) => b.extraCents - a.extraCents || a.sku.localeCompare(b.sku)).slice(0, 5), rows,
    history: { rowCount: history.length, startDate: history.length ? [...history].sort((a, b) => a.date.localeCompare(b.date))[0].date : null, endDate: history.length ? [...history].sort((a, b) => b.date.localeCompare(a.date))[0].date : null, customsValueCents: sum(history.map(r => r.customsValueCents)), paidDutyCents: sum(history.map(r => r.paidDutyCents)), rows: history },
    assumptions: ["Entirely fictional company, products, prices, volumes, imports and regulation.", "Published HTS examples are not verified classifications for these products; baseline rates are assumptions.", "Annual forecast uses explicit unit customs value × planned annual units, held constant before/after. Historical imports are not annualized or charged retroactively.", "Rate changes are additive percentage points; no exclusions, preference programs, fees or real Chapter 99 stacking are modelled.", "Duty is rounded half-up to cents per SKU per annual scenario. Extra duty = rounded after minus rounded before; totals sum SKU results."],
  };
}
export type DemoResult = ReturnType<typeof calculateDemo>;
const dollars = (cents: number) => (cents / 100).toFixed(2);
export const demoMoney = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
export function csvCell(value: unknown): string {
  let text = String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csv = (rows: unknown[][]) => rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
export const catalogueCsv = (products = exampleProducts()) => csv([headers, ...products.map(p => [DEMO_LABEL, p.sku, p.name, p.hts, p.origin, dollars(p.unitValueCents), p.annualUnits, (p.baselineBps / 100).toFixed(2)])]);
export const historyCsv = (rows = exampleHistory()) => csv([historyHeaders, ...rows.map(r => [DEMO_LABEL, r.entryId, r.line, r.date, r.sku, r.hts, r.origin, r.units, dollars(r.customsValueCents), dollars(r.paidDutyCents)])]);
export const demoResultCsv = (result: DemoResult) => csv([["dataset_label", "regulation_id", "sku", "product_name", "hts_code", "origin", "annual_units", "annual_customs_value_usd", "before_rate_percent", "after_rate_percent", "annual_duty_before_usd", "annual_duty_after_usd", "extra_annual_duty_usd", "affected"], ...result.rows.map(r => [DEMO_LABEL, result.regulation.id, r.sku, r.name, r.hts, r.origin, r.annualUnits, dollars(r.annualValueCents), (r.baselineBps / 100).toFixed(2), ((r.baselineBps + r.addedBps) / 100).toFixed(2), dollars(r.beforeCents), dollars(r.afterCents), dollars(r.extraCents), r.affected])]);
export function demoReport(result: DemoResult): string {
  return `# Fictional tariff impact report\n\n${DEMO_LABEL}\n\n${result.company}\n\nSimulated regulation: ${result.regulation.title}\n\n${result.affectedCount} of ${result.productCount} products affected. Extra annual duty: **${demoMoney(result.totalExtraCents)}**. Monthly equivalent (annual / 12, rounded): ${demoMoney(result.monthlyEquivalentCents)}.\n\nBefore: ${demoMoney(result.beforeCents)} annual duty. After: ${demoMoney(result.afterCents)} annual duty.\n\n## Top five affected SKUs\n\n| SKU | Product | Origin | Annual customs value | Extra annual duty |\n|---|---|---|---:|---:|\n${result.topFive.map(r => `| ${r.sku} | ${r.name.replace(/\|/g, "/")} | ${r.origin} | ${demoMoney(r.annualValueCents)} | ${demoMoney(r.extraCents)} |`).join("\n")}\n\n## Historical ledger (unchanged)\n\n${result.history.rowCount} fictional entry lines. Historical customs value: ${demoMoney(result.history.customsValueCents)}. Paid duty: ${demoMoney(result.history.paidDutyCents)}.\n\n## Assumptions\n\n${result.assumptions.map(a => `- ${a}`).join("\n")}\n\n## Method\n\nMatch origin AND HTS prefix. Annual customs value = unit customs value × annual planned units. Apply the baseline rate and simulated additive rate to the same value. Round each annual SKU duty to cents, then subtract before from after and sum. No real regulation or actual tariff liability is established.\n`;
}
export function demoChatContext(result: DemoResult, question = ""): string {
  const ledger = result.history.rows;
  const totals = (entries: DemoImport[]) => ({ lines: entries.length, units: sum(entries.map(r => r.units)), customsValue: demoMoney(sum(entries.map(r => r.customsValueCents))), paidDuty: demoMoney(sum(entries.map(r => r.paidDutyCents))) });
  const months = [...new Set(ledger.map(r => r.date.slice(0, 7)))].sort();
  const monthly = months.map(month => ({ month, ...totals(ledger.filter(r => r.date.startsWith(month))) }));
  const mentioned = result.rows.filter(r => question.toUpperCase().includes(r.sku)).map(r => r.sku);
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const requestedMonths = months.filter(month => question.includes(month) || new RegExp(`\\b${monthNames[Number(month.slice(5)) - 1]}\\b`, "i").test(question));
  const matchingEntries = mentioned.length || requestedMonths.length ? ledger.filter(r => (!mentioned.length || mentioned.includes(r.sku)) && (!requestedMonths.length || requestedMonths.some(m => r.date.startsWith(m)))) : [];
  const historicBySku = new Map(result.rows.map(r => [r.sku, totals(ledger.filter(h => h.sku === r.sku))]));
  return `## Fictional tariff demo — deterministic calculation, not real customer or government data\n\n${demoReport(result)}\nAll currency strings below are already formatted by code. Use values verbatim; do not perform arithmetic, classify products, invent laws, or mix real workspace data into this demo. If a requested calculation is not provided, say it needs a scenario recalculation. A tomorrow-effective hypothetical means the next 12 months at unchanged planned volumes, not tomorrow's one-day cash payment.\n\n${JSON.stringify({ regulation: result.regulation, rows: result.rows.map(r => ({ sku: r.sku, name: r.name, hts: r.hts, origin: r.origin, annualUnits: r.annualUnits, unitCustomsValue: demoMoney(r.unitValueCents), annualCustomsValue: demoMoney(r.annualValueCents), baselineRate: `${r.baselineBps / 100}%`, scenarioRate: `${(r.baselineBps + r.addedBps) / 100}%`, beforeAnnualDuty: demoMoney(r.beforeCents), afterAnnualDuty: demoMoney(r.afterCents), extraAnnualDuty: demoMoney(r.extraCents), affected: r.affected, matchReason: r.matchReason, historicalImports: historicBySku.get(r.sku) })), history: { rowCount: ledger.length, startDate: result.history.startDate, endDate: result.history.endDate, monthly, detailScope: "All per-SKU and monthly aggregates provided. Entry details limited to 60 matches for a named SKU or YYYY-MM/month. Download imports.csv for all original lines.", matchingEntryCount: matchingEntries.length, entries: matchingEntries.slice(0, 60).map(r => ({ entryId: r.entryId, line: r.line, date: r.date, sku: r.sku, units: r.units, customsValue: demoMoney(r.customsValueCents), paidDuty: demoMoney(r.paidDutyCents) })) } })}`;
}
