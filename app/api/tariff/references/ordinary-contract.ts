/** A bounded, dated ordinary Column 1 contract. It establishes tariff-column
 * eligibility from the original General Note 3, never legal origin itself. */
import {getDocumentProxy} from 'unpdf';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {isStrictIsoDate} from '@/lib/tariff/date';
import type {ReferenceSource} from './store';
export async function ordinaryNotesText(bytes:Buffer){
 if(bytes.length>25000000||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Dated ordinary notes require a bounded original PDF.');
 const doc=await getDocumentProxy(new Uint8Array(bytes));try{if(doc.numPages>1000)throw Error('Ordinary notes exceed their page bound.');let text='';for(let p=1;p<=Math.min(20,doc.numPages);p++){const content=await(await doc.getPage(p)).getTextContent();if(content.items.length>12000)throw Error('Ordinary notes page exceeds item bound.');text+=content.items.flatMap(i=>'str'in i?[i.str]:[]).join(' ')+' ';if(text.length>250000)throw Error('Ordinary notes excerpt exceeds its bound.');}return text;}finally{await doc.loadingTask.destroy();}
}
export type OrdinaryCountryContract={compiler:'historical-ordinary-mfn-v1';year:number;sourceId:string;eligibleOrigins:string[];excludedOrigins?:string[];publishedExcludedOrigins?:string[];sourceIds?:string[];appliedOrigin?:string;from?:string;before?:string;transition?:{origin:string;entryDate:string;column:'column1'|'column2';effectiveOn:string;publicationDate:string;documentNumber:string;sourceId:string}};
export type AnnualScheduleIdentity={year:number;chapter:string;publisherRelease:string;description:string;availableFrom:string;availableBefore:string;registryId?:string;detailsId?:string;archiveId:string;indexId?:string;provenanceIds?:string[]};
export function annualScheduleSourceIds(identity:Omit<AnnualScheduleIdentity,'chapter'>){return [...new Set(identity.provenanceIds??[identity.registryId,identity.detailsId,identity.archiveId].filter((s):s is string=>typeof s==='string'))];}
export function annualScheduleParentIds(source:Pick<ReferenceSource,'metadata'>){const m=source.metadata;return m.annualScheduleFormat==='legacy_index'?[m.indexId,...(Array.isArray(m.archiveIds)?m.archiveIds:[])].filter((s):s is string=>typeof s==='string'):[m.registryId,m.detailsId,m.archiveId].filter((s):s is string=>typeof s==='string');}

/** The publisher's complete bounded older archive supplies edition dates/links.
 * These dates bound source coverage; they are never legal effective dates. */
export function legacyAnnualEditions(archives:{url:string;html:string}[]){
 try{
 if(archives.length!==3||new Set(archives.map(a=>a.url)).size!==3)return null;
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'],editions:{year:number;title:string;index:string;publishedOn:string;availableFrom:string;availableBefore:string}[]=[];
 for(const archive of archives){const u=new URL(archive.url);if(u.origin!=='https://www.usitc.gov'||u.pathname!=='/harmonized_tariff_information/hts/archive/list'||u.searchParams.size!==1||!['7','8','9'].includes(u.searchParams.get('page')??'')||u.hash||u.username||u.password||archive.html.length>3000000)return null;
  const $=load(archive.html);let bad=false;$('.views-field-nothing').each((_,node)=>{const row=$(node).parent(),title=row.children().first().text().replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim(),m=/^(20\d\d) HTSA (?!Preliminary)(.+) \(([A-Za-z]+) (\d{1,2}), (\d{4})\)$/.exec(title);if(!m||Number(m[1])<2000||Number(m[1])>2015)return;
   const year=Number(m[1]),month=months.indexOf(m[3])+1,publishedOn=`${m[5]}-${String(month).padStart(2,'0')}-${m[4].padStart(2,'0')}`,links=row.find('a[href]').toArray().filter(a=>/^HTML$/i.test($(a).text().trim()));if(!isStrictIsoDate(publishedOn)||links.length!==1){bad=true;return;}
   const index=new URL($(links[0]).attr('href')!,archive.url);if(index.protocol==='http:')index.protocol='https:';if(!['https://www.usitc.gov','https://hts.usitc.gov'].includes(index.origin)||index.username||index.password||index.hash){bad=true;return;}
   editions.push({year,title,index:index.toString(),publishedOn,availableFrom:publishedOn<year+'-01-01'?year+'-01-01':publishedOn,availableBefore:(year+1)+'-01-01'});
  });if(bad)return null;
 }
 if(editions.length>100||Array.from({length:16},(_,i)=>2000+i).some(y=>!editions.some(e=>e.year===y))||new Set(editions.map(e=>e.index)).size!==editions.length)return null;
 for(const e of editions){const dates=editions.filter(n=>n.year===e.year&&n.availableFrom>e.availableFrom).map(n=>n.availableFrom).sort();if(dates.length)e.availableBefore=dates[0];if(editions.some(n=>n!==e&&n.year===e.year&&n.availableFrom===e.availableFrom))return null;}
 return editions.sort((a,b)=>a.year-b.year||a.availableFrom.localeCompare(b.availableFrom));
 }catch{return null;}
}
export function legacyAnnualChapterLink(index:string,html:string,chapter:string){
 try{
 const u=new URL(index);if(u.origin!=='https://www.usitc.gov'||u.username||u.password||u.hash||!/^\d{2}$/.test(chapter)||html.length>3000000)return null;const $=load(html),links=new Set<string>();
 $('a[href]').each((_,a)=>{const href=new URL($(a).attr('href')!,index);if(href.protocol==='http:')href.protocol='https:';if(href.origin==='https://www.usitc.gov'&&!href.hash&&!href.search&&!href.username&&!href.password&&new RegExp('(?:c|ch)0?'+Number(chapter)+'(?:_[0-9]{1,3})?\\.pdf$','i').test(href.pathname))links.add(href.toString());});
 return links.size===1?[...links][0]:null;
 }catch{return null;}
}
export function proveLegacyAnnualScheduleIdentity(input:{source:Pick<ReferenceSource,'id'|'kind'|'url'|'metadata'>;indexSource:Pick<ReferenceSource,'id'|'kind'|'url'|'metadata'>;index:string;indexes?:{source:Pick<ReferenceSource,'id'|'kind'|'url'>;html:string}[];archives:{source:Pick<ReferenceSource,'id'|'kind'|'url'>;html:string}[]}):AnnualScheduleIdentity|null{
 const {source,indexSource}=input,m=source.metadata,year=m.annualScheduleYear,chapter=m.chapter;if(source.kind!=='legal_document'||m.role!=='annual_schedule_chapter'||m.annualScheduleFormat!=='legacy_index'||typeof year!=='number'||year<2000||year>2015||typeof chapter!=='string'||chapter!=='91'||m.indexId!==indexSource.id||indexSource.kind!=='legal_document'||!Array.isArray(m.archiveIds)||m.archiveIds.length!==3||input.archives.some(a=>a.source.kind!=='legal_document')||new Set(m.archiveIds).size!==3||input.archives.some(a=>!(m.archiveIds as unknown[]).includes(a.source.id)))return null;
 const editions=legacyAnnualEditions(input.archives.map(a=>({url:a.source.url,html:a.html}))),matches=editions?.filter(e=>e.year===year&&e.index===indexSource.url);if(matches?.length!==1||legacyAnnualChapterLink(indexSource.url,input.index,chapter)!==source.url)return null;const edition=matches[0],linked:{source:Pick<ReferenceSource,'id'|'kind'|'url'>;edition:typeof edition}[]=[{source:indexSource,edition}];
 if((input.indexes?.length??0)>100)return null;for(const index of input.indexes??[]){if(index.source.id===indexSource.id)continue;const e=editions!.filter(e=>e.year===year&&e.index===index.source.url);if(index.source.kind==='legal_document'&&e.length===1&&legacyAnnualChapterLink(index.source.url,index.html,chapter)===source.url)linked.push({source:index.source,edition:e[0]});}
 linked.sort((a,b)=>a.edition.availableFrom.localeCompare(b.edition.availableFrom));if(new Set(linked.map(l=>l.source.id)).size!==linked.length||linked.slice(1).some((l,i)=>linked[i].edition.availableBefore!==l.edition.availableFrom))return null;
 return{year,chapter,publisherRelease:edition.index,description:linked.map(l=>l.edition.title).join(' / '),availableFrom:linked[0].edition.availableFrom,availableBefore:linked.at(-1)!.edition.availableBefore,indexId:indexSource.id,archiveId:input.archives[0].source.id,provenanceIds:[...linked.map(l=>l.source.id),...input.archives.map(a=>a.source.id)].sort()};
}
/** Old publisher names are not years. Bind the immutable chapter URL to the
 * actual archive link, raw registry and matching details; never guess an alias
 * or treat release availability as a legal effective date. */
type AnnualPublishedIdentityInput = {source:Pick<ReferenceSource,'id'|'kind'|'url'|'metadata'>;registrySource:Pick<ReferenceSource,'id'|'kind'|'url'>;detailsSource:Pick<ReferenceSource,'id'|'kind'|'url'|'metadata'>;archiveSource:Pick<ReferenceSource,'id'|'kind'|'url'>;registry:unknown;details:unknown;archive:string};
function proveAnnualPublishedIdentity(input:AnnualPublishedIdentityInput,changes=false):AnnualScheduleIdentity|null{
 const {source,registrySource,detailsSource,archiveSource}=input,m=source.metadata,year=m.annualScheduleYear,chapter=changes?"00":typeof m.chapter==="string"?m.chapter:"",name=m.publisherRelease;
 if(source.kind!=='legal_document'||m.role!==(changes?'annual_schedule_changes':'annual_schedule_chapter')||![2015,2016,2017].includes(Number(year))||typeof year!=='number'||(!changes&&(typeof chapter!=='string'||!/^\d{2}$/.test(chapter)||Number(chapter)<1||Number(chapter)>97||chapter==='77'))||typeof name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_]{0,79}$/.test(name))return null;
 if(m.registryId!==registrySource.id||m.detailsId!==detailsSource.id||m.archiveId!==archiveSource.id||registrySource.kind!=='release_registry'||registrySource.url!=='https://hts.usitc.gov/reststop/releaseList'||detailsSource.kind!=='legal_document'||archiveSource.kind!=='legal_document')return null;
 let url:URL,detailsUrl:URL,archiveUrl:URL;try{url=new URL(source.url);detailsUrl=new URL(detailsSource.url);archiveUrl=new URL(archiveSource.url);}catch{return null;}
 if(url.origin!=='https://hts.usitc.gov'||url.pathname!=='/reststop/file'||url.searchParams.size!==2||url.searchParams.get('release')!==name||url.searchParams.get('filename')!==(changes?'Change Record':'Chapter '+Number(chapter))||url.hash||url.username||url.password)return null;
 if(detailsUrl.origin!=='https://hts.usitc.gov'||detailsUrl.pathname!=='/reststop/releaseDetails'||detailsUrl.searchParams.size!==1||detailsUrl.searchParams.get('release')!==name||detailsUrl.hash||detailsUrl.username||detailsUrl.password)return null;
 if(archiveUrl.origin!=='https://www.usitc.gov'||archiveUrl.pathname!=='/harmonized_tariff_information/hts/archive/list'||archiveUrl.hash||archiveUrl.username||archiveUrl.password||input.archive.length>3000000)return null;
 if(detailsSource.metadata.role!=='annual_schedule_details'||detailsSource.metadata.annualScheduleYear!==year||detailsSource.metadata.publisherRelease!==name)return null;
 if(!Array.isArray(input.registry)||input.registry.length>3000)return null;
 const records=input.registry.filter(r=>r&&r.name===name&&r.status==='archive'&&typeof r.description==='string'&&r.description.startsWith(year+' '));if(records.length!==1)return null;
 const record=records[0],details=input.details as {reldetail?:Record<string,unknown>;pdfList?:Record<string,unknown>};
 if(!details||!details.reldetail||!details.pdfList||Object.keys(details.pdfList).length>500||!Object.hasOwn(details.pdfList,changes?'Change Record':'Chapter '+Number(chapter))||!['name','description','releaseStartDate','releaseEndDate'].every(k=>details.reldetail![k]===record[k]))return null;
 const iso=(s:unknown)=>{const a=typeof s==='string'?/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s):null,v=a?`${a[3]}-${a[1]}-${a[2]}`:'';return isStrictIsoDate(v)?v:null;},from=iso(record.releaseStartDate),before=iso(record.releaseEndDate);
 if(!from||!before||from<year+'-01-01'||before>(year+1)+'-01-01'||before<=from)return null;
 const $=load(input.archive);let linked=false;
 $('.views-field-nothing').each((_,node)=>{const row=$(node).parent(),title=row.children().first().text().replace(/\s+/g,' ').trim();if(!title.startsWith(year+' HTSA ')||/Preliminary/i.test(title))return;row.find('a[href]').each((_,a)=>{try{const u=new URL($(a).attr('href')!,archiveSource.url);if(u.protocol==='http:'&&u.hostname==='hts.usitc.gov')u.protocol='https:';if(u.origin==='https://hts.usitc.gov'&&u.searchParams.get('release')===name)linked=true;}catch{/* An unrelated malformed link supplies no evidence. */}});});
 return linked?{year,chapter,publisherRelease:name,description:record.description,availableFrom:from,availableBefore:before,registryId:registrySource.id,detailsId:detailsSource.id,archiveId:archiveSource.id}:null;
}
export function proveAnnualScheduleIdentity(input:AnnualPublishedIdentityInput):AnnualScheduleIdentity|null{return proveAnnualPublishedIdentity(input);}
export type AnnualScheduleChangeIdentity=Omit<AnnualScheduleIdentity,'chapter'>;
export function proveAnnualScheduleChangeIdentity(input:AnnualPublishedIdentityInput):AnnualScheduleChangeIdentity|null {
 const proof=proveAnnualPublishedIdentity(input,true);if(!proof)return null;
 const {chapter:_chapter,...identity}=proof;return identity;
}
export type AnnualScheduleChanges={compiler:'annual-change-record-2017-v1';year:2017;publisherRelease:'NTE';sourceId:string;sourceIds:string[];restorations:{hts8:string;effectiveOn:string;authority:string}[];annotations:{hts8:string;effectiveOn:string;previous:string[];established:string[];authority:string}[];undatedRestorations:string[]};
/** This bounded source contract establishes named dates, not an approval or rate.
 * Full original wording must match; missing/changed text cannot establish dates. */
export function proveAnnualScheduleChanges(input:{source:Pick<ReferenceSource,'id'|'kind'|'url'|'metadata'>;identity:AnnualScheduleChangeIdentity;text:string}):AnnualScheduleChanges|null {
 const {source,identity}=input,m=source.metadata;
 if(source.kind!=='legal_document'||m.role!=='annual_schedule_changes'||identity.year!==2017||identity.publisherRelease!=='NTE'||m.annualScheduleYear!==identity.year||m.publisherRelease!==identity.publisherRelease||m.registryId!==identity.registryId||m.detailsId!==identity.detailsId||m.archiveId!==identity.archiveId||source.url!=='https://hts.usitc.gov/reststop/file?release=NTE&filename=Change%20Record'||input.text.length>250000)return null;
 const text=input.text.replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
 if(createHash('sha256').update(text).digest('hex')!=='958dbb06fa41a6fb5b96475a96f9129c445ef8fa37d45c74c9dc84b092baa1d2')return null;
 const clauses=['CHANGE RECORD-2017 Edition (Rev. 1)','6907.30.10 Restored column 2 rate of duty January 1, 2017 PP 9549','4409.22.65 Col. 2 rate Restored N/A Technical correction','2918.17.0000 Annotated July 1, 2017 484(f)','2918.17.0001 Established July 1, 2017 484(f)','2931.39.0000 Annotated July 1, 2017 484(f)',...['12','15','18'].map(s=>'2931.39.00'+s+' Established July 1, 2017 484(f)')];
 if(clauses.some(c=>text.split(c).length!==2))return null;
 return{compiler:'annual-change-record-2017-v1',year:2017,publisherRelease:'NTE',sourceId:source.id,sourceIds:[source.id,...annualScheduleSourceIds(identity)],restorations:[{hts8:'69073010',effectiveOn:'2017-01-01',authority:'PP 9549'}],annotations:[{hts8:'29181700',effectiveOn:'2017-07-01',previous:['00'],established:['01'],authority:'484(f)'},{hts8:'29313900',effectiveOn:'2017-07-01',previous:['00'],established:['12','15','18'],authority:'484(f)'}],undatedRestorations:['44092265']};
}

// This is a bounded reporting-name vocabulary, not origin evidence or an EU/FTA
// qualification rule. Each eligible origin still requires the dated GN 3 clause.
const names:Record<string,string[]>={CN:['china'],VN:['socialist republic of vietnam','vietnam','viet nam'],JP:['japan'],TW:['taiwan'],KR:['south korea','republic of korea'],DE:['germany'],FR:['france'],IT:['italy'],GB:['united kingdom'],TH:['thailand'],MY:['malaysia'],IN:['india'],ID:['indonesia'],SG:['singapore'],AU:['australia'],NZ:['new zealand'],CA:['canada'],MX:['mexico'],CH:['switzerland'],LI:['liechtenstein'],AT:['austria'],BE:['belgium'],BG:['bulgaria'],HR:['croatia'],CY:['cyprus'],CZ:['czech republic','czechia'],DK:['denmark'],EE:['estonia'],FI:['finland'],GR:['greece'],HU:['hungary'],IE:['ireland'],LV:['latvia'],LT:['lithuania'],LU:['luxembourg'],MT:['malta'],NL:['netherlands'],PL:['poland'],PT:['portugal'],RO:['romania'],SK:['slovakia'],SI:['slovenia'],ES:['spain'],SE:['sweden'],AF:['afghanistan'],LA:['laos'],RS:['serbia'],ME:['montenegro']};
/** Account for the whole list, including the known Serbia/Montenegro footnote.
 * An unfamiliar country, partial table or changed footnote does not silently
 * grant Column 1 treatment to every origin absent from a substring search. */
function ordinaryExcludedOrigins(block:string,year:number,fullSource:string):string[]|null{
 const m=/following countries(?: and areas)?(?:[^:]{0,700}thereunder)?:\s*/i.exec(block);if(!m)return null;
 let tail=block.slice(m.index+m[0].length).trim();
 const footer=tail.indexOf('Harmonized Tariff Schedule of the United States (');if(footer>=0)tail=tail.slice(0,footer).trim();
 let withdrawnFootnote=false;const marker=/\b1\/\s*/.exec(tail);let crossReference:string|undefined;if(/Column 2\. 1\//.test(block)&&!marker){const matches=[...fullSource.matchAll(/\b1\/\s+(?:Pursuant to Pub\.L\. 102-420|Nondiscriminatory treatment was restored)/g)];if(matches.length!==1)return null;const rest=fullSource.slice(matches[0].index),end=rest.indexOf('Harmonized Tariff Schedule of the United States (');if(end<0||end>1000)return null;crossReference=rest.slice(0,end).trim();}if(marker||crossReference){const note=(marker?tail.slice(marker.index):crossReference!).replace(/^1\/\s*/,''),withdrawn=/^Pursuant to Pub\.L\. 102-420, Oct\. 16, 1992 \(106 Stat\. 2149\), nondiscriminatory treatment was withdrawn from goods that are products of Serbia or Montenegro effective Oct\. 31, 1992\.$/i,restored=/^Nondiscriminatory treatment was restored to goods that are products of Serbia or Montenegro, effective Dec\. 4, 2003\. See Notice of the Department of State, 68 F\.R\. 64410\.$/i;if(!(year<=2003&&withdrawn.test(note)||year>=2004&&restored.test(note)))return null;withdrawnFootnote=withdrawn.test(note);if(marker)tail=tail.slice(0,marker.index).trim();}
 const aliases=Object.entries({...names,CU:['cuba'],KP:['north korea'],AF:['afghanistan'],LA:['laos']}).flatMap(([code,values])=>values.map(name=>({code,name}))).sort((a,b)=>b.name.length-a.name.length),excluded:string[]=[];
 while(tail){const lower=tail.toLowerCase(),a=aliases.find(a=>lower===a.name||lower.startsWith(a.name+' '));if(!a||excluded.includes(a.code))return null;excluded.push(a.code);tail=tail.slice(a.name.length).trim();}
 const expected=year<=2001?['AF','LA','VN','CU','KP']:year===2002?['AF','LA','CU','KP']:year<=2005?['CU','LA','KP']:['CU','KP'];if(excluded.length!==expected.length||!expected.every(code=>excluded.includes(code))||year<=2003&&!withdrawnFootnote)return null;return withdrawnFootnote?[...excluded,'RS','ME']:excluded;
}
export function proveOrdinaryCountryContract(text:string,year:number,sourceId:string):OrdinaryCountryContract|null{
 if(!Number.isInteger(year)||year<2000||year>=2018||text.length>250000)return null;
 const clean=text.replace(/[“”]/g,'"').replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ');
 if(!clean.includes(`Harmonized Tariff Schedule of the United States (${year})`))return null;
 if(!/rates of duty in column 1 are rates which are applicable to all products other than those of countries enumerated in paragraph \(b\) of this note/i.test(clean))return null;
 if(!/"General" subcolumn sets forth the (?:general or normal trade relations \(NTR\)|most-favored-nation)/i.test(clean))return null;
 const starts=[...clean.matchAll(/\(b\) Rate of Duty Column 2\./gi)];if(starts.length!==1)return null;const tail=clean.slice(starts[0].index),ends=[...tail.matchAll(/\(c\) Products Eligible for Special Tariff Treatment\./gi)];if(ends.length!==1||ends[0].index>5000)return null;
 const block=tail.slice(0,ends[0].index);if(!/shall apply to products/i.test(block))return null;const excluded=ordinaryExcludedOrigins(block,year,clean);if(!excluded)return null;
 return{compiler:'historical-ordinary-mfn-v1',year,sourceId,eligibleOrigins:Object.keys(names).filter(code=>!excluded.includes(code)),excludedOrigins:excluded,publishedExcludedOrigins:[...excluded]};
}

export const ORDINARY_COUNTRY_ACTIONS=[
 {number:'01-30961',textSha256:'4f2ce8915af29016f83ec717d74ed0b8614f46c43b6be691d734927cf4934bec',year:2001,origins:['VN'],publicationDate:'2001-12-17',effectiveOn:'2001-12-10'},
 {number:'02-11487',textSha256:'94860f5a81cc87064e2a7e9a1c950cc6349d90fa2ba43e00e352cc57c4ec635a',year:2002,origins:['AF'],publicationDate:'2002-05-07',effectiveOn:'2002-06-06'},
 {number:'03-28438',textSha256:'793d9e65ddefdcebac69bd6d6349f56e7f7333f329f9e15bb776f9affe7a3e9e',year:2003,origins:['RS','ME'],publicationDate:'2003-11-13',effectiveOn:'2003-12-04'},
 {number:'05-2723',textSha256:'8fba930608a9c6a2120f90ada70ec53b83b5eae1399a03422fd47bab94fc753d',year:2005,origins:['LA'],publicationDate:'2005-02-11',effectiveOn:'2005-02-04'},
] as const;
export type OrdinaryCountryAction={id:string;url:string;number:string;text:string};
export function ordinaryCountryActionsForYears(entries:{date:string}[]):string[]{return ORDINARY_COUNTRY_ACTIONS.filter(a=>entries.some(e=>isStrictIsoDate(e.date)&&Number(e.date.slice(0,4))===a.year)).map(a=>a.number);}
const daysAfter=(date:string,days:number)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
/** Original operative clauses determine the legal date, not the capture date or
 * later consolidated edition. Changed/unrecognized wording stays unresolved. */
export function proveOrdinaryCountryAction(action:OrdinaryCountryAction){
 const c=ORDINARY_COUNTRY_ACTIONS.find(c=>c.number===action.number);if(!c||action.url!==`https://www.govinfo.gov/content/pkg/FR-${c.publicationDate}/pdf/${c.number}.pdf`||action.text.length>250000)return null;
 const t=action.text.replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ');if(createHash('sha256').update(t).digest('hex')!==c.textSha256)return null;const has=(s:string)=>t.toLowerCase().includes(s.toLowerCase());
 if(c.number==='01-30961'&&!(has('Presidential proclamation 7449')&&has('the effective date of nondiscriminatory treatment for products of Vietnam is December 10, 2001')&&has('exchanged written notices of acceptance')))return null;
 if(c.number==='02-11487'&&!(has('Proclamation 7553')&&has('May 7, 2002')&&has('General note 3(b) of the HTS is modified to exclude Afghanistan')&&has('on or after the thirtieth day after the date of publication of this proclamation in the Federal Register')&&daysAfter(c.publicationDate,30)===c.effectiveOn))return null;
 if(c.number==='03-28438'&&!(has('Public Notice 4526')&&has('Public Law 102-420')&&has('The certification was notified to Congress on November 4, 2003, and thus normal trade relations status will be restored to Serbia and Montenegro as of December 4, 2003')&&daysAfter('2003-11-04',30)===c.effectiveOn))return null;
 if(c.number==='05-2723'&&!(has('Public Law No. 108-429')&&has('products of Laos entered, or withdrawn from warehouse for consumption, on or after February 4, 2005, are granted NTR treatment by the United States')))return null;
 return{number:c.number,year:c.year,origins:[...c.origins] as string[],effectiveOn:c.effectiveOn,publicationDate:c.publicationDate,sourceId:action.id};
}
export function ordinaryCountryForEntry(base:OrdinaryCountryContract,entry:{date:string;origin:string},actions:OrdinaryCountryAction[]):{contract:OrdinaryCountryContract|null;issues:string[];sourceIds:string[]}{
 const ids=[base.sourceId],year=Number(entry.date.slice(0,4));if(!isStrictIsoDate(entry.date)||base.year!==year)return{contract:null,issues:['Historical country status: the source year and entry date do not agree.'],sourceIds:ids};
 const needed=ORDINARY_COUNTRY_ACTIONS.find(a=>a.year===year&&(a.origins as readonly string[]).includes(entry.origin));if(!needed)return{contract:base,issues:[],sourceIds:ids};
 const candidates=actions.filter(a=>a.number===needed.number);ids.push(...candidates.map(a=>a.id));const action=candidates.length===1?proveOrdinaryCountryAction(candidates[0]):null;
 if(!action)return{contract:null,issues:[`Historical country status: original ${needed.number} is missing, ambiguous or its operative wording changed. The in-year ${entry.origin} tariff-column transition was not inferred from a later note or the publication date.`],sourceIds:ids};
 const active=entry.date>=action.effectiveOn,eligible=base.eligibleOrigins.filter(c=>c!==entry.origin),excluded=(base.excludedOrigins??[]).filter(c=>c!==entry.origin);if(active)eligible.push(entry.origin);else excluded.push(entry.origin);
 return{contract:{...base,eligibleOrigins:eligible,excludedOrigins:excluded,sourceIds:[...new Set(ids)],appliedOrigin:entry.origin,from:active?action.effectiveOn:year+'-01-01',before:active?(year+1)+'-01-01':action.effectiveOn,transition:{origin:entry.origin,entryDate:entry.date,column:active?'column1':'column2',effectiveOn:action.effectiveOn,publicationDate:action.publicationDate,documentNumber:action.number,sourceId:action.sourceId}},issues:[],sourceIds:ids};
}
