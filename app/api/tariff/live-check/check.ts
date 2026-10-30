import {DUTY_CALCULATION_VERSION,combineDutyAmounts} from "@/lib/tariff/duty-expression";
import type { DutyComparison, CheckRefresh } from "./comparison";
import { compareHistoricalRules, type HistoricalComparison } from "./history";
/** Read-only live verification. Official fetches and existing engine; no model or tenant writes. */
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { parseCsv } from "@/lib/catalogue/csv";
import { normalizeCountryCode, normalizeHtsCode, parseRemedyFacts } from "@/lib/tariff/bulk";
import { easternIsoDate, isStrictIsoDate } from "@/lib/tariff/date";
import { lookupTariff, quoteDuty, type TariffRow } from "@/lib/tariff/rates";
import { computeStackedDuty, type UsmcaQualificationInput } from "@/lib/tariff/stack";
import { fetchOfficialRemedySnapshot, type OfficialRemedySnapshot, type RemedyFacts } from "@/lib/tariff/section232-live";
import { withStackingRulesCache } from "@/lib/tariff/stacking-rules";

export type LiveProduct = { sku: string; hts: string; origin: string; customsValue: number | null; inputBasis?: "catalogue"; valueBasis?: "annual" | "historical"; quantity: number | null; unit: string | null; fictional: boolean; usmcaQualification?: UsmcaQualificationInput; remedyFacts?: RemedyFacts; history?: { entries: Record<string, string>[]; startDate: string; endDate: string; paidDuty: number | null } };
export type LiveSource = { name: string; url: string; fetchedAt: string; status: "fetched" | "failed"; sha256: string | null; error: string | null; body: string | null; bodyEncoding?: "utf8" | "base64"; compression?: "gzip"; originalSha256?: string };
export const LIVE_MAX_BYTES = 15 * 1024 * 1024;
const cents = (raw: string, name: string) => {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) throw Error(`${name}: use a non-negative USD amount with at most two decimal places.`);
  const [a, b = ""] = raw.split("."); return BigInt(a) * 100n + BigInt(b.padEnd(2, "0"));
};
export function parseLiveProducts(csv: string): LiveProduct[] {
  if (Buffer.byteLength(csv) > LIVE_MAX_BYTES) throw Error("Check inputs must be under 15 MiB.");
  let table;
  try { table = parseCsv(csv, { columns: 30, rawRows: 6002, cellCharacters: 500 }, true); }
  catch (error) { if (error instanceof Error && /limit/.test(error.message)) throw Error("CSV exceeds the upload limits: 6,000 import rows, 30 columns, or 500 characters per cell."); throw error; }
  if (!table.rows.length || table.rows.length > 6000) throw Error("Use up to 6,000 import rows or 100 product rows per live check.");
  if (new Set(table.headers).size !== table.headers.length) throw Error("CSV headers must be unique.");
  const ledgerHeaders = ["entry_id", "line_number", "entry_date", "customs_value_usd"];
  const isLedger = ledgerHeaders.some(h => table.headers.includes(h));
  if (isLedger) {
    if (!ledgerHeaders.every(h => table.headers.includes(h))) throw Error("Import history requires entry_id, line_number, entry_date and customs_value_usd.");
    return aggregateHistory(table.rows);
  }
  if (table.rows.length > 100) throw Error("Product lists support up to 100 products. Import history supports up to 6,000 entry rows.");
  const seen = new Set<string>();
  return table.rows.map((r, i) => {
    const label = `Row ${i + 2}`;
    const sku = (r.sku ?? "").trim(); const hts = normalizeHtsCode(r.hts_code ?? r.hts ?? ""); const origin = normalizeCountryCode(r.origin_country ?? r.country_of_origin ?? "");
    if (!sku || seen.has(sku) || sku.length > 100) throw Error(`${label}: provide a unique SKU (maximum 100 characters).`);
    seen.add(sku);
    const catalogue = r.input_basis === "catalogue";
    if (!catalogue && (hts.replace(/\D/g, "").length !== 10 || !/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(hts))) throw Error(`${label}: provide an exact 10-digit HTS code.`);
    if (!catalogue && (!origin || !/^[A-Z]{2}$/.test(origin))) throw Error(`${label}: provide a two-letter origin country.`);
    let value: bigint | null;
    if (catalogue && !r.annual_customs_value_usd?.trim()) value = null;
    else if (r.annual_customs_value_usd !== undefined) value = cents(r.annual_customs_value_usd, label);
    else {
      if (!/^[1-9]\d{0,7}$/.test(r.annual_import_units ?? "")) throw Error(`${label}: provide annual_customs_value_usd, or unit_customs_value_usd and annual_import_units.`);
      value = cents(r.unit_customs_value_usd ?? "", label) * BigInt(r.annual_import_units);
    }
    if (value !== null && value > 9_000_000_000_000n) throw Error(`${label}: annual value exceeds the supported range.`);
    const quantityText = (r.annual_quantity ?? r.quantity)?.trim();
    if (quantityText && (!/^\d{1,10}(?:\.\d{1,4})?$/.test(quantityText) || Number(quantityText) <= 0)) throw Error(`${label}: annual_quantity must be positive.`);
    const unit = (r.quantity_unit ?? r.unit)?.trim() || null;
    if (unit && unit.length > 32) throw Error(`${label}: quantity_unit must be under 32 characters.`);
    for (const field of ["chapter99_codes", "exclusion_id", "special_program_claim", "claimed_programme"]) if (r[field]?.trim()) throw Error(`${label}: ${field} requires supported applicability review; this live-file check cannot silently apply or ignore the claim.`);
    const qualificationFields = ["usmca_verified", "usmca_decision", "usmca_details"];
    let usmcaQualification: UsmcaQualificationInput | undefined;
    if (qualificationFields.some(key => r[key]?.trim())) {
      if (!["true", "yes"].includes(r.usmca_verified?.trim().toLowerCase()) || !["qualifies", "does_not_qualify"].includes(r.usmca_decision?.trim()) || !r.usmca_details?.trim()) throw Error(`${label}: provide usmca_verified=true, usmca_decision=qualifies or does_not_qualify, and usmca_details from reviewed records. Origin alone does not establish USMCA qualification.`);
      if (!["MX", "CA"].includes(origin)) throw Error(`${label}: USMCA declarations require Mexican or Canadian origin.`);
      usmcaQualification = { verified: true, decision: r.usmca_decision.trim() as UsmcaQualificationInput["decision"], details: r.usmca_details.trim() };
    }
    const remedyFacts = parseRemedyFacts(r);
    return { sku, hts, origin, customsValue: value === null ? null : Number(value) / 100, ...(catalogue ? {inputBasis: "catalogue" as const, ...(["annual","historical"].includes(r.value_basis) ? {valueBasis:r.value_basis as "annual" | "historical"} : {})} : {}), quantity: quantityText ? Number(quantityText) : null, unit, fictional: /synthetic|fictional|demo/i.test(r.dataset_label ?? "") || sku.startsWith("DEMO-"), ...(remedyFacts?{remedyFacts}:{}), ...(usmcaQualification?{usmcaQualification}:{}) };
  });
}

/** Preserve entry identity and paid amounts; current-rate repricing is never an annual forecast or refund audit. */
function aggregateHistory(rows: Record<string, string>[]): LiveProduct[] {
  const entries = new Set<string>();
  const groups = new Map<string, { product: LiveProduct; value: bigint; paid: bigint | null; quantity: bigint | null }>();
  for (const [index, r] of rows.entries()) {
    const label = `Import row ${index + 2}`;
    if (!r.entry_id?.trim() || !/^[1-9]\d{0,8}$/.test(r.line_number ?? "") || !isStrictIsoDate(r.entry_date ?? "")) throw Error(`${label}: provide an entry ID, positive line number and valid entry date.`);
    const entryKey = JSON.stringify([r.entry_id.trim(), Number(r.line_number)]);
    if (entries.has(entryKey)) throw Error(`${label}: duplicate entry ID and line number. Remove the duplicate before checking.`);
    entries.add(entryKey);
    // Reuse the same exact-code, origin, SKU and money validation as product CSVs.
    const escaped = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    const fields=["standard_commercial","metal_weight_percent","us_metal_qualification","uk_metal_qualification","special_232_claim","equipment_use","motorcycle_use","other_232_heading","usmca_verified","usmca_decision","usmca_details","chapter99_codes","exclusion_id","special_program_claim","claimed_programme","quantity","quantity_unit"];
    const product = parseLiveProducts("sku,hts_code,origin_country,annual_customs_value_usd,dataset_label,"+fields.join(",")+"\n" + [r.sku ?? "", r.hts_code ?? r.hts ?? "", r.origin_country ?? r.country_of_origin ?? "", r.customs_value_usd ?? "", r.dataset_label ?? "",...fields.map(f=>f==="quantity_unit"?(r.quantity_unit??r.unit??""):(r[f]??""))].map(escaped).join(","))[0];
    const key = JSON.stringify([product.sku, product.hts, product.origin]);
    const value = cents(r.customs_value_usd, label); const paid = r.paid_duty_usd?.trim() ? cents(r.paid_duty_usd, label) : null;
    let group = groups.get(key);
    if (!group) { group = { product: { ...product, history: { entries: [], startDate: r.entry_date, endDate: r.entry_date, paidDuty: null } }, value: 0n, paid: 0n, quantity: 0n }; groups.set(key, group); }
    if(JSON.stringify(group.product.remedyFacts??{})!==JSON.stringify(product.remedyFacts??{}))throw Error(`${label}: qualification facts differ within the same SKU / HTS / origin group. Split the file by qualification basis.`);
    if (JSON.stringify(group.product.usmcaQualification??null)!==JSON.stringify(product.usmcaQualification??null)) throw Error(`${label}: USMCA qualifications differ within the same SKU / HTS / origin group. Split the file by qualification basis.`);
    if (group.product.unit !== product.unit) throw Error(`${label}: quantity units differ within the same SKU / HTS / origin group.`);
    group.quantity = group.quantity === null || product.quantity === null ? null : group.quantity + BigInt(Math.round(product.quantity * 10000));
    if (group.quantity !== null && group.quantity > 100000000000000n) throw Error(`${label}: grouped quantity exceeds the supported range.`);
    group.value += value;
    if (group.value > 9_000_000_000_000n) throw Error(`${label}: grouped customs value exceeds the supported range.`);
    group.paid = group.paid === null || paid === null ? null : group.paid + paid;
    if (group.paid !== null && group.paid > 9_000_000_000_000n) throw Error(`${label}: grouped paid duty exceeds the supported range.`);
    group.product.fictional ||= product.fictional;
    const history = group.product.history!; history.entries.push(r);
    if (r.entry_date < history.startDate) history.startDate = r.entry_date;
    if (r.entry_date > history.endDate) history.endDate = r.entry_date;
  }
  if (groups.size > 100) throw Error("Import history supports up to 100 distinct SKU / HTS / origin groups per live check.");
  return [...groups.values()].map(({ product, value, paid, quantity }) => ({ ...product, customsValue: Number(value) / 100, quantity: quantity === null ? null : Number(quantity) / 10000, history: { ...product.history!, paidDuty: paid === null ? null : Number(paid) / 100 } }));
}

/** Independent integer-decimal check of the plain published base rate only. */
export function verifyBaseMath(raw: string, value: number, engineAmount: number | null) {
  const rate = raw.trim(); const match = /^(\d+(?:\.\d{1,8})?)\s*%$/.exec(rate);
  if (!/^free$/i.test(rate) && !match) return { status: "not_checked" as const, expectedAmount: null, formula: "Specific/compound rates need a separate quantity-and-unit verification; no independent pass is claimed." };
  const decimal = match?.[1] ?? "0"; const [whole, fraction = ""] = decimal.split(".");
  const numerator = BigInt(whole + fraction); const denominator = 100n * 10n ** BigInt(fraction.length);
  const valueText=Number.isFinite(value)&&value>=0?value.toFixed(2):"";
  if(!/^\d+\.\d{2}$/.test(valueText)||Number(valueText)!==value)return{status:"not_checked" as const,expectedAmount:null,formula:"The supplied customs value is not an exact nonnegative cent amount; no independent pass is claimed."};
  const valueCents = BigInt(valueText.replace(".",""));
  const resultCents = (valueCents * numerator * 2n + denominator) / (2n * denominator);
  const expectedAmount = Number(resultCents) / 100;
  const expectedText=`${resultCents/100n}.${String(resultCents%100n).padStart(2,"0")}`;
  if(resultCents>BigInt(Number.MAX_SAFE_INTEGER)||expectedAmount.toFixed(2)!==expectedText)return{status:"not_checked" as const,expectedAmount:null,formula:"The result exceeds exact-cent numeric output bounds; no independent pass is claimed."};
  return { status: engineAmount !== null && Number.isFinite(engineAmount)&&engineAmount===Number(engineAmount.toFixed(2))&&engineAmount.toFixed(2)===expectedText ? "passed" as const : "failed" as const, expectedAmount, formula: `$${valueText} × ${decimal}% = $${expectedText} (rounded to cents)` };
}

async function boundedText(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw Error("Source returned no body.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw Error("Source exceeds 4 MB capture limit."); } chunks.push(item.value); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function runLiveCheck(products: LiveProduct[], signal?: AbortSignal, progress: (message: string) => void = () => {}, observeSources?: (sources: LiveSource[]) => void) {
  const sources: LiveSource[] = []; let retainedBytes = 0; const startedAt = new Date().toISOString(); const entryDate = easternIsoDate();
  observeSources?.(sources);
  const capture = async (name: string, url: string) => {
    const evidence: LiveSource = { name, url, fetchedAt: new Date().toISOString(), status: "failed", sha256: null, error: null, body: null }; sources.push(evidence);
    try {
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json, application/rss+xml, text/plain" }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      evidence.body = await boundedText(response); evidence.sha256 = createHash("sha256").update(evidence.body).digest("hex"); evidence.status = "fetched";
      return evidence.body;
    } catch (error) { evidence.error = error instanceof Error && /^HTTP \d+$|^Source /.test(error.message) ? error.message : "Official source could not be fetched."; return null; }
  };
  const revision = async () => {
    const text = await capture("USITC current release", "https://hts.usitc.gov/reststop/currentRelease");
    if (!text) return null;
    try { const x = JSON.parse(text); const name = typeof x === "string" ? x : x?.name; if (typeof name !== "string" || !name.trim()) throw Error(); return name.trim(); } catch { sources.at(-1)!.status = "failed"; sources.at(-1)!.error = "Unrecognized revision response."; return null; }
  };
  progress("Fetching the current USITC revision…"); const revisionBefore = await revision();
  const uniqueCodes = [...new Set(products.filter(p => /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(p.hts) && /^[A-Z]{2}$/.test(p.origin)).map(p => p.hts))];
  const schedules = new Map<string, { row: TariffRow | null; error: string | null }>(); let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, uniqueCodes.length) }, async () => {
    while (next < uniqueCodes.length) {
      signal?.throwIfAborted(); const hts = uniqueCodes[next++]; progress(`Fetching published HTS ${hts}…`);
      try {
        const row = await lookupTariff(hts, { signal, fresh: true, onSource: source => {
          const body = JSON.stringify(source.rows); retainedBytes += Buffer.byteLength(body);
          if (retainedBytes > 12 * 1024 * 1024) throw Error("HTS evidence exceeds the per-check capture budget.");
          sources.push({ name: `USITC ${hts}`, url: source.url, fetchedAt: source.fetchedAt, status: "fetched", sha256: createHash("sha256").update(body).digest("hex"), error: null, body });
        } });
        schedules.set(hts, { row, error: row ? null : "Exact code not found in the current publication." });
      } catch { schedules.set(hts, { row: null, error: "Live USITC lookup failed. No cached rate substituted." }); sources.push({ name: `USITC ${hts}`, url: `https://hts.usitc.gov/reststop/search?keyword=${hts}`, fetchedAt: new Date().toISOString(), status: "failed", sha256: null, body: null, error: "Live lookup failed." }); }
    }
  }));
  progress("Refreshing consolidated Section 232 / Section 301 rules from USITC…");
  let remedySnapshot: OfficialRemedySnapshot | null=null;
  let remedyError:string|null=null;
  try {
    remedySnapshot=await fetchOfficialRemedySnapshot(signal);
    for(const e of remedySnapshot.evidence)sources.push({name:e.url.includes("getChapterNotes")?"USITC consolidated Chapter 99 legal notes":e.url.includes("exportList")?"USITC current Chapter 99 duty headings":"USITC remedy release check",url:e.url,fetchedAt:e.checkedAt,status:"fetched",sha256:e.sha256,error:null,body:e.body,bodyEncoding:e.encoding});
  } catch(error) { remedyError=error instanceof Error?error.message:"Official remedy refresh failed.";sources.push({name:"USITC current Section 232/301 rules",url:"https://hts.usitc.gov/",fetchedAt:new Date().toISOString(),status:"failed",sha256:null,error:remedyError,body:null}); }
  progress("Applying verified published rules and recalculating every product…");
  const rows = await withStackingRulesCache(async () => {
    const results = []; // Serial engine calls avoid repeated unbounded database queries.
    for (const product of products) {
      signal?.throwIfAborted();
      if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(product.hts) || !/^[A-Z]{2}$/.test(product.origin)) { results.push({product, published:null,quote:null,stack:null,verification:null,error:"Add one exact 10-digit HTS code and a country of origin to check this product."}); continue; }
      const schedule = schedules.get(product.hts)!; const published = schedule.row;
      if (!published) { results.push({ product, published: null, quote: null, stack: null, verification: null, error: schedule.error }); continue; }
      const quote = await quoteDuty({ htsCode: product.hts, countryOfOrigin: product.origin, value: product.customsValue, quantity: product.quantity, unit: product.unit, claimedProgramme: product.usmcaQualification?.decision === "qualifies" ? "S" : null }, published);
      let stack: Awaited<ReturnType<typeof computeStackedDuty>> = null; let error: string | null = null;
      try { stack = await computeStackedDuty({ htsCode: product.hts, countryOfOrigin: product.origin, value: product.customsValue, quantity: product.quantity, unit: product.unit, usmcaQualification: product.usmcaQualification, importDate: entryDate, signal, remedyFacts: product.remedyFacts }, undefined, undefined, undefined, published, remedySnapshot); } catch { error = "Full-duty evaluation failed; no complete total is available."; }
      results.push({ product, published, quote, stack, verification: quote && product.customsValue !== null ? verifyBaseMath(quote.rate.raw, product.customsValue, quote.computation.amount) : null, error });
      progress(`Calculated ${results.length} of ${products.length} products…`);
    }
    return results;
  });
  const historicalComparison:HistoricalComparison = revisionBefore && remedySnapshot?.revision===revisionBefore ? await compareHistoricalRules({currentRevision:revisionBefore,products,currentRows:new Map([...schedules].map(([code,row])=>[code,row.row])),currentHeadings:remedySnapshot.headings,productMeasures:new Map(rows.map(r=>[r.product.sku,r.stack?.components.flatMap(c=>c.measureId?[c.measureId]:[])??[]])),sources,signal,progress}) : {status:"unavailable",current:null,previous:null,issues:["Current revision or remedy headings unavailable; no historical comparison claimed."],baseChanges:[],legalChanges:[],headingChanges:[],modifyingDocuments:[],candidateSkus:[],notesCompared:[],scope:[]};
  progress("Pulling recent official publications…");
  const since = new Date(`${entryDate}T12:00:00Z`); since.setUTCDate(since.getUTCDate() - 30);
  const frUrl = new URL("https://www.federalregister.gov/api/v1/documents.json");
  frUrl.search = new URLSearchParams({ "conditions[term]": "tariff", "conditions[publication_date][gte]": since.toISOString().slice(0,10), "conditions[publication_date][lte]": entryDate, order: "newest", per_page: "100" }).toString();
  const [fr, cbp, whitehouse] = await Promise.all([capture("Federal Register: tariff publications, last 30 days (first 100)", frUrl.toString()), capture("CBP CSMS: current rolling feed", "https://content.govdelivery.com/accounts/USDHSCBP/widgets/USDHSCBP_WIDGET_2.rss"), capture("White House: recent presidential actions (first page)", "https://www.whitehouse.gov/presidential-actions/")]);
  const notices: { title: string; url: string; date: string | null; source: string }[] = []; const coverageNotes: string[] = [];
  if (fr) { try { const x = JSON.parse(fr); if (!Array.isArray(x.results)) throw Error(); for (const d of x.results) if (typeof d.title === "string" && typeof d.html_url === "string" && d.html_url.startsWith("https://www.federalregister.gov/")) notices.push({ title: d.title, url: d.html_url, date: d.publication_date ?? null, source: "Federal Register" }); if (x.total_pages > 1) coverageNotes.push(`Federal Register returned ${x.count} publications; only the first 100 were fetched.`); } catch { const source = sources.find(s => s.url === frUrl.toString())!; source.status = "failed"; source.error = "Unrecognized Federal Register response."; } }
  if (cbp) { const $ = load(cbp, { xmlMode: true }); const items = $("item"); if (!items.length) { const source = sources.find(s => s.name.startsWith("CBP"))!; source.status = "failed"; source.error = "Feed contained no recognizable items."; } items.each((_, item) => { const url = $(item).find("link").text(); if (url.startsWith("https://content.govdelivery.com/")) notices.push({ title: $(item).find("title").text(), url, date: $(item).find("pubDate").text() || null, source: "CBP CSMS" }); }); }
  if (whitehouse) {
    const $ = load(whitehouse); const posts = $(".wp-block-post-template .wp-block-post");
    if (!posts.length) { const source=sources.find(s=>s.name.startsWith("White House"))!; source.status="failed";source.error="Presidential actions page contained no recognizable posts."; }
    posts.each((_,post)=>{ const a=$(post).find(".wp-block-post-title a").first();const url=a.attr("href")??"",title=a.text().trim(),date=$(post).find("time").attr("datetime")?.slice(0,10)??null;
      if(url.startsWith("https://www.whitehouse.gov/presidential-actions/")&&title&&/tariff|import|customs|trade|dut(?:y|ies)|section 232|section 301/i.test(title)&&date&&date>=since.toISOString().slice(0,10)&&date<=entryDate)notices.push({title,url,date,source:"White House"});
    });
    coverageNotes.push("White House coverage checks the first presidential-actions page and tariff-related titles only. Older or indirectly titled actions can be outside this scan; listings are review leads, not applied law.");
  }
  progress("Confirming the schedule did not change during the check…"); const revisionAfter = await revision();
  const consistentRevision = revisionBefore !== null && revisionBefore === revisionAfter && entryDate === easternIsoDate();
  coverageNotes.push("Published notices were fetched as review leads; their legal scope, annexes and rate changes have not been automatically applied.", "Full-duty results also depend on stored reviewed rules. Fresh USITC base rates do not establish complete Chapter 99, Section 232, AD/CVD, exclusions or qualification coverage.", products.some(p => p.history) ? "Import history is repriced using today's rules on the historical values, grouped by SKU / HTS / origin. This is not an annual forecast, historical liability calculation, refund claim or comparison with duty paid. Original entry dates and payments are retained. Quantities are summed only when every entry supplies a quantity in the same unit; missing quantities withhold quantity-based duties. Rounding is per group, not per entry line." : "Annual values and classifications come from the uploaded file. Duty uses today's entry-date rules with those values held constant; it does not predict future law or verify classifications.");
  if(!consistentRevision){historicalComparison.status="unavailable";historicalComparison.issues.push("The current release changed or could not be confirmed; no consistent historical comparison is claimed.");}
  if (!consistentRevision) coverageNotes.push("A stable USITC revision could not be established across this check. These rows must not be treated as a consistent release.");
  const complete = rows.every(r => r.stack?.totalAmount !== null && r.stack?.totalAmount !== undefined && !r.error && r.verification?.status !== "failed");
  const basis = products.some(p => p.inputBasis === "catalogue") ? "catalogue" as const : products.some(p => p.history) ? "historical" as const : "annual" as const;
  if (basis === "catalogue") coverageNotes.push("This checks saved catalogue products. Reference prices are not customs values. Products without declared customs values or shipment facts retain rates where supported; dollar exposure stays unresolved. Values of different bases are not added.");
  const valueBases = [...new Set(products.map(p=>p.valueBasis ?? (p.history ? "historical" : p.inputBasis ? null : "annual")))];
  const valuationBasis = valueBases.length===1 ? valueBases[0] : null;
  const totalDuty = valuationBasis !== null && complete && consistentRevision ? combineDutyAmounts(rows.map(r=>r.stack!.totalAmount!)) : null;
  return { calculationVersion:DUTY_CALCULATION_VERSION, chatRecheck: null as CheckRefresh | null, baselineCheckId: null as string | null, comparison: null as DutyComparison | null, historicalComparison, remedyUpdate: {revision:remedySnapshot?.revision??null,status:remedySnapshot?.status??"failed",issues:remedyError?[remedyError]:remedySnapshot?.issues??[],scopeCounts:remedySnapshot?Object.fromEntries(Object.entries(remedySnapshot.notes).map(([n,v])=>[n,Object.fromEntries(Object.entries(v.lists).map(([k,c])=>[k,c.length]))])):{}}, basis, valuationBasis, totalDuty, importRows: products.reduce((sum,p) => sum + (p.history?.entries.length ?? 0),0), startedAt, checkedAt: new Date().toISOString(), entryDate, revisionBefore, revisionAfter, consistentRevision, products: products.length, rows, sources, notices, coverageNotes, totalAnnualDuty: basis === "annual" ? totalDuty : null, independentBaseChecks: rows.filter(r => r.verification?.status === "passed").length, unresolvedProducts: rows.filter(r => r.error || !r.stack || r.stack.totalAmount === null || r.verification?.status === "failed" || !consistentRevision).length };
}
export type LiveCheckResult = Omit<Awaited<ReturnType<typeof runLiveCheck>>,"calculationVersion"> & {calculationVersion?:string};
