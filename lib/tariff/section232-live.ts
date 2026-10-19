import { createClient } from "@/lib/supabase/server";
import { easternIsoDate } from "@/lib/tariff/date";

/**
 * Historical-data bridge: reads Section 232 rates from the Supabase-backed,
 * confidence-gated auto-ingestion pipeline (scripts/ingest-section232-
 * proclamation.ts + scripts/verify-section232-proposal.ts), instead of a
 * hand-maintained static table that goes stale every time a new
 * proclamation publishes.
 *
 * Only ever reads rows where current_section232_rate() has already
 * resolved status IN ('approved','auto_approved') -- a 'pending'
 * extraction awaiting verification is invisible here by construction
 * (see supabase/migrations/202610071003_section232_confidence_gate.sql).
 * A database/network failure here must never silently fall back to
 * fabricating a rate -- the caller (stack.ts) treats a thrown error or a
 * null result as "unresolved", not "zero duty".
 */

export interface Section232LiveMatch {
  annex: string;
  ratePercent: number;
  ukRatePercent: number | null;
  usContentRatePercent: number | null;
  effectiveDate: string;
  sourceDocumentNumber: string;
  sourceTitle: string;
  sourcePdfUrl: string;
}

interface RawRpcRow {
  annex: string;
  rate_percent: number | string;
  uk_rate_percent: number | string | null;
  us_content_rate_percent: number | string | null;
  effective_date: string;
  source_document_number: string;
  source_title: string;
  source_pdf_url: string;
}

export class Section232LiveLookupError extends Error {}

export function section232TargetDate(effectiveDate: string | undefined, now: Date = new Date()): string {
  return effectiveDate ?? easternIsoDate(now);
}

/**
 * Resolve the current live Section 232 rate for an HTS code, if any
 * approved/auto-approved proclamation annex covers it. Returns null (not
 * an error) when nothing covers this code -- that is a real, quiet
 * result, not a failure. Throws only when the lookup itself could not be
 * performed, so the caller can distinguish "not covered" from "we could
 * not ask".
 */
export async function lookupSection232Live(
  htsCode: string,
  signal?: AbortSignal,
  effectiveDate?: string,
): Promise<Section232LiveMatch | null> {
  const digitsOnly = htsCode.replace(/\D/g, "");
  if (!digitsOnly) return null;

  let client;
  try {
    client = await createClient();
  } catch (error) {
    throw new Section232LiveLookupError(
      `Could not reach the live Section 232 data store: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const targetDate = section232TargetDate(effectiveDate);
  // The June 8 amendment changes the April annex assignments. An April-only
  // store cannot establish either a match or a negative result after that date.
  const coverageQuery = client.from("section232_tariff_rows")
    .select("source_document_number,effective_date")
    .in("status", ["approved", "auto_approved"])
    .lte("effective_date", targetDate)
    .order("effective_date", { ascending: false }).limit(1);
  if (signal) coverageQuery.abortSignal(signal);
  const { data: coverage, error: coverageError } = await coverageQuery;
  if (coverageError || !coverage?.length) throw new Section232LiveLookupError("No accepted Section 232 coverage ledger could be established for the entry date.");
  if (targetDate >= "2026-06-08" && coverage[0].effective_date < "2026-06-08") {
    throw new Section232LiveLookupError("Section 232 coverage predates the June 8, 2026 amendment (2026-11314); current applicability is unverified.");
  }
  const reviewQuery = client.from("section232_coverage_reviews").select("source_document_number")
    .eq("source_document_number", coverage[0].source_document_number)
    .eq("effective_date", coverage[0].effective_date).gte("reviewed_through", targetDate).limit(1);
  if (signal) reviewQuery.abortSignal(signal);
  const { data: reviews, error: reviewError } = await reviewQuery;
  if (reviewError || !reviews?.length) throw new Section232LiveLookupError("No reviewed consolidated Section 232 snapshot covers the entry date; an accepted amendment alone cannot establish full coverage.");
  const query = client.rpc("current_section232_rate", {
    target_hts_prefix: digitsOnly,
    target_effective_date: targetDate,
  });
  if (signal) query.abortSignal(signal);
  const { data, error } = await query;
  if (error) {
    throw new Section232LiveLookupError(`Live Section 232 lookup failed: ${error.message}`);
  }
  const row = (data as RawRpcRow[] | null)?.[0];
  if (!row) return null;
  if (typeof row.effective_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.effective_date)) {
    throw new Section232LiveLookupError("Live Section 232 rule is missing a structured effective date.");
  }

  const rates = [row.rate_percent, row.uk_rate_percent, row.us_content_rate_percent].filter(value => value !== null).map(Number);
  if (rates.some(value => !Number.isFinite(value) || value < 0 || value > 200)) {
    throw new Section232LiveLookupError("Live Section 232 rule has an invalid rate.");
  }
  return {
    annex: row.annex,
    ratePercent: Number(row.rate_percent) / 100,
    ukRatePercent: row.uk_rate_percent === null ? null : Number(row.uk_rate_percent) / 100,
    usContentRatePercent: row.us_content_rate_percent === null ? null : Number(row.us_content_rate_percent) / 100,
    effectiveDate: row.effective_date,
    sourceDocumentNumber: row.source_document_number,
    sourceTitle: row.source_title,
    sourcePdfUrl: row.source_pdf_url,
  };
}

// Fresh consolidated USITC data, shared only within a calculation request.
// The reviewed database path above remains available for historical evaluations.
import { withFreshTariffCache } from "./rates";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import remedyContract from "@/config/tariff-remedy-contract.json";
export const REMEDY_URLS = {
  release: "https://hts.usitc.gov/reststop/currentRelease",
  notes: "https://hts.usitc.gov/reststop/getChapterNotes?doc=99",
  headings: "https://hts.usitc.gov/reststop/exportList?from=9901&to=9999&format=JSON&styles=false",
  china: "https://hts.usitc.gov/reststop/file?filename=China%20Tariffs&release=currentRelease",
};
export type RemedyHeading = { htsno: string; description: string; general: string; special: string; other: string };
export type RemedyEvidence = { url: string; checkedAt: string; sha256: string; body: string; encoding?: "utf8" | "base64" };
export type RemedyNote = { parts: Record<string,string>; lists: Record<string,string[]>; issues: string[] };
export type OfficialRemedySnapshot = { revision: string; checkedAt: string; status: "verified_structure" | "pending_verification"; notes: Record<string,RemedyNote>; headings: RemedyHeading[]; issues: string[]; evidence: RemedyEvidence[]; chinaCoverage?: Record<string,string>; parserVersion: number };
const tidy = (s:string) => s.replace(/\s+/g," ").trim();
export const remedyHash = (s:string) => createHash("sha256").update(s).digest("hex");
const notePart = (html:string, key:string) => {
  const $=load(html); return $("li[value]").filter((_,e)=>$(e).attr("value")?.trim()===`(${key})`).first();
};
export function remedyPartText(html:string): string {
  const $=load(html); $("table,ul").remove(); return tidy($.text());
}
/** A heading/table cell must be fully understood: never mine digits from prose. */
export function parseRemedyCodes(html:string): string[] {
  const $=load(html); const codes:string[]=[];
  if($("table").length!==1)throw Error("Expected one complete scope table; changed table layout requires verification.");
  $("table").first().find("td").each((_,e)=>{
    const value=tidy($(e).text()); if(!value || value==="null")return;
    for(const token of value.split(/\s+/)) {
      if(!/^\d{4}(?:\.\d{2}(?:\.\d{2}(?:\d{2}|\.\d{2})?)?)?$/.test(token)) throw Error(`Unsupported scope cell: ${value.slice(0,100)}`);
      codes.push(token.replace(/\D/g,""));
    }
  });
  if(!codes.length)throw Error("Published scope table is empty or unrecognized.");
  return [...new Set(codes)];
}
/** Scope/rate data may change; changed operative language requires a compiler update. */
export function compileOfficialRemedySnapshot(revision:string, notesHtml:string, headings:unknown, checkedAt:string, evidence:RemedyEvidence[]=[]): OfficialRemedySnapshot {
  if(!Array.isArray(headings) || headings.length<100 || headings.some(r=>typeof r?.htsno!=="string"))throw Error("Unrecognized Chapter 99 heading export.");
  const $=load(notesHtml); const notes:Record<string,RemedyNote>={};const issues:string[]=[];
  for(const number of [16,20,52]) {
    const refs=number===16?"9903.82":number===20?"9903.88":"9903.05";
    const roots=$(`li[value="${number}."]`).filter((_,e)=>$(e).text().includes(refs));
    const note:RemedyNote={parts:{},lists:{},issues:[]};notes[number]=note;
    if(roots.length!==1){note.issues.push(`Note ${number} could not be uniquely identified.`);continue;}
    const root=roots.first();
    const keys=Object.keys((remedyContract.notes as Record<string,Record<string,string>>)[String(number)]);
    for(const key of keys) {
      const part=root.find("li[value]").filter((_,e)=>$(e).attr("value")?.trim()===key).first();
      if(!part.length){note.issues.push(`Note ${number}${key} is missing.`);continue;}
      note.parts[key]=part.prop("outerHTML") ?? "";
      if(remedyHash(remedyPartText(note.parts[key])) !== (remedyContract.notes as Record<string,Record<string,string>>)[String(number)][key])note.issues.push(`Note ${number}${key} operative text changed; rule interpretation needs verification.`);
    }
    if(number!==20){const observed=root.children("ul").children("li").map((_,e)=>$(e).attr("value")?.trim()??"").get();if(observed.some(k=>!keys.includes(k)))note.issues.push(`Note ${number} contains a new operative subdivision; verification required.`);}
    if(number===16) {
      const scope=notePart(root.prop("outerHTML")??"","c");
      const section=load(scope.prop("outerHTML")??"");
      section("li").first().children("ul").children("li").each((_,e)=>{
        const key=section(e).attr("value")?.trim()??"";
        try{note.lists[key]=parseRemedyCodes(section(e).prop("outerHTML")??"");}catch(error){note.issues.push(`Note 16(c)${key}: ${error instanceof Error?error.message:"unreadable table"}`);}
      });
      if(Object.keys(note.lists).length!==11)note.issues.push("All eleven Note 16(c) lists were not established.");
    }
    if(number===52) {
      const text=load(note.parts["(c)"]??"").text();
      const references=[...text.matchAll(/\b(classifiable in subheading)\s+(\d{4}\.\d{2}\.\d{2})/g)].map(m=>m[2].replace(/\D/g,""));
      if(references.length!==16)note.issues.push("Note 52(c) conditional-article scope changed; verification required.");
      note.lists["(c)"]=references;
    }
    if(number===52)for(const key of ["b","d","e"]) {
      try { note.lists[`(${key})`]=parseRemedyCodes(note.parts[`(${key})`]??""); }
      catch(error){note.issues.push(`Note 52(${key}): ${error instanceof Error?error.message:"unreadable scope"}`);}
    }
  }
  // The source's malformed HTML places some Note 20 tables beside their LI.
  // Slice between explicit subdivision markers, preserving those sibling tables.
  const root20=$('li[value="20."]').filter((_,e)=>$(e).text().includes("9903.88")).first().prop("outerHTML")??"";
  for(const [key,next] of [["b","c"],["d","e"],["f","g"],["s","t"]]) {
    const marker=(k:string)=>new RegExp(`<li\\b[^>]*\\bvalue=["']\\s*\\(${k}\\)\\s*["'][^>]*>`,"i");
    const start=marker(key).exec(root20);const end=start?marker(next).exec(root20.slice(start.index+start[0].length)):null;
    try {
      if(!start||!end)throw Error("Subdivision boundaries are missing.");
      const html=root20.slice(start.index,start.index+start[0].length+end.index);
      notes[20].lists[`(${key})`]=parseRemedyCodes(html);
      const expected=(remedyContract as unknown as {listIntroHashes:Record<string,string>}).listIntroHashes?.[key];
      const intro=html.slice(0,html.indexOf("<table"));
      if(!expected||remedyHash(remedyPartText(intro))!==expected)notes[20].issues.push(`Note 20(${key}) scope introduction changed; verification required.`);
    }catch(error){notes[20].issues.push(`Note 20(${key}): ${error instanceof Error?error.message:"scope unavailable"}`);}
  }
  const baseline=(remedyContract as unknown as {scopeCounts?:Record<string,Record<string,number>>}).scopeCounts??{};
  for(const [n,note]of Object.entries(notes))for(const [part,codes]of Object.entries(note.lists))if(baseline[n]?.[part]&&codes.length<baseline[n][part]*0.5)note.issues.push(`Note ${n}${part} scope shrank by over half; incomplete extraction or legal removal needs verification.`);
  for(const [n,note] of Object.entries(notes))for(const issue of note.issues)issues.push(issue);
  const numbered=(headings as RemedyHeading[]).filter(h=>h.htsno);
  const unique=new Set(numbered.map(h=>h.htsno));
  if(unique.size!==numbered.length)issues.push("Duplicate Chapter 99 headings require verification.");
  return {revision,checkedAt,status:issues.length?"pending_verification":"verified_structure",notes,headings:headings as RemedyHeading[],issues,evidence,parserVersion:remedyContract.version};
}
const remedyContext=new AsyncLocalStorage<{pending?:Promise<OfficialRemedySnapshot>}>();
export function withOfficialRemedyCache<T>(fn:()=>Promise<T>):Promise<T>{
  const context:{pending?:Promise<OfficialRemedySnapshot>}={};
  return withFreshTariffCache(() => remedyContext.run(context,async()=>{
    const result=await fn();let snapshot:OfficialRemedySnapshot|undefined;
    if(context.pending)try{snapshot=await context.pending;}catch{/* the engine already records refresh failure */}
    if(snapshot){const response=await fetch(REMEDY_URLS.release,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Section232LiveLookupError("Could not confirm the USITC release after calculation.");const raw=await response.json();const revision=typeof raw==="string"?raw:raw?.name;if(revision!==snapshot.revision)throw new Section232LiveLookupError("USITC release changed during calculation. Mixed-release results were discarded.");}
    return result;
  }));
}
export async function fetchOfficialRemedySnapshot(signal?:AbortSignal):Promise<OfficialRemedySnapshot> {
  const existing=remedyContext.getStore();if(existing?.pending)return existing.pending;
  const pending=(async()=>{
    const evidence:RemedyEvidence[]=[];
    const read=async(url:string,pdf=false)=>{
      const res=await fetch(url,{cache:"no-store",redirect:"error",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
      if(!res.ok)throw Error(`USITC remedy source HTTP ${res.status}`);
      const reader=res.body?.getReader();if(!reader)throw Error("USITC remedy source is empty.");
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>8*1024*1024){await reader.cancel();throw Error("USITC remedy source exceeds 8 MB.");}chunks.push(p.value);}
      const bytes=Buffer.concat(chunks);const body=bytes.toString(pdf?"base64":"utf8");evidence.push({url,body,encoding:pdf?"base64":"utf8",checkedAt:new Date().toISOString(),sha256:pdf?createHash("sha256").update(bytes).digest("hex"):remedyHash(body)});return body;
    };
    const revision=(s:string)=>{const j=JSON.parse(s);const name=typeof j==="string"?j:j?.name;if(typeof name!=="string"||!name)throw Error("Missing USITC release identity.");return name;};
    const before=revision(await read(REMEDY_URLS.release));
    const [html,rows,pdf]=await Promise.all([read(REMEDY_URLS.notes),read(REMEDY_URLS.headings),read(REMEDY_URLS.china,true)]);
    const {getDocumentProxy,extractText}=await import("unpdf");const document=await getDocumentProxy(new Uint8Array(Buffer.from(pdf,"base64")));
    if(document.numPages>500)throw Error("China tariff coverage PDF exceeds the page limit.");
    const extracted=await extractText(document,{mergePages:true});
    const chinaCoverage=parseCurrentChinaCoverage(extracted.text);
    const after=revision(await read(REMEDY_URLS.release));if(before!==after)throw Error("USITC release changed during remedy refresh; no mixed-version rules applied.");
    return {...compileOfficialRemedySnapshot(after,html,JSON.parse(rows),new Date().toISOString(),evidence),chinaCoverage};
  })();
  if(existing)existing.pending=pending;return pending;
}
export type RemedyResolution={status:"resolved"|"not_applicable"|"needs_facts"|"pending_verification";heading:string|null;rate:number|null;reason:string;missingFacts:string[];citation:string[];combinedRate?:number};
export type RemedyFacts={standardCommercial?:boolean;metalWeightPercent?:number;usMetalQualification?:boolean;ukMetalQualification?:boolean;special232Claim?:boolean;equipmentUse?:boolean;motorcycleUse?:boolean;other232Heading?:string|null};
export const remedyCitations=(s:OfficialRemedySnapshot,n:number)=>[`${REMEDY_URLS.notes} · ${s.revision} · U.S. note ${n}`,REMEDY_URLS.headings];
/** Compute the supported ordinary metal regime; never infer weight or origin evidence. */
export function resolveCurrentMetal232(s:OfficialRemedySnapshot,input:{hts:string;country:string;baseRate:number|null;facts?:RemedyFacts}):RemedyResolution {
  const citation=remedyCitations(s,16);const result=(status:RemedyResolution["status"],reason:string,missingFacts:string[]=[],heading:string|null=null,rate:number|null=null):RemedyResolution=>{
    if(status==="resolved"&&heading&&rate===0&&!/^no change$/i.test(s.headings.find(r=>r.htsno===heading)?.general.trim()??""))return {status:"pending_verification",reason:`Published zero-additional-duty expression for ${heading} is missing or changed.`,missingFacts:[],heading:null,rate:null,citation};
    return {status,reason,missingFacts,heading,rate,citation};
  };
  if(s.issues.length)return result("pending_verification",s.issues.join(" "));
  const code=input.hts.replace(/\D/g,"");const lists=Object.entries(s.notes[16].lists).filter(([,codes])=>codes.some(c=>code.startsWith(c))).map(([k])=>k);
  if(!lists.length)return result("not_applicable","The exact product code is outside all eleven current Note 16(c) metal lists.",[],null,0);
  const facts=input.facts??{};const chapter=code.slice(0,2);
  const rateGroups=new Set(lists.map(k=>["(i)","(ii)","(iii)","(iv)","(v)"].includes(k)?"basic":["(vi)","(vii)","(viii)"].includes(k)?"derivative":["(ix)","(x)"].includes(k)?"combined":"mobile"));
  if(rateGroups.size>1)return result("needs_facts","The code occurs in lists with different duty treatments; product/metal scope must be resolved.",["multiple_metal_list_scope"]);
  if(facts.usMetalQualification&&facts.ukMetalQualification)return result("needs_facts","U.S. and UK metal qualification declarations conflict; verify the cumulative metal-origin facts.",["metal_origin_qualification"]);
  const ukEligible=lists.some(k=>["(i)","(ii)","(iii)","(iv)","(vi)","(vii)"].includes(k));
  if(!["72","73","74","76"].includes(chapter)) {
    if(facts.metalWeightPercent===undefined)return result("needs_facts","Current scope is known, but applicable-metal weight is missing.",["metal_weight_percent"]);
    if(facts.metalWeightPercent<15)return result("resolved","Applicable listed metal is below 15% by weight; Note 16(c) and 9903.82.03 apply.",[],facts.metalWeightPercent===0?"9903.82.01":"9903.82.03",0);
  }
  if(!facts.standardCommercial)return result("needs_facts","Confirm ordinary commercial treatment before applying a standard Section 232 heading.",["standard_commercial"]);
  if(facts.special232Claim!==false)return result("needs_facts","Confirm whether any special Section 232 quota, content, end-use or product exclusion is claimed.",["special_232_claim"]);
  if(input.country==="RU"||["CU","KP","BY"].includes(input.country))return result("needs_facts","Column 2 / Russian metal treatment requires a separately supported rule and metal-origin evidence.",["metal_origin_and_special_treatment"]);
  if(input.country==="GB"&&ukEligible&&facts.ukMetalQualification===undefined)return result("needs_facts","UK reduced rates require verified 95% metal production-origin qualification.",["uk_metal_qualification"]);
  const derivatives=lists.some(k=>["(ii)","(iv)","(vi)","(vii)","(viii)","(ix)","(x)","(xi)"].includes(k));
  if(derivatives&&facts.usMetalQualification===undefined)return result("needs_facts","Confirm whether all applicable metals satisfy the cumulative 85% U.S. metal-origin requirements.",["us_metal_qualification"]);
  if(lists.some(k=>["(vi)","(vii)","(viii)","(xi)"].includes(k))) {
    if(facts.motorcycleUse===undefined)return result("needs_facts","Motorcycle-manufacturing use affects the applicable heading.",["motorcycle_use"]);
    if(facts.motorcycleUse)return result("resolved","Declared motorcycle-manufacturing use satisfies Note 16(g).",[],"9903.82.13",0);
    if(lists.some(k=>["(vi)","(vii)","(viii)"].includes(k))&&["84","85","87"].includes(chapter)&&facts.equipmentUse===undefined)return result("needs_facts","Exclusive agricultural/industrial equipment use affects the applicable heading.",["equipment_use"]);
  }
  if(lists.includes("(xi)"))return result("needs_facts","Mobile industrial equipment needs country and U.S.-content treatment not yet supported by this compiler.",["mobile_equipment_content_and_origin"]);
  const specialEquipment=facts.equipmentUse===true&&lists.some(k=>["(vi)","(vii)","(viii)"].includes(k));
  const combined=lists.some(k=>["(ix)","(x)"].includes(k))||specialEquipment;
  if(combined&&input.baseRate===null)return result("needs_facts","Combined-rate treatment requires a computable Column 1 ad valorem equivalent.",["base_ad_valorem_equivalent"]);
  let heading:string;
  if(combined)heading=specialEquipment?(facts.usMetalQualification?"9903.82.23":"9903.82.25"):(facts.usMetalQualification?"9903.82.07":"9903.82.10");
  else if(input.country==="GB"&&ukEligible&&facts.ukMetalQualification)heading=lists.some(k=>["(i)","(ii)","(iii)","(iv)"].includes(k))?"9903.82.04":"9903.82.05";
  else if(derivatives&&facts.usMetalQualification)heading="9903.82.06";
  else heading=lists.some(k=>["(i)","(ii)","(iii)","(iv)","(v)"].includes(k))?"9903.82.02":"9903.82.09";
  const row=s.headings.find(r=>r.htsno===heading);if(!row)return result("pending_verification",`Published heading ${heading} is missing.`);
  const match=combined?/^(\d+(?:\.\d+)?)%$/.exec(row.general.trim()):/^The duty provided in the applicable subheading (?:\+|plus) (\d+(?:\.\d+)?)%$/.exec(row.general.trim());
  if(!match)return result("pending_verification",`Published rate expression for ${heading} is not supported.`);
  const threshold=Number(match[1])/100;let rate=combined?Math.max(0,threshold-input.baseRate!):threshold;
  if(combined&&rate===0)heading=specialEquipment?(facts.usMetalQualification?"9903.82.24":"9903.82.26"):(facts.usMetalQualification?"9903.82.08":"9903.82.11");
  return {...result("resolved",`Current Note 16 lists ${lists.join(", ")}; ${heading} applies to the full customs value using the supplied qualification facts.`,[],heading,rate),...(combined?{combinedRate:threshold}:{})};
}

/** Exact two-column PDF rows; prose/footers cannot become a positive scope match. */
export function parseCurrentChinaCoverage(text:string):Record<string,string> {
  if(!/China Tariffs/.test(text)||!/Last Updated/.test(text))throw Error("Missing China tariff source identity.");
  const coverage:Record<string,string>={};
  for(const line of text.split(/\r?\n/)) {
    const match=/^(\d{4}\.\d{2}\.\d{2}(?:\d{2})?)\s+(9903\.\d{2}\.\d{2})$/.exec(line.trim());
    if(!match){if(/^\d{4}\.\d{2}\.\d{2}/.test(line.trim()))throw Error("Unrecognized China tariff table row; incomplete extraction was rejected.");continue;}
    const key=match[1].replace(/\D/g,"");if(coverage[key]&&coverage[key]!==match[2])throw Error("Conflicting China tariff coverage rows.");coverage[key]=match[2];
  }
  if(Object.keys(coverage).length<5000)throw Error("China tariff extraction is unexpectedly small; verification required.");
  return coverage;
}
