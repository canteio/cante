import { gzipSync } from "node:zlib";
import { load } from "cheerio";
import { flattenHtsChapter } from "@/lib/classification/hts-schedule";
import { isStrictIsoDate } from "@/lib/tariff/date";
import {adcvdPublicUrl,publicAdcvdSession} from './adcvd-source';
import { digest, type ReferenceRelease, type ReferenceRate } from "./store";
export const registryUrl="https://hts.usitc.gov/reststop/releaseList";
export function officialReferenceUrl(raw:string){const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||u.port||!(adcvdPublicUrl(raw)||["hts.usitc.gov","www.usitc.gov","dataweb.usitc.gov","www.federalregister.gov","www.govinfo.gov"].includes(u.hostname)||(u.hostname==="rulings.cbp.gov"&&!u.search&&!u.hash&&/^\/api\/getdoc\/(?:ny|hq)\/20\d{2}\/[A-Z]\d{6}\.pdf$/.test(u.pathname))||(u.hostname==="content.govdelivery.com"&&!u.search&&!u.hash&&(/^\/accounts\/USDHSCBP\/bulletins\/[a-z0-9]+$/.test(u.pathname)||/^\/attachments\/USDHSCBP\/\d{4}\/\d{2}\/\d{2}\/file_attachments\/\d+\/[^/]+\.pdf$/.test(u.pathname)))))throw Error("Use an official reference URL.");return u.toString();}
export function officialSourceChallenge(bytes:Buffer){return /<title[^>]*>\s*(?:Challenge|Access Denied|Request unsuccessful)/i.test(bytes.subarray(0,8192).toString('utf8'));}
export async function fetchReference(url:string,maxBytes=25000000):Promise<Buffer>{
 officialReferenceUrl(url);if(adcvdPublicUrl(url)){const bytes=await(await publicAdcvdSession())(url);if(bytes.length>maxBytes)throw Error('Official reference exceeds its capture limit.');return bytes;}const response=await fetch(url,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(45000)});if(!response.ok||!response.body)throw Error(`Official reference HTTP ${response.status}: ${url}`);
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>maxBytes)throw Error("Official reference exceeds its capture limit.");parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});}const bytes=Buffer.concat(parts,size);if(officialSourceChallenge(bytes))throw Error("Official source returned an access challenge, not usable tariff evidence.");return bytes;
}
function iso(raw:unknown){if(typeof raw!=="string"||!/^\d\d\/\d\d\/\d{4}$/.test(raw))throw Error("Invalid publisher date.");const [m,d,y]=raw.split("/");const out=`${y}-${m}-${d}`;if(!isStrictIsoDate(out))throw Error("Invalid publisher date.");return out;}
export function normalizeReleases(raw:unknown):ReferenceRelease[]{
 if(!Array.isArray(raw)||raw.length>3000)throw Error("Invalid release registry.");
 const releases=raw.filter(r=>r&&/^[0-9]{4}(?:HTS[A-Za-z0-9_]*|BasicEdition)$/.test(r.name)&&!/prelim/i.test(r.name)&&["archive","current"].includes(r.status)).map(r=>({name:r.name,description:String(r.description),published_on:iso(r.date),available_from:iso(r.releaseStartDate),available_until:r.releaseEndDate?iso(r.releaseEndDate):null}));
 if(new Set(releases.map(r=>r.name)).size!==releases.length||releases.some(r=>r.available_until&&r.available_until<=r.available_from))throw Error("Ambiguous release registry.");return releases;
}
export function archivePage(html:string,url:string){
 const $=load(html);const names=new Set<string>(),jsons=new Set<string>(),notices=new Set<string>();
 $('a[href]').each((_,a)=>{const href=$(a).attr('href')!;const u=new URL(href,url);const release=u.searchParams.get('release');if(release&&/^\d{4}(?:HTS[A-Za-z0-9_]*|BasicEdition)$/.test(release)&&!/prelim/i.test(release))names.add(release);if(/_json\.json$/i.test(u.pathname))jsons.add(officialReferenceUrl(u.toString()));if(u.hostname==='www.federalregister.gov'&&/^\/(documents\/|d\/)/.test(u.pathname))notices.add(officialReferenceUrl(u.toString()));});
 if(names.size!==1||jsons.size!==1)throw Error("An edition page must identify one release and one published JSON file.");return {release:[...names][0],json:[...jsons][0],notices:[...notices]};
}
/** Discover only publisher-linked files. Older PDF-only editions are reported,
 * never replaced with a guessed modern JSON export or today's schedule. */
export function archiveIndex(html:string,url:string){
 officialReferenceUrl(url);if(officialSourceChallenge(Buffer.from(html)))throw Error('Official archive access challenge; no source coverage was inferred.');const $=load(html);
 const editions:{release:string;json:string;notices:string[];indexUrl:string;title:string}[]=[];
 const unavailable:{title:string;reason:string}[]=[];
 $('.views-field-nothing').each((_,node)=>{
  const row=$(node).parent(),title=row.children().first().text().replace(/\s+/g,' ').trim();
  if(!title)return;
  try{editions.push({...archivePage(row.html()??'',url),indexUrl:url,title});}
  catch(error){unavailable.push({title,reason:error instanceof Error?error.message:'Unsupported archive format'});}
 });
 const pages=new Set<string>();$('a[href]').each((_,a)=>{const next=new URL($(a).attr('href')!,url);if(next.origin===new URL(url).origin&&next.pathname===new URL(url).pathname&&/^\d{1,2}$/.test(next.searchParams.get('page')??'')){next.hash='';next.search='?page='+next.searchParams.get('page');officialReferenceUrl(next.toString());pages.add(next.toString());}});
 if(!editions.length&&!unavailable.length)throw Error('Archive index contains no recognized edition rows.');
 return {editions,unavailable,pages:[...pages]};
}
export function projectHistoricalRates(raw:unknown):Omit<ReferenceRate,"source_id">[]{
 if(!Array.isArray(raw)||raw.length<10000||raw.length>100000)throw Error("Incomplete historical schedule.");
 const groups=new Map<string,unknown[]>();let current="";
 for(const row of raw){if(typeof row?.htsno!=="string")throw Error("Invalid historical HTS row.");const code=row.htsno.replace(/\D/g,"");if(code){current=code.slice(0,2);if(!/^(0[1-9]|[1-9][0-9])$/.test(current))throw Error("Invalid historical chapter.");}if(current){const rows=groups.get(current)??[];rows.push(row.units === "" ? { ...row, units: [] } : row);groups.set(current,rows);}}
 if(Array.from({length:99},(_,i)=>String(i+1).padStart(2,"0")).some(c=>c!=="77"&&!groups.has(c)))throw Error("Historical schedule omits a chapter.");
 const rates:Omit<ReferenceRate,"source_id">[]=[];for(const [chapter,rows] of groups){if(chapter==="77")continue;for(const leaf of flattenHtsChapter(rows,chapter))rates.push({hts:leaf.htsCode.replace(/\D/g,""),description:leaf.fullDescription,general:leaf.general,special:leaf.special,column2:leaf.other,additional_duties:leaf.additionalDuties,units:leaf.units,footnotes:leaf.footnotes});}
 if(rates.length<10000||new Set(rates.map(r=>r.hts)).size!==rates.length)throw Error("Incomplete or duplicate reference projection.");return rates;
}
export function referencePackage(input:{kind:string;url:string;title:string;bytes:Buffer;release_name?:string;metadata?:Record<string,unknown>;external?:boolean|'always'}){
 if(!input.bytes.length||input.bytes.length>25000000)throw Error("Reference byte budget exceeded.");
 const compressed=gzipSync(input.bytes),stored=(input.external===true&&input.bytes.length>1000000)||compressed.length<input.bytes.length?compressed:input.bytes,external=input.external==='always'||stored.length>1000000&&input.external===true;if(stored.length>9000000&&!external||stored.length>25000000)throw Error("Reference stored-byte budget exceeded.");
 const storage=external?{bucket:'official-tariff-references',path:digest(input.bytes)+'.bin',storedSha256:digest(stored),storedBytes:stored.length}:undefined;
 return {release_name:input.release_name??null,kind:input.kind,url:input.url,title:input.title,body:external?'':stored.toString("base64"),compression:stored===compressed?"gzip":"none",stored_sha256:digest(external?Buffer.alloc(0):stored),original_sha256:digest(input.bytes),original_bytes:input.bytes.length,metadata:{...input.metadata,...(storage?{storage}:{}),interpretation:"Captured evidence only. Legal effective dates and complete entry applicability require review."},...(external?{storageBytes:stored}:{})};
}
