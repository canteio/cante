import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { load } from "cheerio";
import { parseDutyRate, specialProgrammeCodes } from "@/lib/tariff/duty-expression";
import { quoteDuty, type TariffRow } from "@/lib/tariff/rates";
import type { LiveProduct, LiveSource } from "./check";

type ArchiveRow={htsno?:string;description?:string;general?:string;special?:string;other?:string;units?:string[];additionalDuties?:string};
const LIST="https://hts.usitc.gov/reststop/releaseList";
const INDEX="https://www.usitc.gov/harmonized_tariff_information/hts/archive/list";
const hash=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const tidy=(s:string)=>s.replace(/\s+/g," ").trim();
const digits=(s:string)=>s.replace(/\D/g,"");
const official=(url:string)=>{const u=new URL(url);if(u.protocol!=="https:"||u.username||u.password||!["hts.usitc.gov","www.usitc.gov","www.federalregister.gov","www.govinfo.gov"].includes(u.hostname))throw Error("Unapproved government source URL.");return u;};
export type HistoricalRelease={name:string;description:string;availableFrom:string;availableUntil:string|null};
function iso(value:unknown):string{if(typeof value!=="string"||!/^\d{2}\/\d{2}\/\d{4}$/.test(value))throw Error("Release availability date missing.");const [m,d,y]=value.split('/');const date=`${y}-${m}-${d}`;if(new Date(date).toISOString().slice(0,10)!==date)throw Error("Invalid release date.");return date;}
export function precedingRelease(raw:unknown,current:string):{current:HistoricalRelease;previous:HistoricalRelease}{
 if(!Array.isArray(raw))throw Error("Unrecognized official release list.");
 const selected=raw.filter(r=>r&&typeof r.name==="string"&&/^(?:\d{4}HTSRev\d+|\d{4}HTSBasic)$/.test(r.name)&&["archive","current"].includes(r.status));
 if(new Set(selected.map(r=>r.name)).size!==selected.length)throw Error("Duplicate release identities.");
 const releases=selected.map(r=>({name:r.name,description:String(r.description),availableFrom:iso(r.releaseStartDate),availableUntil:r.releaseEndDate?iso(r.releaseEndDate):null})).sort((a,b)=>b.availableFrom.localeCompare(a.availableFrom));
 const index=releases.findIndex(r=>r.name===current);if(index<0||!releases[index+1])throw Error("Previous published revision not established.");
 const after=releases[index],before=releases[index+1];
 if(before.availableFrom>=after.availableFrom||before.availableUntil!==after.availableFrom)throw Error("Previous release continuity is not established.");
 return {current:after,previous:before};
}
export function archiveEntries(html:string){
 const $=load(html);const entries=new Map<string,{json:string;notices:string[]}>();
 $('a[href*="release="]').each((_,a)=>{const u=new URL($(a).attr('href')!,INDEX);const name=u.searchParams.get('release');if(!name||!/^\d{4}HTS(?:Rev\d+|Basic)$/.test(name))return;
  const container=$(a).closest('.views-field-nothing').parent();const json=container.find('a[href$="_json.json"]').first().attr('href');if(!json)return;
  const notices=container.find('.views-field-field-hts-arch-mods-source a[href]').map((_,el)=>$(el).attr('href')!).get().filter(h=>/^https:\/\/www\.federalregister\.gov\/(?:d\/|documents\/)/.test(h));
  if(entries.has(name))throw Error("Ambiguous archive revision links.");entries.set(name,{json:official(new URL(json,INDEX).toString()).toString(),notices});
 });
 return entries;
}
export function archivedTariff(rows:ArchiveRow[],code:string):TariffRow|null{
 const exact=rows.filter(r=>typeof r.htsno==="string"&&digits(r.htsno)===digits(code));if(exact.length!==1)return null;
 const leaf=exact[0];const candidates=rows.filter(r=>typeof r.htsno==="string"&&[4,6,8,10].includes(digits(r.htsno).length)&&digits(code).startsWith(digits(r.htsno))).sort((a,b)=>digits(b.htsno!).length-digits(a.htsno!).length);
 const rated=candidates.find(r=>Boolean(r.general?.trim()||r.special?.trim()||r.other?.trim()))??leaf;
 return {htsCode:code,...(digits(rated.htsno!)!==digits(code)?{inheritedFromHtsCode:rated.htsno!}:{}),description:leaf.description??"",units:leaf.units?.length?leaf.units:rated.units??[],general:parseDutyRate(rated.general??null),special:parseDutyRate(rated.special??null),specialProgrammes:specialProgrammeCodes(rated.special??null),column2:parseDutyRate(rated.other??null),additionalDuties:rated.additionalDuties??null,fetchedAt:new Date().toISOString()};
}
export function legalNoteText(pdfText:string,n:number):string{
 const text=pdfText.split('\n').filter(line=>!/^Harmonized Tariff Schedule of the United States|^Annotated for Statistical Reporting Purposes$|^XXII$|^99\s*-\s*III\s*-\s*\d+$|^U\.S\. Notes(?: \(con\.\))?$/.test(line.trim())).join('\n');
 const begin=[...text.matchAll(new RegExp(`(?:^|\\n)${n}\\.\\s+`,'g'))];const next=[...text.matchAll(new RegExp(`(?:^|\\n)${n+1}\\.\\s+`,'g'))];
 let end=next.length===1?next[0].index!:null;
 if(n===52&&begin.length===1&&next.length===0){const rest=text.slice(begin[0].index!);const table=/^Rates of Duty/m.exec(rest);if(table&&/Heading\//.test(rest.slice(table.index,table.index+1000))&&/9903\.\d{2}\.\d{2}/.test(rest.slice(table.index,table.index+3000)))end=begin[0].index!+table.index;}
 if(begin.length!==1||end===null||end<=begin[0].index!)throw Error(`Note ${n} boundaries could not be established.`);
 return tidy(text.slice(begin[0].index!,end));
}
export function compareLegalNote(before:string,after:string,note:number){
 if(before===after)return null;let start=0;while(start<Math.min(before.length,after.length)&&before[start]===after[start])start++;let end=0;while(end<before.length-start&&end<after.length-start&&before.at(-1-end)===after.at(-1-end))end++;
 const oldEdit=before.slice(start,before.length-end),newEdit=after.slice(start,after.length-end);
 const exact=oldEdit.length+newEdit.length<=6000;
 const left=Math.max(0,start-500),oldEnd=Math.min(before.length,before.length-end+180),newEnd=Math.min(after.length,after.length-end+180);
 let oldContext=before.slice(left,oldEnd),newContext=after.slice(left,newEnd);let scopeText=`${oldEdit} ${newEdit}`;
 // Limit code matching to the changed numbered article, not neighboring excerpts.
 const markers=[...before.slice(0,start).matchAll(/\(\d{1,3}\)\s+/g)];const item=markers.at(-1);
 if(item&&start-item.index!<3000){const oldNext=/\(\d{1,3}\)\s+/.exec(before.slice(start));const newNext=/\(\d{1,3}\)\s+/.exec(after.slice(start));if(oldNext&&newNext&&oldNext.index<6000&&newNext.index<6000){oldContext=before.slice(item.index!,start+oldNext.index).trim();newContext=after.slice(item.index!,start+newNext.index).trim();scopeText=`${oldContext} ${newContext}`;}}
 const codes=[...new Set([...scopeText.matchAll(/\b\d{4}\.\d{2}\.\d{2}(?:\.?\d{2})?\b/g)].map(m=>m[0]))];
 return {note,kind:exact?"bounded_text_change" as const:"extensive_text_change" as const,before:oldContext,after:newContext,removed:exact?oldEdit:null,inserted:exact?newEdit:null,codes,reviewRequired:true};
}
export type HistoricalComparison={status:"compared"|"unavailable";current:HistoricalRelease|null;previous:HistoricalRelease|null;issues:string[];baseChanges:{sku:string;hts:string;origin:string;before:string|null;after:string|null;beforeAmount:number|null;afterAmount:number|null;difference:number|null;status:"compared"|"unresolved"}[];legalChanges:NonNullable<ReturnType<typeof compareLegalNote>>[];headingChanges:{code:string;before:string|null;after:string|null}[];modifyingDocuments:{number:string;title:string;publicationDate:string|null;effectiveOn:string|null;datesText:string|null;url:string;pdfUrl:string|null;pdfRetained:boolean}[];candidateSkus:string[];notesCompared:number[];scope:string[]};
export async function compareHistoricalRules(input:{currentRevision:string;products:LiveProduct[];currentRows:Map<string,TariffRow|null>;currentHeadings:{htsno:string;description:string;general:string}[];productMeasures?:Map<string,string[]>;sources:LiveSource[];signal?:AbortSignal;progress:(s:string)=>void}):Promise<HistoricalComparison>{
 const out:HistoricalComparison={status:"unavailable",current:null,previous:null,issues:[],baseChanges:[],legalChanges:[],headingChanges:[],modifyingDocuments:[],candidateSkus:[],notesCompared:[],scope:["Adjacent published HTS revisions, exact uploaded codes, Chapter 99 headings and U.S. notes 16, 20 and 52. This is not all historical law.","Release availability dates are not legal effective dates. Retroactive amendments, transition rules and shipment qualification require review.","Money differences here compare base duty on identical uploaded values; a complete historical tariff-stack impact is not asserted."]};
 let retained=0;
 const capture=async(name:string,url:string,format:"text"|"json"|"pdf"="text")=>{
  official(url);const source:LiveSource={name,url,fetchedAt:new Date().toISOString(),status:"failed",sha256:null,error:null,body:null};input.sources.push(source);
  try{const r=await fetch(url,{cache:"no-store",redirect:"error",signal:input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Government source HTTP ${r.status}.`);const reader=r.body?.getReader();if(!reader)throw Error("Government source body missing.");const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>20*1024*1024){await reader.cancel();throw Error("Historical source exceeds 20 MB.");}chunks.push(p.value);}
   const raw=Buffer.concat(chunks);if(format==="pdf"&&!raw.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error("Historical source is not a PDF.");
   const stored=format==="json"&&raw.length>1000000?gzipSync(raw):raw;const body=format==="pdf"||stored!==raw?stored.toString('base64'):raw.toString('utf8');const size=Buffer.byteLength(body);if(size>12000000)throw Error("Historical source exceeds the stored-source size limit; no partial comparison claimed.");if(retained+size>22*1024*1024||input.sources.reduce((sum,s)=>sum+Buffer.byteLength(s.body??''),0)+size>24*1024*1024)throw Error("Historical evidence exceeds its capture budget; no partial comparison claimed.");source.body=body;source.bodyEncoding=format==="pdf"||stored!==raw?"base64":"utf8";source.sha256=hash(stored);if(stored!==raw){source.compression="gzip";source.originalSha256=hash(raw);}retained+=size;source.status="fetched";return raw;
  }catch(e){source.error=e instanceof Error?e.message:"Historical source unavailable.";throw e;}
 };
 try{
  input.progress("Finding the previous official tariff revision…");const list=JSON.parse((await capture('USITC historical release registry',LIST)).toString('utf8'));const pair=precedingRelease(list,input.currentRevision);Object.assign(out,pair);
  // Discover the actual publisher links; never manufacture an archive filename.
  const entries=new Map<string,{json:string;notices:string[]}>();
  for(let page=0;page<4;page++){const html=(await capture('USITC revision archive index',INDEX+(page?`?page=${page}`:''))).toString('utf8');for(const [k,v] of archiveEntries(html))entries.set(k,v);if(entries.has(pair.current.name)&&entries.has(pair.previous.name))break;}
  const oldEntry=entries.get(pair.previous.name),newEntry=entries.get(pair.current.name);if(!oldEntry||!newEntry)throw Error("Adjacent revision archive links were not found within four index pages.");
  input.progress(`Retrieving ${pair.previous.description} and original rule documents…`);
  const oldRows=JSON.parse((await capture(`${pair.previous.description}: original JSON schedule`,oldEntry.json,'json')).toString('utf8'));if(!Array.isArray(oldRows)||oldRows.length<10000||oldRows.length>100000)throw Error("Historical schedule is incomplete or outside supported bounds.");
  for(const p of input.products){const old=archivedTariff(oldRows,p.hts),current=input.currentRows.get(p.hts)??null;const args={htsCode:p.hts,countryOfOrigin:p.origin,value:p.customsValue,quantity:p.quantity,unit:p.unit};const a=old?await quoteDuty(args,old):null,b=current?await quoteDuty(args,current):null;const valid=!!a&&!!b&&a.column===b.column&&a.computation.amount!==null&&b.computation.amount!==null;
   out.baseChanges.push({sku:p.sku,hts:p.hts,origin:p.origin,before:a?.rate.raw??null,after:b?.rate.raw??null,beforeAmount:a?.computation.amount??null,afterAmount:b?.computation.amount??null,difference:valid?Math.round((b!.computation.amount!-a!.computation.amount!)*100)/100:null,status:valid?'compared':'unresolved'});}
  const beforeMap=new Map<string,ArchiveRow>();for(const r of oldRows)if(typeof r.htsno==='string'&&r.htsno.startsWith('99')){if(beforeMap.has(r.htsno))throw Error("Duplicate historical Chapter 99 headings.");beforeMap.set(r.htsno,r);}
  const nowMap=new Map(input.currentHeadings.filter(r=>r.htsno).map(r=>[r.htsno,r]));for(const code of new Set([...beforeMap.keys(),...nowMap.keys()])){const a=beforeMap.get(code),b=nowMap.get(code);const old=a?tidy(`${a.description??''} | ${a.general??''}`):null,current=b?tidy(`${b.description} | ${b.general}`):null;if(old!==current)out.headingChanges.push({code,before:old,after:current});}
  const texts:string[]=[];
  for(const revision of [pair.previous,pair.current]){
   const url=`https://hts.usitc.gov/reststop/file?release=${encodeURIComponent(revision.name)}&filename=Chapter%2099_III`;
   const bytes=await capture(`${revision.description}: Chapter 99 subchapter III legal notes`,url,'pdf');const {getDocumentProxy,extractText}=await import('unpdf');const pdf=await getDocumentProxy(new Uint8Array(bytes));if(pdf.numPages>700)throw Error("Historical legal-note PDF exceeds 700 pages.");const text=(await extractText(pdf,{mergePages:true})).text;
   const revisionNumber=/Rev(\d+)$/.exec(revision.name)?.[1];const year=revision.name.slice(0,4);if(!revisionNumber||!text.includes(`Harmonized Tariff Schedule of the United States Revision ${revisionNumber} (${year})`))throw Error("Historical PDF revision identity could not be verified.");texts.push(text);
  }
  for(const n of [16,20,52]){const a=legalNoteText(texts[0],n),b=legalNoteText(texts[1],n);const change=compareLegalNote(a,b,n);if(change)out.legalChanges.push(change);out.notesCompared.push(n);}
  const docUrls=[...new Set([...newEntry.notices,...oldEntry.notices])];if(docUrls.length>6)out.issues.push(`Only six of ${docUrls.length} modifying documents were retrieved.`);
  input.progress("Linking the old/new rules to published amendments…");
  for(const url of docUrls.slice(0,6)){
   try{const number=/\/(\d{4}-\d+)(?:\/|$)/.exec(url)?.[1];if(!number)throw Error("Unrecognized modification-document identifier.");const meta=JSON.parse((await capture(`Federal Register modification ${number}`,`https://www.federalregister.gov/api/v1/documents/${number}.json`,'json')).toString('utf8'));if(meta.document_number!==number)throw Error("Modification document identity mismatch.");
    if(typeof meta.body_html_url==='string')await capture(`Federal Register amendment text ${number}`,official(meta.body_html_url).toString());
    let pdfRetained=false;if(typeof meta.pdf_url==='string'){await capture(`Official modification PDF ${number}`,official(meta.pdf_url).toString(),'pdf');pdfRetained=true;}
    out.modifyingDocuments.push({number,title:String(meta.title??number),publicationDate:typeof meta.publication_date==='string'?meta.publication_date:null,effectiveOn:typeof meta.effective_on==='string'?meta.effective_on:null,datesText:typeof meta.dates==='string'?meta.dates:null,url:typeof meta.html_url==='string'?official(meta.html_url).toString():url,pdfUrl:typeof meta.pdf_url==='string'?meta.pdf_url:null,pdfRetained});
   }catch(e){out.issues.push(`Modification source could not be fully retained: ${e instanceof Error?e.message:'unknown source failure'}`);}
  }
  const codes=out.legalChanges.flatMap(c=>c.codes.map(digits));out.candidateSkus=input.products.filter(p=>codes.some(c=>digits(p.hts).startsWith(c))||out.headingChanges.some(h=>input.productMeasures?.get(p.sku)?.includes(h.code))||out.baseChanges.some(c=>c.sku===p.sku&&c.difference!==null&&c.difference!==0)).map(p=>p.sku);
  out.modifyingDocuments.sort((a,b)=>(b.publicationDate??'').localeCompare(a.publicationDate??''));out.status='compared';return out;
 }catch(e){out.issues.push(e instanceof Error?e.message:"Historical comparison unavailable.");return out;}
}
