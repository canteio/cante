import{createHash}from'node:crypto';
import { getDocumentProxy } from "unpdf";
import {CHAPTER99_ACTIONS} from "./chapter99-contract";
import {guidanceEntryCutoff} from './cbp-guidance';
import {atEasternCutoff,historicalMeasureCovers} from '@/app/api/audits/shipment';
export{historicalMeasureCovers}from'@/app/api/audits/shipment';
export const HISTORICAL_ACTIONS=["2025-19482","2026-00327","2026-10571","2025-06063","2025-10524","2025-15819","2025-16419","2025-14893","2025-15010","2026-15181","2026-03824","2018-13248","2018-17709","2018-20610","2019-09681","2019-17865","2019-18838","2020-00904",...CHAPTER99_ACTIONS] as const;
export type HistoricalMeasure={heading:string;rate:string;legalEffectiveOn:string;legalCutoff?:'00:01';legalBefore?:string;hts8:string[];excludedHts10?:string[];exclusions:string[];actionSourceIds:string[]};
export type HistoricalContract={compiler:"historical-301-reference-v2";coverageFrom:string;coverageBefore:string;noteSourceId:string;measures:HistoricalMeasure[];completeScope?:boolean;describedScope?:string[];blockedHts8?:string[];chinaOnlyHeadings?:string[]};
/** Complete published eleven-family list. The hash is an explicit parser contract,
 * never legal approval. Unknown qualifiers or added/deleted items fail closed. */
export function china20gScope(notes:string){
 const normalized=notes.replace(/\s+/g,' '),at=normalized.indexOf('(g) For the purposes of heading 9903.88.04');if(at<0)return null;
 const following=normalized.indexOf('(h) The U.S. Trade Representative',at),table=normalized.indexOf('Rates of Duty Unit of Quantity Article Description Stat. Suf- fix Heading/ Subheading 2 1 Special General',at),end=following>=0?following:table;if(end<at||end-at>20000)return null;
 const section=normalized.slice(at,end),intro=/^\(g\) For the purposes of heading 9903\.88\.04, products of China, as provided for in this note, shall be subject to an additional (10|25) percent ad valorem rate of duty/.exec(section);if(!intro)return null;
 const marker='The products of China that are subject to an additional '+intro[1]+' percent ad valorem rate of duty under heading 9903.88.04 are the following products of China:',begin=section.indexOf(marker),last=section.indexOf('Notwithstanding U.S. note 1 to this subchapter',begin);if(begin<0||last<begin)return null;
 if(!section.slice(last).includes('shall also be subject to the general rates of duty')||!section.slice(last).includes('shall continue to be subject to antidumping, countervailing, or other duties'))return null;
 const body=section.slice(begin+marker.length,last).replace(/\[\s*Compiler's note: only subdivision(?:s \(vvv\) and \(www\)| \(vvv\)) (?:are|is) now in effect\. \]/g,' ').replace(/Harmonized Tariff Schedule of the United States(?: Revision \d+ \(20\d{2}\)| \(20\d{2}\)(?: Revision \d+)?) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+(?: U\.S\. Notes(?: \(con\.\))?)?/g,' ').replace(/\s+/g,' ').trim();
 if(!['2aaac4c34277ac977b81f2bec73bf2d6b90af1a99f8d73d2a85ce17df6363c18','aa2aed80702e21f600eecee8ab8fa31061ce931b8dfa3c7398afbe122aa02444','ac07fd5be3b7cbda7df4c20ca2d770867c29c5f5da0c6b0010d5f146edde2f73'].includes(createHash('sha256').update(body).digest('hex')))return null;
 const postlude=section.slice(last).replace(/Harmonized Tariff Schedule of the United States(?: Revision \d+ \(20\d{2}\)| \(20\d{2}\)(?: Revision \d+)?) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+(?: U\.S\. Notes(?: \(con\.\))?)?/g,' ').replace(/\b(?:10|25) percent\b/g,'RATE percent').replace(/\s+/g,' ').trim();if(createHash('sha256').update(postlude).digest('hex')!=='8f7bf735f7c04594c10c32ab09a41eaf39e2c8fe2491306f96b49a81c4e9354d')return null;
 const items=[...body.matchAll(/(?:^| )(\d{1,2})\. ([\s\S]*?)(?= \d{1,2}\. |$)/g)];if(items.length!==11||items.some((m,i)=>Number(m[1])!==i+1))return null;
 const hts8:string[]=[],excludedHts10:string[]=[],blockedHts8:string[]=[];
 for(const item of items){const codes=item[2].match(/\d{4}\.\d{2}\.\d{4}|\d{4}\.\d{2}\.\d{2}/g)??[],family=codes[0]?.replaceAll('.',''),except=codes.slice(1).map(c=>c.replaceAll('.',''));if(!family||family.length!==8||!except.length||except.some(c=>!c.startsWith(family)))return null;if(except.some(c=>c.length!==10)){blockedHts8.push(family);continue;}hts8.push(family);excludedHts10.push(...except);}
 return{rate:intro[1]+'%',hts8,excludedHts10,blockedHts8,exclusions:[...new Set(section.slice(0,begin).match(/9903\.88\.\d{2}/g)??[])].filter(h=>h!=='9903.88.04')};
}
/** A legacy date-only contract cannot gain cutoff support from a timestamp
 * alone. This narrow path admits the new treatment only after its original
 * action proves 00:01 Eastern; preceding-minute/transit treatment stays separate. */
export function historicalChangeTimeResolved(contract:HistoricalContract,entry:{hts:string;origin:string;date:string;shipment?:{entryTimestamp?:string}}){
 if(entry.origin!=='CN')return true;
 const scoped=contract.measures.filter(m=>historicalMeasureCovers(m,entry.hts));
 return scoped.filter(m=>entry.date===m.legalEffectiveOn||entry.date===m.legalBefore).every(m=>{
  const next=entry.date===m.legalEffectiveOn?m:scoped.find(n=>n.heading===m.heading&&n.legalEffectiveOn===entry.date);
  return next?.legalCutoff==='00:01'&&atEasternCutoff(entry.shipment?.entryTimestamp,entry.date,next.legalCutoff)===true;
 });
}
export async function historicalOriginalText(bytes:Buffer){
 if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))){if(bytes.length>2500000)throw Error('Historical official text exceeds byte limit');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<html/i.test(text))throw Error('Historical action contains an unexpected HTML page');return text.replace(/\s+/g,' ');}
 const doc=await getDocumentProxy(new Uint8Array(bytes));try{if(doc.numPages>700)throw Error('Historical legal source exceeds page limit.');
 let text='';for(let page=1;page<=doc.numPages;page++){const content=await(await doc.getPage(page)).getTextContent();if(content.items.length>12000)throw Error('Historical legal page exceeds its item bound.');text+=content.items.flatMap(i=>'str'in i?[i.str]:[]).join(' ')+' ';if(text.length>2500000)throw Error('Historical legal source exceeds text limit.');}return text.replace(/\s+/g,' ');
 }finally{await doc.loadingTask.destroy();}
}
type Action={id:string;documentNumber:string;text:string};
/** Ordinary declared-fact estimates. Coverage intervals describe validated
 * reference editions, never newly inferred legal effective/expiration dates. */
export function proveHistoricalTextContract(input:{release:string;from:string;before:string;noteId:string;notes:string;actions:Action[]}):HistoricalContract|null{
 if(!/^20(?:1[89]|2[0-6])(?:HTS|BasicEdition)/.test(input.release)||input.before>"2027-01-01"||input.before<=input.from)return null;
 const notes=input.notes.replace(/\s+/g,' '),measures:HistoricalMeasure[]=[],describedScope:string[]=[],blockedHts8:string[]=[];let eligible=0;
 if(input.from<'2018-07-06'&&input.before<='2018-07-06')return {compiler:'historical-301-reference-v2',coverageFrom:input.from,coverageBefore:input.before,noteSourceId:input.noteId,measures:[],completeScope:true,describedScope:[]};
 const configurations=[
  {heading:'9903.88.01',clause:'a',list:'b',next:'c',minimum:100,actions:['2018-13248'],date:'2018-07-06',rate:'25%',dateText:/July 6,? 2018/},
  {heading:'9903.88.02',clause:'c',list:'d',next:'e',minimum:100,actions:['2018-17709'],date:'2018-08-23',rate:'25%',dateText:/August 23,? 2018/},
  {heading:'9903.88.03',clause:'e',list:'f',next:'g',minimum:1000,actions:['2018-20610'],date:'2018-09-24',before:'2019-05-10',rate:'10%',dateText:/September 24,? 2018/},
  {heading:'9903.88.03',clause:'e',list:'f',next:'g',minimum:1000,actions:['2018-20610','2019-09681'],date:'2019-05-10',rate:'25%',dateText:/May 10,? 2019/},
  {heading:'9903.88.04',clause:'g',list:'g',next:'h',minimum:11,actions:['2018-20610'],date:'2018-09-24',before:'2019-05-10',rate:'10%',dateText:/September 24,? 2018/},
  {heading:'9903.88.04',clause:'g',list:'g',next:'h',minimum:11,actions:['2018-20610','2019-09681'],date:'2019-05-10',rate:'25%',dateText:/May 10,? 2019/},
  {heading:'9903.88.15',clause:'r',list:'s',next:'t',minimum:1000,actions:['2019-17865','2019-18838'],date:'2019-09-01',before:'2020-02-14',rate:'15%',dateText:/September 1,? 2019/},
  {heading:'9903.88.15',clause:'r',list:'s',next:'t',minimum:1000,actions:['2019-17865','2019-18838','2020-00904'],date:'2020-02-14',rate:'7.5%',dateText:/February 14,? 2020/},
 ];
 for(const c of configurations){
  if(input.before<=c.date||(c.before&&input.from>=c.before))continue;eligible++; // Transition/in-transit treatment needs its own contract.
  const actions=c.actions.map(n=>input.actions.find(a=>a.documentNumber===n));if(actions.some(a=>!a))continue;
  const last=actions.at(-1)!;if(!c.dateText.test(last.text)||!last.text.includes(c.rate.replace('%',' percent'))||!actions.some(a=>a!.text.includes(c.heading)))continue;
  if(c.list==='g'){const scope=china20gScope(notes);if(scope?.rate===c.rate){blockedHts8.push(...scope.blockedHts8);measures.push({heading:c.heading,rate:c.rate,legalEffectiveOn:c.date,...(guidanceEntryCutoff(last,c.date)==='00:01'?{legalCutoff:'00:01' as const}:{}),...(c.before?{legalBefore:c.before}:{}),hts8:scope.hts8,excludedHts10:scope.excludedHts10,exclusions:scope.exclusions,actionSourceIds:actions.map(a=>a!.id)});}continue;}
  const begin=notes.indexOf(`(${c.clause}) For the purposes of heading ${c.heading}`);if(begin<0)continue;
  const suffix=notes.slice(begin),m=new RegExp(`\\(${c.list}\\)\\s+(?:The|For|Products|Heading|\\(i\\))`).exec(suffix);if(!m)continue;
  const clause=suffix.slice(0,m.index),normalizedClause=clause.replace(/Harmonized Tariff Schedule of the United States(?: Revision \d+ \(20\d{2}\)| \(20\d{2}\)(?: Revision \d+)?) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+(?: U\.S\. Notes(?: \(con\.\))?)?/g,' ').replace(/\s+/g,' ').trim();
  // Complete dated unconditional clauses, before their exclusion language was
  // introduced. These hashes identify parser contracts, never legal approval.
  const originalClause=input.before<='2020-01-01'&&['75ce2fd3cb0efdde90f050bfb4c029b14437b46daf7c46466ec09c099b979c5c','21a9fb2dcb0580deeb1091f06c21c8f5ac7037f767722bb0b8a0d2e56de38806','f943648bc744c1dca3d7d63aaf06060a939ee2d2b1bdcf2eba5fcea6ba31ca4d','3ea82d812620bd962a4a309e58abb6ed58d8e31bbef7b8f4783eb98e58513883'].includes(createHash('sha256').update(normalizedClause).digest('hex'));
  const initial=originalClause||input.before<='2018-09-24'&&['9903.88.01','9903.88.02'].includes(c.heading)&&clause.includes(`All products of China that are classified in the subheadings enumerated in U.S. note 20(${c.list}) to subchapter III are subject to the additional 25 percent ad valorem rate of duty imposed by heading ${c.heading}`);
  if(!clause.includes('products of China')||!clause.includes(`additional ${c.rate.replace('%',' percent')} ad valorem`)||(!initial&&!clause.includes('exclusion')&&!clause.includes('except as provided'))||!clause.includes('shall also be subject to the general rates of duty'))continue;
  const listTail=notes.slice(begin+m.index+3),end=new RegExp(`\\(${c.next}\\)\\s+(?:The|For|Products|Heading)`).exec(listTail)??(initial?/Rates of Duty Unit of Quantity Article Description Stat\. Suf- fix Heading\/ Subheading 2 1 Special General/.exec(listTail):null);if(!end)continue;
  let list=listTail.slice(0,end.index);if(list.length>200000)continue;
  if(initial){
   const intro=`Heading ${c.heading} applies to all products of China that are classified in the following 8-digit subheadings:`;if(!list.trimStart().startsWith(intro))continue;
   list=list.trimStart().slice(intro.length).replace(/\[Compiler's note: (?:list of subheadings may begin on following page(?:; read numbers from left to right)?|product list may begin on the following page; read numbers from left to right)\]/g,' ').replace(/Harmonized Tariff Schedule of the United States(?: Revision \d+ \(20\d{2}\)| \(20\d{2}\)(?: Revision \d+)?) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+(?: U\.S\. Notes(?: \(con\.\))?)?/g,' ').trim();
   const cells=list.match(/\d{4}\.\d{2}\.\d{2}/g)??[];if(list.replace(/\d{4}\.\d{2}\.\d{2}/g,'').trim()||new Set(cells).size!==cells.length)continue;
   // A syntactically clean list can still have lost one cell or a whole page.
   // Require the complete observed original sequence, not a minimum row count.
   // These identify extraction contracts only; action/effective-date checks and
   // shipment qualifications remain independent.
   const originalLists:Record<string,string[]>={
    '9903.88.01':['7a4a2e6419a71283d4b6654dabd8ae2a35dfd745341a96d581d2b284ed33e095'],
    '9903.88.02':['6bc57b8ceb5ab3e4e912c44a51033c9deb4f59d613fb11f088d77a27f25ce9cb'],
    '9903.88.03':['472172572faacf7d496ce5e50653e749b7e53726f6cc306f870d71e308391906','30c6963d9c8bd7d5748c10d0537292b4d295fc95d0169ae3a63e5cbc275ab3cf']
   };
   if(!originalLists[c.heading]?.includes(createHash('sha256').update(cells.map(code=>code.replaceAll('.','')).join('\n')).digest('hex')))continue;
  }
  // 20(s)(ii) describes products; a mentioned code cannot establish blanket scope.
  if(c.list==='s'){const ii=/\(ii\)\s/.exec(list);if(!ii)continue;describedScope.push(...(list.slice(ii.index).match(/\d{4}\.\d{2}\.\d{2}(?:\d{2})?/g)??[]).map(c=>c.replaceAll('.','')));list=list.slice(0,ii.index);}
  // PDF table extraction can concatenate adjacent cells without whitespace.
  // The fixed dotted statistical format still gives unambiguous cell widths.
  const codes=[...new Set(list.match(/\d{4}\.\d{2}\.\d{2}/g)??[])];if(codes.length<c.minimum)continue;
  measures.push({heading:c.heading,rate:c.rate,legalEffectiveOn:c.date,...(guidanceEntryCutoff(last,c.date)==='00:01'?{legalCutoff:'00:01' as const}:{}),...(c.before?{legalBefore:c.before}:{}),hts8:codes.map(code=>code.replaceAll('.','')),exclusions:[...new Set(clause.match(/9903\.\d{2}\.\d{2}/g)??[])].filter(h=>h!==c.heading),actionSourceIds:actions.map(a=>a!.id)});
 }
 return measures.length?{compiler:'historical-301-reference-v2',coverageFrom:input.from,coverageBefore:input.before,noteSourceId:input.noteId,measures,chinaOnlyHeadings:[...new Set(measures.flatMap(m=>[m.heading,...m.exclusions]))],completeScope:eligible>0&&eligible===measures.length,describedScope:[...new Set(describedScope)],...(blockedHts8.length?{blockedHts8:[...new Set(blockedHts8)]}:{})}:null;
}
