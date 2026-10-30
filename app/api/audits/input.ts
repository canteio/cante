import {shipmentFields,shipmentAliases,shipmentSchema,easternEntryDate,type ShipmentDetails} from "./shipment";
import {declaredChapter99} from "@/app/api/tariff/references/chapter99-contract";
import { parseCsv } from "@/lib/catalogue/csv";
import { normalizeCountryCode } from "@/lib/tariff/bulk";
import { isStrictIsoDate } from "@/lib/tariff/date";
import { fields, type Mapping, type Field, type AuditOptions, type AuditEntry } from "./model";

const aliases: Record<Field, string[]> = {
 ...shipmentAliases,
  entry: ["entry", "entry_number", "entry_no", "entry_id"], line: ["line", "entry_line", "line_number"], date: ["entry_date", "import_date"], sku: ["sku", "product_id", "part_number", "part", "product_identifier"], description: ["description", "product_description"], hts: ["hts", "hts_code", "hts10", "tariff_code"], origin: ["origin", "country_of_origin", "declared_country_of_origin", "coo"], supplier: ["supplier", "vendor"], value: ["customs_value", "customs_value_usd", "entered_value"], basePaid: ["base_duty_paid", "base_duty_paid_usd"], additionalPaid: ["additional_duties_paid", "additional_duties_paid_usd"], paid: ["total_duties_paid", "paid_duty", "paid_duty_usd", "total_duty_paid"], currency: ["currency"], chapter99: ["chapter99_codes", "chapter_99_codes"], quantity: ["quantity", "qty"], unit: ["unit", "uom"], documents: ["documents", "supporting_document_references", "document_references", "document_refs"], evidenceOrigin: ["evidence_origin", "supporting_origin"], evidenceHts: ["evidence_hts", "supporting_hts"], exclusion: ["exclusion", "exclusion_id", "exclusion_claim"],
};
export function auditTable(csv: string) {
  if (Buffer.byteLength(csv) > 2 * 1024 * 1024) throw Error("Use a CSV up to 2 MiB.");
  const table = parseCsv(csv, { columns: 64, rawRows: 502, cellCharacters: 2000 }, true, true);
  if (!table.rows.length || table.rows.length > 500 || table.headers.some(h => !h.trim()) || new Set(table.headers.map(h=>h.trim().toLowerCase())).size !== table.headers.length) throw Error("Use unique headers and 1–500 entry lines.");
  return table;
}
export function suggestMapping(headers: string[]): Mapping {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return Object.fromEntries(Object.keys(fields).map(key => { const matches = headers.filter(h => aliases[key as Field].includes(normalize(h))); return [key, matches.length === 1 ? matches[0] : null]; })) as Mapping;
}
export function validateMapping(headers: string[], input: unknown): Mapping {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Confirm the column mapping first.");
  const selected = {...Object.fromEntries(Object.keys(shipmentFields).map(k=>[k,null])),...input} as Record<string, unknown>;
  if (Object.keys(selected).length !== Object.keys(fields).length || Object.keys(fields).some(k => !(k in selected) || (selected[k] !== null && (typeof selected[k] !== "string" || !headers.includes(selected[k] as string))))) throw Error("Map only uploaded columns, or select None.");
  const used = Object.values(selected).filter(v=>v!==null);
  if (new Set(used).size !== used.length) throw Error("A source column cannot supply two different audit fields.");
  return selected as Mapping;
}
export function moneyText(raw: string): string | null {
  if (!raw.trim()) return null;
  const value = raw.trim().replace(/^USD\s*/i, "").replace(/\s*USD$/i, "").replace(/^\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) return null;
  const clean = value.replace(/,/g, ""); const [whole, part = ""] = clean.split(".");
  if (BigInt(whole) > 1_000_000_000_000n) return null;
  return `${BigInt(whole)}.${part.padEnd(2, "0")}`;
}
export const cents = (s: string) => BigInt(s.replace(".", ""));
export function dollars(n: bigint) { const negative = n < 0n; if (negative) n = -n; return `${negative ? "-" : ""}${n / 100n}.${String(n % 100n).padStart(2,"0")}`; }
export function parseAudit(csv: string, mapping: Mapping, options: AuditOptions): AuditEntry[] {
  const table = auditTable(csv); validateMapping(table.headers, mapping);
  const rows = table.rows.map((raw, index) => {
    const get = (key: Field) => !mapping[key] ? "" : raw[mapping[key]!] ?? "";
    const errors: string[] = [], warnings: string[] = [];
    for (const key of ["entry", "line", "date", "sku", "hts", "origin"] as Field[]) if (!get(key)) errors.push(`Missing ${fields[key].toLowerCase()}.`);
    const rawHts = get("hts"); const hts = /^[\d.\s]+$/.test(rawHts) ? rawHts.replace(/[.\s]/g, "") : rawHts;
    if (!/^\d{10}$/.test(hts) || Number(hts.slice(0,2)) < 1) errors.push("Supply the full 10-digit HTS as text; missing digits are not reconstructed.");
    const origin = normalizeCountryCode(get("origin")); if (!/^[A-Z]{2}$/.test(origin)) errors.push("Supply a recognized two-letter origin.");
    let date = get("date");
    if (options.dateFormat !== "iso") { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date); if (m) date = `${m[3]}-${(options.dateFormat === "mdy" ? m[1] : m[2]).padStart(2,"0")}-${(options.dateFormat === "mdy" ? m[2] : m[1]).padStart(2,"0")}`; }
    if (!isStrictIsoDate(date)) errors.push("Entry date is missing or ambiguous; confirm the date format.");
    const currency = get("currency").toUpperCase(); if (currency ? currency !== "USD" : !options.currencyUsd) errors.push("Confirm USD amounts; currency conversion is not supported.");
    if (!options.dutiesOnly) errors.push("Confirm that paid amounts are duties only, excluding fees and taxes.");
    if (!options.ordinaryConsumption&&!get("entryType")) errors.push("Confirm ordinary consumption entries, or supply the actual entry type for a supported special-entry review.");
    if(options.ordinaryConsumption&&get("entryType")&&!["01","03","11"].includes(get("entryType").trim()))errors.push("The entry type conflicts with the ordinary-consumption declaration.");
    const value = moneyText(get("value")), basePaid = moneyText(get("basePaid")), additionalPaid = moneyText(get("additionalPaid")); let paid = moneyText(get("paid"));
    if (value === null) errors.push("Customs value is missing or invalid (USD, at most two decimal places).");
    for (const key of ["basePaid", "additionalPaid", "paid"] as const) if (get(key) && moneyText(get(key)) === null) errors.push(`${fields[key]} is invalid; no amount was guessed.`);
    if (paid === null && !get("paid") && basePaid !== null && additionalPaid !== null && options.componentsComplete) paid = dollars(cents(basePaid) + cents(additionalPaid));
    if (paid === null) errors.push("Total duty paid is missing. Confirm complete components before deriving it.");
    if (paid !== null && basePaid !== null && additionalPaid !== null && cents(paid) !== cents(basePaid) + cents(additionalPaid)) errors.push("Paid-duty components do not equal the supplied total.");
    if (!get("description")) warnings.push("No description supplied; classification evidence may be needed.");
    let quantity: string | null = get("quantity") || null;
    if (quantity && (!/^\d+(?:\.\d{1,8})?$/.test(quantity) || quantity.length>24)) { errors.push("Quantity must be a nonnegative decimal."); quantity = null; }
    const declaredShipment:Record<string,unknown>={};
    for(const key of Object.keys(shipmentFields) as (keyof typeof shipmentFields)[]){const text=get(key).trim();if(!text)continue;if(key==='cases')declaredShipment[key]=text.split(/[;|,]/).map(s=>s.trim()).filter(Boolean);else if(['steelValue','aluminumValue','copperValue','usValue','dutiableValue','articleValue'].includes(key)){const amount=moneyText(text);if(amount===null)errors.push(`${fields[key]} is invalid; no value was guessed.`);else if(key!=='articleValue'&&value!==null&&cents(amount)>cents(value))errors.push(`${fields[key]} exceeds the customs value.`);else declaredShipment[key]=amount;}else declaredShipment[key]=text;}
    const shipmentResult=shipmentSchema.safeParse(declaredShipment);let shipment:ShipmentDetails|undefined;
    if(!shipmentResult.success)for(const issue of shipmentResult.error.issues)errors.push(`Invalid shipment ${issue.path.join('.')}: ${issue.message}`);
    else if(Object.keys(shipmentResult.data).length){shipment=shipmentResult.data;if(shipment.entryTimestamp&&isStrictIsoDate(date)&&easternEntryDate(shipment.entryTimestamp)!==date)errors.push('Entry timestamp does not match the entry date in U.S. Eastern time.');if(!!shipment.primaryQuantity!==!!shipment.primaryUnit)errors.push('Supply both corrected primary quantity and its unit.');for(const n of [2,3] as const)if(!!shipment[`quantity${n}`]!==!!shipment[`unit${n}`])errors.push(`Supply both quantity ${n} and its unit.`);}
    const parsed99=declaredChapter99(get("chapter99"));errors.push(...parsed99.errors);
    return { ...(shipment?{shipment}:{}),row:index+1, entry:get("entry"),line:get("line"),date,sku:get("sku"),description:get("description"),hts,origin,supplier:get("supplier"),value,paid,basePaid,additionalPaid,quantity,unit:get("unit"),chapter99:parsed99.codes,documents:get("documents").split(/[;|]/).map(s=>s.trim()).filter(Boolean),evidenceOrigin:normalizeCountryCode(get("evidenceOrigin")),evidenceHts:get("evidenceHts").replace(/[.\s]/g,""),exclusion:get("exclusion"),errors,warnings,raw };
  });
  const identities = new Map<string, AuditEntry[]>();
  for (const row of rows) { const key = JSON.stringify([row.entry,row.line]); const group=identities.get(key)??[]; group.push(row); identities.set(key,group); }
  for (const group of identities.values()) if (group.length>1) for (const row of group) row.errors.push("Duplicate entry/line identity. Reconcile repeated Chapter 99 records or duplicate lines before calculation.");
  return rows;
}
