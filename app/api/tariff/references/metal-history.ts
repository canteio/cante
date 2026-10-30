import{resolveHistoricalWood,type HistoricalWood}from'./wood-history';
import {originalReciprocalTable} from './program-scope';
import {createHash} from 'node:crypto';
import {baseBelowThreshold,type EquivalentInput} from './combined-heading';
import type {ReferenceRate} from './store';
import {guidanceEntryCutoff,type CbpGuidance,type CbpRuling} from './cbp-guidance';
import {atEasternCutoff,metalRemainderBases} from '@/app/api/audits/shipment';
import type {Chapter99Action} from './chapter99-contract';
import type {ShipmentDetails} from '@/app/api/audits/shipment';
import type {BundleDefinition,FactValue} from '@/app/api/audits/model';

type RemainderBasis=keyof typeof metalRemainderBases;
type MetalResolution={wood?:ReturnType<typeof resolveHistoricalWood>;measures:Measure[];requiredFacts:string[];replacesBase:boolean;exemptsOverlaps:boolean;issues:string[];reciprocalMode?:'exempt'|RemainderBasis;section122Mode?:'exempt'|RemainderBasis;borderExempt?:boolean;indiaMode?:'exempt'|RemainderBasis};
type Measure=Pick<BundleDefinition['measures'][number],'id'|'label'|'rate'|'basis'|'conditions'|'quantityBasis'>;
export type HistoricalMetals={wood?:HistoricalWood;compiler:'historical-metals-v1'|'historical-metals-2025-v1'|'historical-metals-2025-v2'|'historical-metals-2025-v3'|'historical-metals-2025-v4'|'historical-metals-2025-v5'|'historical-metals-2025-v6'|'historical-metals-april2026-v1';earlier?:EarlierScope;transition?:{cutoffSourceId:string;zeroContentProof?:string};hts:string;from:string;before:string;lists:string[];rows:{heading:string;rate:string}[];sourceIds:string[];overlapExemptions:{section122:boolean;country301:boolean}};
// Reviewed compiler contracts against the retained consolidated text, not legal
// approval. Every operative paragraph must match; lists are parsed separately.
// A changed paragraph withholds support rather than silently extending a rule.
const contracts={a:'9f3b165a9caa00114f53c375f9cb28ae752b0a3dfd94c9323d7a8e1816d94048',b:'a60c3431a1a7bdccdfcc82c2dd307548852c963327058a5d1056b6002eb0f11b',c:'44d7b6886e8a2d3456b57d704177fefc7fb80ecbd7621f917e7b8ec860355eed',d:'a9902db7d83dfb9044fee16fe036432d9e1e1a10a8e87cf0a3d911bb349bde84',e:'54805a3182a254b4ff769d614b9a8c569d54a01fbaba2a998a1b85fff09faf97',f:'0844af29ea72e8b742071cfc3f5e33ae35be44a2ee76bd84e22702de82c4d243',g:'29a13cdf1767ca05cbcbd8fc278fcc1d4cba00a1a85d23006bcdeb5a6ed1dc4b',j:'bf98cea588b613becd81766af07ef3f06b174ca0627bf0936abb28f8b989c25c',k:'1e27e5dba28c9981bda9bf0977fde77d1d1d84b15396b9d97750195bb4437f07'};
const listNames=['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi'];
const clean=(s:string)=>s.replace(/Harmonized Tariff Schedule of the United States Revision \d+ \(2026\) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+ U\.S\. Notes \(con\.\)/g,' ').replace(/\s+/g,' ').trim();
const aprilContracts:Record<string,string[]>={
 a:['a2d63e914cc908ba0f4a19b8e1b48a67997b7a5a61a2fb12c5ca94ef83eaf5fa','af79c0ec08722e7d5230a404440ae11817231b1a1efe0216ac5ee2e0adeb05eb','e152b97f15307ece933fad85af4f8c1ebe8e1b6616cc7a3d8763129c9003f5b7'],
 b:['dd8a270ec3c08a5f4f2d2685928081adec980c3ac68e27b1cb22ff9888be2edd','c8e7e7b83892b1ddd4d23b4a9002928aae7d8bf7d041e57f4964d9930988fb73'],
 c:['60a936890893e30ff1e9e14feb0d21ba67cf6576a31e517b6f2b84426d160937','e2f45b58fd26f5b7a24e32266d8337f34e73c8659bfef2dbd6a2856c6111c9e2'],
 d:[contracts.d],e:['5df519eab16ebde979ce995757638a2df61c43ed4fc9d9dfcd8521ec19d6f774','b5d8cbd37d44538c06d30164ac4e4d7323cb5538b5d75f8c0608cd7b5a401234'],
 f:['608f933f40e4f3443f7f6acac733bbdff26a7ca03ee16a9b3f04839e650ea2aa'],g:['2454d55e7c277caddf2266a408e43231ed5fb69539a2a7e49254650a1c16d05a'],
 h:['f6a61fc1887089c968592a516267e4f22bfa0deded7a62ec9dc79a19858bff65'],i:['c909b178ac6e136afd14671f6931d4f6c84f89bba6e99e508b774c94be6fea83'],
};
export function historicalMetalLists(notes:string,period:'june2026'|'april2026'='june2026'){
 const text=clean(notes),start=/(?:^| )16\. \(a\)/.exec(text);if(!start)return null;const tail=text.slice(start.index),end=/\b17\. \(a\)/.exec(tail);if(!end||end.index>100000)return null;const note=tail.slice(0,end.index).trim();
 const markers:Record<string,string>={a:'(a) Except',b:'(b) For imported',c:'(c) Headings',d:'(d) Headings',e:'(e) Headings',f:'(f) Except',g:'(g) Heading',h:'(h) Heading',i:'(i) Heading',j:'(j) Headings',k:'(k) Except'};
 const april=period==='april2026',keys=april?['a','b','c','d','e','f','g',...(note.includes('(h) Heading')?['h','i']:[])]:Object.keys(markers),positions=Object.fromEntries(keys.map(k=>[k,note.indexOf(markers[k])]));if(Object.values(positions).some(p=>p<0))return null;
 const next:Record<string,string>={a:'b',b:'c',c:'list',d:'e',e:'f',f:'g',g:'h',j:'k'};
 const accepted=april?Object.fromEntries(keys.map(k=>[k,aprilContracts[k]])):Object.fromEntries(Object.entries(contracts).map(([k,v])=>[k,[v]]));
 if(april){next.h='i';next.i='end';next.g=positions.h===undefined?'end':'h';}
 for(const [key,hashes]of Object.entries(accepted)){const before=next[key]==='list'?note.indexOf('(i) Articles'):next[key]&&next[key]!=='end'?positions[next[key]]:note.length;const paragraph=clean(note.slice(positions[key],before));if(!hashes.includes(createHash('sha256').update(paragraph).digest('hex')))return null;}
 const lists:Record<string,string[]>={};
 const names=april?listNames.slice(0,10):listNames;
 for(const [i,key]of names.entries()){
  const title=`(${key}) ${['i','iii','v','viii'].includes(key)?'Articles':'Derivative'}`,begin=note.indexOf(title),before=i===names.length-1?positions.d:note.indexOf(`(${names[i+1]}) ${['iii','v','viii'].includes(names[i+1])?'Articles':'Derivative'}`,begin+title.length);if(begin<0||before<=begin)return null;
  const part=note.slice(begin,before).replace(/\[Compiler['’]s? note:[^\]]*\]/gi,' '),colon=part.indexOf(':'),body=part.slice(colon+1).trim(),codes=body.split(/\s+/);
  if(colon<0||!codes.length||codes.length>2000||codes.some(c=>!/^\d{4}(?:\.\d{2}(?:\.\d{2}(?:\d{2})?)?)?$/.test(c)||Number(c.slice(0,2))>=98)||new Set(codes).size!==codes.length)return null;
  lists[key]=codes.map(c=>c.replaceAll('.',''));
 }
 return lists;
}
export function historicalMetals(input:{hts:string;origin?:string;from:string;before:string;notes:string;noteId:string;rows:ReferenceRate[];guidance:CbpGuidance[];actions?:Chapter99Action[];rulings?:CbpRuling[];section122Amendment?:{noteId:string;notes:string}}):HistoricalMetals|null{
 if(input.from<'2026-04-06')return earlierMetals(input);
 const april=input.from<'2026-06-08';
 const lists=historicalMetalLists(input.notes,april?'april2026':'june2026');if(!lists)return null;
 const source=input.guidance.find(g=>april?g.number==='68253075'&&guidanceEntryCutoff(g,'2026-04-06')==='00:01'&&g.text.includes('at least 95 percent')&&g.text.includes('9903.82.17'):g.number==='68855869'&&g.text.includes('June 8, 2026')&&g.text.includes('9903.82.20')&&g.text.includes('85 percent'));if(!source)return null;
 const zero=input.guidance.find(g=>g.number==='68554727'&&guidanceEntryCutoff(g,'2026-04-06')==='00:01'&&/9903\.82\.0\s?1:/.test(g.text)&&g.text.includes('0% additional ad valorem rate of duty')&&g.text.includes('do not contain any aluminum, steel, or copper'));
 const metalRows=input.rows.filter(r=>/^990382\d{2}$/.test(r.hts));
 if(Array.from({length:april?16:26},(_,i)=>String(i+(april?2:1)).padStart(2,'0')).some(n=>metalRows.filter(r=>r.hts==='990382'+n).length!==1))return null;
 const named=Object.entries(lists).filter(([,codes])=>codes.some(c=>input.hts.startsWith(c))).map(([key])=>key);
 const normalized=clean(input.notes),exempt=(heading:string)=>new RegExp(`As provided in heading ${heading.replaceAll('.','\\.')}, the additional dut(?:y|ies) imposed by headings? 9903\\.(?:03\\.01|05\\.20–9903\\.05\\.84) shall not apply to:[^;]{0,650}articles of aluminum, of steel,? (?:or )?of copper[^;]{0,180}9903\\.82\\.02 and 9903\\.82\\.04–9903\\.82\\.${april?'(?:17|19)':'26'}`).test(normalized);
 const rows=metalRows.map(r=>({heading:`${r.hts.slice(0,4)}.${r.hts.slice(4,6)}.${r.hts.slice(6)}`,rate:r.general.trim()}));
 // The original technical correction explicitly creates this zero-content
 // heading retroactively. It does not change the edition's commodity rate/list.
 if(april&&zero&&!rows.some(r=>r.heading==='9903.82.01'))rows.push({heading:'9903.82.01',rate:'No change'});
 return{compiler:april?'historical-metals-april2026-v1':'historical-metals-v1',...(april?{transition:{cutoffSourceId:source.id,...(zero?{zeroContentProof:zero.id}:{})}}:{}),hts:input.hts,from:input.from,before:april&&input.before>'2026-06-08'?'2026-06-08':input.before,lists:named,rows,sourceIds:[input.noteId,source.id,...(april&&zero?[zero.id]:[])],overlapExemptions:{section122:exempt('9903.03.06'),country301:exempt('9903.05.90')}};
}
export function resolveHistoricalMetals(scope:HistoricalMetals,input:{hts:string;date:string;origin:string;baseRate:string;baseInput:EquivalentInput;shipment?:ShipmentDetails;facts:Record<string,FactValue|undefined>}):MetalResolution{
 const metal=resolveConsolidatedMetals(scope,input);if(!scope.wood)return metal;
 const wood=resolveHistoricalWood(scope.wood,input);if(metal.measures.length&&wood.measures.length)return{...metal,wood,issues:[...metal.issues,'Concurrent wood and metal Section232 treatment needs explicit cross-sector coverage.']};
 return{...metal,wood,measures:[...metal.measures,...wood.measures],requiredFacts:[...metal.requiredFacts,...wood.requiredFacts],replacesBase:metal.replacesBase||wood.replacesBase,issues:[...metal.issues,...wood.issues],...(wood.active?{reciprocalMode:wood.overlaps.reciprocal?'exempt' as const:undefined,borderExempt:wood.overlaps.border,indiaMode:wood.overlaps.india?'exempt' as const:undefined,exemptsOverlaps:true}:{})};
}
/** Only branches established by explicit shipment facts execute. No network or
 * model calls. Values and compound rates use the shared exact audit engine. */
function resolveConsolidatedMetals(scope:HistoricalMetals,input:{hts:string;date:string;origin:string;baseRate:string;baseInput:EquivalentInput;shipment?:ShipmentDetails;facts:Record<string,FactValue|undefined>}):MetalResolution{
 if(scope.earlier)return resolveEarlierMetals(scope,input);
 const out:MetalResolution={measures:[],requiredFacts:[],replacesBase:false,exemptsOverlaps:false,issues:[]};
 if(scope.transition&&input.date==='2026-04-06'&&atEasternCutoff(input.shipment?.entryTimestamp,'2026-04-06','00:01')!==true){out.issues.push('The April 6 metal change requires an actual entry timestamp at or after the published 12:01 a.m. Eastern cutoff.');return out;}
 if(input.date==='2026-06-08'&&(!input.shipment?.entryTimestamp||Date.parse(input.shipment.entryTimestamp)<Date.parse('2026-06-08T00:01:00-04:00'))){out.issues.push('The June 8 change needs an entry timestamp at or after 12:01 a.m. U.S. Eastern time. Earlier entries need the preceding dated rule.');return out;}
 if(scope.hts!==input.hts||input.date<scope.from||input.date>=scope.before){out.issues.push('The metal scope does not cover this exact code and date.');return out;}
 if(!scope.lists.length)return out;
 const {facts}=input,lists=scope.lists,groups=new Set(lists.map(k=>['i','ii','iii','iv','v'].includes(k)?'basic':['vi','vii','viii'].includes(k)?'derivative':['ix','x'].includes(k)?'combined':'mobile'));
 const need=(key:string)=>{if(typeof facts[key]!=='boolean'){out.issues.push('Confirm '+key.replaceAll('_',' ')+' with dated evidence.');return false;}if(facts[key]===true)out.requiredFacts.push(key);return true;};
 if(['RU','BY','CU','KP'].includes(input.origin)){out.issues.push('Column 2 / Russian metal treatment needs its separately dated scope.');return out;}
 if(lists.some(k=>['i','ii','vi','ix'].includes(k))&&(!need('russian_aluminum_clear')||facts.russian_aluminum_clear!==true)){out.issues.push('Russian primary aluminum smelt/cast treatment must be resolved.');return out;}
 const add=(heading:string,basis:Measure['basis']='customs_value',combined=false)=>{
  const row=scope.rows.find(r=>r.heading===heading);let rate:string|undefined;
  if(row){if(/^No change$/i.test(row.rate))rate='Free';else if(combined&&/^\d+(?:\.\d+)?%$/.test(row.rate))rate=row.rate;else{const m=/^The duty provided in the applicable subheading (?:\+|plus) (?:a duty of )?(\d+(?:\.\d+)?)%$/.exec(row.rate);if(m)rate=m[1]+'%';}}
  if(!rate){out.issues.push('The published metal rate '+heading+' is missing or changed.');return;}
  out.measures.push({id:heading,label:'Historical Section 232 metal duty',rate,basis,conditions:{}});
 };
 if(!['72','73','74','76'].includes(input.hts.slice(0,2))){
  if(!need('metal_weight_verified')||facts.metal_weight_verified!==true||input.shipment?.metalWeightPercent===undefined){out.issues.push('Supply the aggregate applicable-metal weight percentage and its evidence.');return out;}
  const weight=input.shipment.metalWeightPercent;
  if(facts.no_metal_content===true&&Number(weight)>0){out.issues.push('No-metal evidence conflicts with the positive applicable-metal weight.');return out;}
  if(Number(weight)<15){
   if(Number(weight)===0&&!need('no_metal_content'))return out;
   const none=Number(weight)===0&&facts.no_metal_content===true;
   if(none&&scope.transition&&!scope.transition.zeroContentProof){out.issues.push('Zero-metal treatment requires the original retroactive technical correction.');return out;}
   add(none?'9903.82.01':'9903.82.03');return out;
  }
 }
 if(groups.size>1){out.issues.push('Multiple metal lists have different treatments; the product scope needs a dated evidence decision.');return out;}
 if(!need('metal_special_claim')||facts.metal_special_claim!==false){out.issues.push('A quota or other special metal claim requires its own dated coverage.');return out;}
 const derivative=lists.some(k=>['ii','iv','vi','vii','viii','ix','x','xi'].includes(k)),ukEligible=lists.some(k=>['i','ii','iii','iv','vi','vii'].includes(k));
 if(derivative&&!need('us_metal_qualified'))return out;
 if(input.origin==='GB'&&ukEligible&&!need('uk_metal_qualified'))return out;
 if(facts.us_metal_qualified&&facts.uk_metal_qualified){out.issues.push('U.S. and UK cumulative metal qualification facts conflict.');return out;}
 let equipment=false;
 if(lists.some(k=>['vi','vii','viii','xi'].includes(k))&&['84','85','87'].includes(input.hts.slice(0,2))){
  if(!need('motorcycle_use'))return out;if(facts.motorcycle_use===true){add('9903.82.13');out.exemptsOverlaps=true;return out;}
  if(!scope.transition&&!lists.includes('xi')){if(!need('equipment_use'))return out;equipment=facts.equipment_use===true;}
 }
 if(lists.includes('xi')){out.issues.push('Mobile equipment needs the dated country/content and overlapping-duty treatment; the general derivative rate is not a substitute.');return out;}
 const combined=equipment||lists.some(k=>['ix','x'].includes(k));
 if(combined){const us=facts.us_metal_qualified===true,threshold=us?'10%':'15%',below=baseBelowThreshold(input.baseRate,threshold,input.baseInput);if(below===null){out.issues.push('The combined metal rate needs the exact base-duty equivalent and shipment quantity.');return out;}const heading=equipment?(us?(below?'9903.82.23':'9903.82.24'):(below?'9903.82.25':'9903.82.26')):(us?(below?'9903.82.07':'9903.82.08'):(below?'9903.82.10':'9903.82.11'));add(heading,'customs_value',below);out.replacesBase=below;}
 else if(input.origin==='GB'&&ukEligible&&facts.uk_metal_qualified)add(lists.some(k=>['i','ii','iii','iv'].includes(k))?'9903.82.04':'9903.82.05');
 else if(derivative&&facts.us_metal_qualified)add('9903.82.06');
 else add(lists.some(k=>['i','ii','iii','iv','v'].includes(k))?'9903.82.02':'9903.82.09');
 out.exemptsOverlaps=true;return out;
}

// Earlier consolidated notes retain superseded paragraphs. Bind exact operative
// paragraphs and complete code tables, rather than every code mentioned nearby.
// These are compiler contracts, not independent legal approvals.
type EarlierMetal={metal:'steel'|'aluminum'|'copper';kind:'primary'|'existing'|'chapter'|'other';heading:string;described:boolean;description?:string;usException:boolean;from:string};
type EarlierScope={stacking?:'border_first'|'metal_first';members:EarlierMetal[];increased:boolean;cutoffs:{date:string;time:'00:01';sourceId:string}[];reciprocalProof:boolean;section122Proof?:string;usProof?:{initial?:boolean;reciprocal:'whole'|'content';sourceIds:string[];section122:boolean};indiaProof?:{sourceIds:string[];headings:string[]};copper?:{listed:boolean;sourceIds:string[];issues:string[];cutoffSourceId?:string;fullValueProof?:string}};
const earlierClean=(s:string)=>s.replace(/Harmonized Tariff Schedule of the United States(?: Revision \d+ \(20\d{2}\)| \(20\d{2}\) Revision \d+| \(20\d{2}\)) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+ U\.S\. Notes \(con\.\)/g,' ').replace(/\s+/g,' ').trim();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Complete initial Note 36 scope, not every copper code mentioned in the PDF.
 * The four operative introductions retain their dated agreement exceptions. */
export function earlierCopperList(notes:string){
 const text=earlierClean(notes),start=text.indexOf('36. (a)'),last='permit the administration of these headings.';if(start<0)return null;
 const finish=text.indexOf(last,start);if(finish<start||finish-start>12000)return null;const note=text.slice(start,finish+last.length),a=note.indexOf('(a) '),b=note.indexOf('(b) The rates'),c=note.indexOf('(c) Heading'),d=note.indexOf('(d) Any importer');if(!(a<b&&b<c&&c<d))return null;
 const intro=note.slice(a,b).trim(),table=note.slice(b,c).trim(),after=note.slice(c,d).trim(),records=note.slice(d).trim();
 if(!['9715e34c80313121611ba5f36e9e0e0d250825edc58664c0d3208f31db4a2de3','c3d58bf5053bf23ea2dbca51bf7b3e141150ec723fd76250656263ff805e83cc','76f32b17dc4f54a8efd8d87702e78fd7510cdae6f58d40952ec5939029a34f07','775c0e0b6b104476834bb8ca535c09e053723cd3a8d01a1c152edbb78ea6dace'].includes(hash(intro))||hash(table)!=='cfb316a37da183d49c776fb8d6e598c4754f04f4e8acf7803bd187b5e50d2326'||hash(after)!=='d38fc00d9749aa717471443bf6001a879a75fab21fc7de1b7247d1bf12522a9b'||hash(records)!=='0b0fde0350bd37ce21abafb068902b1b54146aa3a2b7dbcdcae77ab4d669ad9b')return null;
 const part=table.replace(/\[\s*Compiler['’]s note:[^\]]*\]/gi,' '),codes=part.slice(part.indexOf(':')+1).trim().split(/\s+/);if(codes.length!==80||new Set(codes).size!==codes.length||codes.some(code=>!/^\d{4}\.\d{2}\.\d{2}$/.test(code)||Number(code.slice(0,2))>=98))return null;
 return codes.map(code=>code.replaceAll('.',''));
}
function earlierCopper(input:Parameters<typeof historicalMetals>[0]):EarlierScope['copper']|null{
 const codes=earlierCopperList(input.notes);if(!codes)return null;const scope:NonNullable<EarlierScope['copper']>={listed:codes.some(code=>input.hts.startsWith(code)),sourceIds:[input.noteId],issues:[]};if(!scope.listed)return scope;
 const original=input.actions?.find(a=>a.documentNumber==='2025-14893'&&guidanceEntryCutoff(a,'2025-08-01')==='00:01'&&hash(a.text.match(/\(1\) Except as otherwise provided[\s\S]*?(?=\(2\))/)?.[0].trim()??'')==='54c7af2b7b98eb2938bdc4093cd53fa4a3f53e393c3d28bb723442a3a6e56990'&&hash(a.text.match(/\(4\) The non-copper content[\s\S]*?(?=\(5\))/)?.[0].trim()??'')==='cc6fde27695b64e55ca062e19c9a3d639d04748c124ef1bcb12f183628fe5b8f'&&hash(a.text.match(/\(5\) If any product[\s\S]*?and not those imposed pursuant to this proclamation\./)?.[0]??'')==='c1dd18c3f1fcc3ef7dafd1af95d1cb46d04ed707e5a12559ae627de21551eebe');
 const guidance=input.guidance.find(g=>g.number==='65794272'&&guidanceEntryCutoff(g,'2025-08-01')==='00:01'&&g.text.includes('50 percent additional ad valorem rate of duty on the copper content')&&g.text.includes('Section 232 duties on copper and copper derivative products are not applicable')&&g.text.includes('0 percent additional ad valorem rate of duty'));
 if(!original||!guidance){scope.issues.push('The original July 2025 copper rate, entry cutoff, allocation or auto-priority instruction is missing or changed. Refresh the historical evidence.');return scope;}
 scope.sourceIds.push(original.id,guidance.id);scope.cutoffSourceId=guidance.id;
 if(guidance.text.includes('If the value of the copper content cannot be determined, then report the duty based on the total entered value')&&guidance.text.includes('When insufficient documentation is provided to substantiate the reported values'))scope.fullValueProof=guidance.id;
 const charged=input.rows.filter(r=>r.hts==='99037801'),uncharged=input.rows.filter(r=>r.hts==='99037802');
 if(charged.length!==1||uncharged.length!==1||!/^The duty provided in the applicable subheading \+ a duty of 50% upon the value of the copper content\.?$/.test(charged[0].general)||!/^The duty provided in the applicable subheading\.?$/.test(uncharged[0].general))scope.issues.push('The exact published copper headings or value-based rate expressions are missing or changed.');
 return scope;
}
/** Exact dated clauses include zero-duty U.S.-metal headings explicitly.
 * A zero amount alone never supplies these program exceptions. */
export function usMetalReciprocalScope(notes:string):'whole'|'content'|null{
 const note=earlierClean(notes),start=note.indexOf('(v) (i)');if(start<0)return null;const part=note.slice(start);const hashes:string[]=[];
 for(const[label,next]of [['vii','viii'],['ix','x']]){const at=part.indexOf('('+label+') The additional duties'),end=part.indexOf('('+next+')',at+3);if(at<0||end<=at||end-at>1500)return null;hashes.push(hash(part.slice(at,end).trim()));}
 const pairs: [string,string][]=[["d1f6b9726c690ee438e6e748af5a9fe3a26930daa5bcb27875267d25163bee87","59a1a707b9648d6b14b0b892a65bd6f1affb8d78ead58d134aa8070d664cf68f"],["2b7f83bffe5d5b7ca2f93297d8f8dd64d25df2e7a262c99ca235366ded9e23d2","d8e22599f2b0fb56c8afed3c07aee3772db2bf43dd84e2b22dd7b64145eb5f1d"],["179a9b8565307fc97bf6a9d64c2cb0758ec3b9a34905ee87abad96f949aeaa7c","5ef613b74875166699d3a9cb1e7157006629781df3775911c8362d0ff2bbb41d"],["efac0ecdf538ab2a98ba019020265be57a15f3d1add156881849c893c7875d29","41986d6060d64818a009fef83e66f554a0dd7efb2148704904f31541c34bdfd5"],["bb9dccfc2a16043cc87f98bfbc62ff6d2eaab7ec885dbd7dca444012d776b618","1e8f9c9dddfd51d273eedb8f958298617056e887d5eb4e69f411423769907e76"],["ae98a9414e6fc4f9ca6b81dc3cc38215723d8e64fc63122117ab7833311c6272","56b537670447653669196e008c976a26c8fd8ddf36b448a78da1e02287847009"]];
 const i=pairs.findIndex(pair=>pair.every((v,j)=>hashes[j]===v));return i<0?null:i<2?'whole':'content';
}
export function usMetalSection122Scope(notes:string){
 const note=earlierClean(notes),start=note.indexOf('(aa)');if(start<0)return false;const part=note.slice(start),at=part.indexOf('(v) As provided in heading 9903.03.06'),end=part.indexOf('(e) passenger',at);return at>=0&&end>at&&hash(part.slice(at,end).trim())==='84fb7aa5a17dd999ef8568398db016bf940ace6fbab8026951e751598ec2ef36';
}
function usMetalProof(input:Parameters<typeof historicalMetals>[0]):EarlierScope['usProof']|undefined{
 const initial=input.from<'2025-04-09'&&input.before>'2025-04-05'?input.actions?.find(a=>!!originalReciprocalTable(a)):undefined;
 const scope=usMetalReciprocalScope(input.notes)??(initial?usMetalReciprocalScope(initial.text):null);if(!scope)return;const sourceIds=[input.noteId];
 let reciprocal=scope;
 if(input.from<'2025-06-04'){
  const original=input.actions?.find(a=>a.documentNumber==='2025-06063'&&hash(a.text.match(/\(vii\) The additional duties[\s\S]*?(?=\(viii\))/)?.[0].trim()??'')==='d1f6b9726c690ee438e6e748af5a9fe3a26930daa5bcb27875267d25163bee87');if(!original||scope!=='whole')return;sourceIds.push(original.id);
 }else{
  const original=input.actions?.find(a=>a.documentNumber==='2025-10524'&&hash(a.text.match(/\(1\) As set forth[\s\S]*?(?=\(2\))/)?.[0].trim()??'')==='fa4ee3c38f77f0c22dacf9546b720df7b541d80d1894574eb480ceab351ec6d6'&&hash(a.text.match(/\(6\) Notwithstanding[\s\S]*?(?=\(7\))/)?.[0].trim()??'')==='672fe0ac2a68cfef0525803536d71662acea2e99e4119542a07bc0f7ff0a402e');if(!original)return;sourceIds.push(original.id);reciprocal='content';
 }
 const amendment=input.section122Amendment,notes=amendment?.notes??input.notes,section122=!!section122OverlapProof(input.actions??[])&&usMetalSection122Scope(notes);if(section122&&amendment)sourceIds.push(amendment.noteId);
 return{...(initial?{initial:true}:{}),reciprocal,sourceIds,section122};
}
export function indiaMetalHeadings(notes:string){
 const note=earlierClean(notes),start=note.indexOf('(z) (i)');if(start<0)return null;
 const part=note.slice(start),contracts=[['iii','iv','57149074bcb1db94b02fb73e744f733c5df7a6864cec2a1fa6d0132974efa30d'],['iv','v','711827b436a5e60c637414f1972ee6a4a36e2f2eefe7285257d31902ff6dba85'],['v','vi','eb44f3168e9201759f152f413aa71eb38bff06488508ab0126bd80075ddc5f3c'],['vi','vii','3b1a799d1c054e6772f819867d02d403e388a3ede8875f45003b529b85247d7e'],['ix','x','d562ace0538d6923a3fd2973a4287c8d172c0cafa283d638141af2f84160986c']];
 for(const[label,next,expected]of contracts){const at=part.indexOf('('+label+') The additional duties'),end=part.indexOf('('+next+')',at+3);if(at<0||end<=at||hash(part.slice(at,end).trim())!==expected)return null;}
 return ['9903.81.87','9903.81.88','9903.81.89','9903.81.90','9903.81.91','9903.81.92','9903.81.93','9903.85.02','9903.85.04','9903.85.07','9903.85.08','9903.85.09','9903.78.01'];
}
/** Original enactment establishes the date/exemption. The later ruling only
 * corroborates content-line allocation; its goods/holding never become ours. */
function indiaMetalProof(input:Parameters<typeof historicalMetals>[0]):EarlierScope['indiaProof']|undefined{
 const original=input.actions?.find(a=>a.documentNumber==='2025-16419'&&guidanceEntryCutoff(a,'2025-08-27')==='00:01'&&hash(a.text.match(/The ad valorem duty provided[\s\S]*?(?=The ad valorem duty imposed)/)?.[0].trim()??'')==='917f720d106a906adf6f25659a5188ee34b1831949d17a2c8eb1b0dfb6fe41fb');
 const ruling=input.rulings?.find(r=>r.number==='N356087'&&r.text.includes('December 9, 2025')&&r.text.includes('For products covered by heading 9903.81.91 this additional duty applies to the non-steel content of the merchandise.')&&r.text.includes('applies only to the specific factual situation'));
 const guidance=input.guidance.find(g=>g.number==='66027027'&&guidanceEntryCutoff(g,'2025-08-27')==='00:01'&&g.text.includes('9903.01.87:')&&g.text.includes('do not apply for such products that are provided for in headings'));
 const stop=input.guidance.find(g=>g.number==='67702087'&&guidanceEntryCutoff(g,'2026-02-07')==='00:01'&&g.text.includes('no longer subject')&&g.text.includes('9903.01.84'));
 const headings=indiaMetalHeadings(input.notes);if(!original||!ruling||!guidance||!stop||!headings)return;
 const heading=input.rows.filter(r=>r.hts==='99030187');if(heading.length!==1||!/^The duty provided in the applicable subheading\.?$/.test(heading[0].general))return;
 return{sourceIds:[input.noteId,original.id,guidance.id,stop.id,ruling.id],headings};
}
function section122OverlapProof(actions:Chapter99Action[]){
 return actions.find(a=>a.documentNumber==='2026-03824'&&guidanceEntryCutoff(a,'2026-02-24')==='00:01'&&a.text.includes('10 percent ad valorem')&&hash(a.text.match(/\(4\) The surcharge imposed[\s\S]*?(?=\(5\))/)?.[0].trim()??'')==='5d98f71fd302fc5d3d682a189a17162032120d0c71836fe358fe4d07a30896df')?.id;
}
/** Subtract only portions actually assessed under Section 232. A full-value
 * duty covers the whole import; unrelated metal is not an exempt portion. */
function remainderBasis(charged:Measure[]):'exempt'|RemainderBasis{
 if(charged.some(m=>m.basis==='customs_value'))return 'exempt';
 const keys=[...new Set(charged.map(m=>({steel_content:'steelValue',aluminum_content:'aluminumValue',copper_content:'copperValue'} as Record<string,string>)[m.basis]).filter(Boolean))].sort();
 const matched=Object.entries(metalRemainderBases).find(([,fields])=>fields.length===keys.length&&[...fields].sort().every((key,i)=>key===keys[i]));
 if(!matched)throw Error('No exact Section 232 content allocation matches the charged measures.');return matched[0] as RemainderBasis;
}
const earlierContracts={
 steelPrimary:['09baa40cf1eb4f50c8786405cb3fd6bedcf0070cc0bd6b3c468dcadd370345df','dc4b2b223730a3b00f470c0de87dc4b468566ce0eab5286045048cf0008a82c5'],
 steelExisting:['d754d197e92b830f9b096cdf4fc78318b18e1b90319ef0e39cf84b3357f64310'],
 aluminumPrimary:['fca1eebfd43f26f5d3b832940ccc08de160cd16245ae71990bb2d595b5c94cc7'],
 aluminumExisting:['c143348d467f2b7ff50cf0124cf272eb6c701736330f78c0fcc1c0030bd9fbe7'],
 steelStack:['aa6f1ff95bc924bebc96213e00b229253dde5bae5da4484ec92b851b43516ef9','b299b93967892cc4d6b3b7489bbea5470c4630446f5c1b79cc8b89bf41ea3869','85f1fb0c4388f5834bc4172f4ba4ebfa6d89cfd7c3a03cb3ed30f50ab484dfda','fffa72bb4cdd06d8a04b32e9cf34b0ceb24eab8b13f3f954361ab1b4485092b9','45254cc7a34d49150d388291207b5c24327f03b7c638f7ac49e67ed12ee21070'],
 aluminumStack:['b6bf7eb2dfdff51d92a86530b56aac77decba2decbfb9e2971a74805f9b5226c','8e476168bff3d1c97e5366e20248a027be1485eea05ab4045342a5793be4fb56','ae4d3cfdbc3cf414fa8b8000aa9070ba285f2a76728ec059b87f72d08f251f4d','b44eb5363b28a284b01681ecd7d751ad296214f7f5a2b5c9c649d4c3eb9072c1','1198b1592577af503a716ebbf1f34150a8060e19c0e6eb50e4910a9546d3bbb4'],
 steelChapter:['d36e82f0ec2e82865625b628596b45cb0867ba41ca697958cd14765ecb07a457'],
 steelOther:['39214246594f9d5c3d0c09cd7c76c2795c24ae781a95a60bfe00766ea6061322','f84b6a6a1cdc2b480acb159998e2a669bcf6ad37e4cccc960c6a91577f6310c8','46cf0eaa432f02264ddc9b2a1c2f7395f28c6b21586b03e7bd56c05968d9c8fd'],
 aluminumChapter:['8bbcf0c76a694dc3c5e647cb7b8d6abeb738cc2efe39bc10c87b9588fd2d5d0b'],
 aluminumOther:['ef394d000a95cce636f58fdc4ab4d30fb2e288b0a77c03e4d5efe5982b4c3d72'],
};
function earlierPart(note:string,label:string,start:string,next:string){const at=note.indexOf(`(${label}) ${start}`);if(at<0)return null;const end=new RegExp(`\\(${next}\\) [A-Z]`).exec(note.slice(at+label.length+3));return end?note.slice(at,at+label.length+3+end.index).trim():null;}
function earlierTables(part:string,allowed:string[]){
 const pattern=/:\s*((?:\d{4}\.\d{2}(?:\.\d{2}(?:\d{2})?)?[;:.]?\s*){2,})/g,blocks=[...part.matchAll(pattern)];if(!blocks.length||!allowed.includes(hash(part.replace(pattern,': <TABLE>'))))return null;
 const result=blocks.map((m,i)=>({from:blocks.length>=2?['2025-03-12','2025-06-23','2025-08-18'][i]:'2025-03-12',codes:m[1].trim().split(/[;:\s]+/).filter(Boolean).map(c=>c.replace(/\.$/,''))}));
 if(result.some(b=>b.codes.length>2000||new Set(b.codes).size!==b.codes.length||b.codes.some(c=>!/^\d{4}\.\d{2}(?:\.\d{2}(?:\d{2})?)?$/.test(c)||Number(c.slice(0,2))>=98)))return null;
 return result.map(b=>({...b,codes:b.codes.map(c=>c.replaceAll('.',''))}));
}
export function earlierMetalLists(notes:string){
 const text=earlierClean(notes),steelStart=text.indexOf('16. (a)'),steelEnd=text.indexOf('17. (a)',steelStart),aluminumStart=text.indexOf('19. (a)'),aluminumEnd=text.indexOf('20. (a)',aluminumStart);if(steelStart<0||steelEnd<steelStart||aluminumStart<0||aluminumEnd<aluminumStart)return null;
 const steel=text.slice(steelStart,steelEnd),aluminum=text.slice(aluminumStart,aluminumEnd);if(steel.length>120000||aluminum.length>120000)return null;
 const sj=earlierPart(steel,'j','The rates','k'),sk=earlierPart(steel,'k',steel.includes('(k) Except')?'Except':'Headings','l'),sl=earlierPart(steel,'l','The rates','m'),sm=earlierPart(steel,'m','The rates','n'),sn=earlierPart(steel,'n','The rates','o');
 const ag=earlierPart(aluminum,'g','The rates','h'),ah=earlierPart(aluminum,'h',aluminum.includes('(h) Except')?'Except':'Headings','i'),ai=earlierPart(aluminum,'i','The rates','j'),aj=earlierPart(aluminum,'j','The rates','k'),ak=earlierPart(aluminum,'k','The rates','l');
 const fixed=[[sj,earlierContracts.steelPrimary],[sk,earlierContracts.steelStack],[sl,earlierContracts.steelExisting],[ag,earlierContracts.aluminumPrimary],[ah,earlierContracts.aluminumStack],[ai,earlierContracts.aluminumExisting]] as const;if(fixed.some(([p,allowed])=>!p||!allowed.includes(hash(p))))return null;
 const steelChapter=sm&&earlierTables(sm,earlierContracts.steelChapter),steelOther=sn&&earlierTables(sn,earlierContracts.steelOther),aluminumChapter=aj&&earlierTables(aj,earlierContracts.aluminumChapter),aluminumOther=ak&&earlierTables(ak,earlierContracts.aluminumOther);if(!steelChapter||!steelOther||!aluminumChapter||!aluminumOther)return null;
 return{steelPrimary:['7206','7207','7208','7209','7210','7211','7212','7213','7214','7215','7216','7217','7218','7219','7220','7221','7222','7223','7224','7225','7226','7227','7228','7229','73011000','730210','73024000',sj!.includes('7302.90;')?'730290':'73029000','7304','7305','7306'],steelExcept:['72166100','72166900','72169100'],steelExisting:['73170030','7317005503','7317005505','7317005507','7317005560','7317005580','7317006560','87081030','87082921'],steelChapter,steelOther,aluminumPrimary:['7601','7604','7605','7606','7607','7608','7609','76169951'],aluminumExisting:['76141050','76149020','76149040','76149050','87081030','87082921'],aluminumChapter,aluminumOther,steelDescription:sl!,aluminumDescription:ai!,aluminumPrimaryDescription:ag!,borderExempt:sk!.includes('shall not be subject to: (1) the additional duties imposed on entries of articles the product of Canada under heading 9903.01.10')&&ah!.includes('shall not be subject to: (1) the additional duties imposed on entries of articles the product of Canada under heading 9903.01.10')};
}
function earlierMetals(input:Parameters<typeof historicalMetals>[0]):HistoricalMetals|null{
 if(input.from<'2025-03-12'||input.from>='2026-04-06')return null;const lists=earlierMetalLists(input.notes);if(!lists)return null;
 const copper=input.from>='2025-08-01'?earlierCopper(input):undefined;if(input.from>='2025-08-01'&&!copper)return null;
 const increased=input.from>='2025-06-04',required=increased?['64384423','64384496','65236374','65236645']:['64384423','64384496'],sources=required.map(n=>input.guidance.find(g=>g.number===n));if(sources.some(s=>!s))return null;
 if(!sources.every(s=>s!.text.includes(increased&&s!.number.startsWith('652')?'June 4, 2025':'March 12, 2025'))||!sources[0]!.text.includes('9903.81.91')||!sources[1]!.text.includes('9903.85.08'))return null;
 if(increased&&(!sources[2]!.text.includes('50 percent duty rate')||!sources[3]!.text.includes('50 percent duty rate')||!sources[2]!.text.includes('non-steel content')||!sources[3]!.text.includes('non-aluminum content')))return null;
 const matches=(codes:string[])=>codes.some(c=>input.hts.startsWith(c)),members:EarlierMetal[]=[];
 for(const metal of ['steel','aluminum'] as const){
  const primary=metal==='steel'?matches(lists.steelPrimary)&&!matches(lists.steelExcept):matches(lists.aluminumPrimary),existing=matches(metal==='steel'?lists.steelExisting:lists.aluminumExisting);
  const groups=metal==='steel'?[lists.steelChapter,lists.steelOther]:[lists.aluminumChapter,lists.aluminumOther];
  if(primary)members.push({metal,kind:'primary',heading:metal==='steel'?'9903.81.87':'9903.85.02',described:metal==='aluminum'&&input.hts.startsWith('76169951'),...(metal==='aluminum'&&input.hts.startsWith('76169951')?{description:lists.aluminumPrimaryDescription}:{}),usException:false,from:'2025-03-12'});
  if(existing)members.push({metal,kind:'existing',heading:metal==='steel'?'9903.81.89':'9903.85.04',described:true,description:metal==='steel'?lists.steelDescription:lists.aluminumDescription,usException:false,from:'2025-03-12'});
  for(const[i,group]of groups.entries())for(const block of group)if(matches(block.codes)&&!(i===0&&existing))members.push({metal,kind:i===0?'chapter':'other',heading:metal==='steel'?(i===0?'9903.81.90':'9903.81.91'):(i===0?'9903.85.07':'9903.85.08'),described:false,usException:true,from:block.from});
 }
 if(copper?.listed)members.push({metal:'copper',kind:'other',heading:'9903.78.01',described:false,usException:false,from:'2025-08-01'});
 const stackSource=input.guidance.find(g=>g.number===(increased?'65236574':'65054270'));
 const stacking=stackSource&&stackSource.text.includes('more than 0% is owed')&&(increased?stackSource.text.includes('June 4, 2025')&&stackSource.text.includes('then the article IS NOT subject to the IEEPA Canada or IEEPA Mexico tariffs'):stackSource.text.includes('March 4, 2025')&&stackSource.text.includes('If so, then the article IS NOT subject to the 232 Aluminum or 232 Steel tariffs'))?(increased?'metal_first' as const:'border_first' as const):undefined;
 const section122Proof=input.before>'2026-02-24'?section122OverlapProof(input.actions??[]):undefined;
 const indiaProof=input.origin==='IN'&&input.from<='2026-02-07'&&input.before>'2025-08-27'?indiaMetalProof(input):undefined;
 const usProof=usMetalProof(input);
 const proofIds=[...(usProof?.sourceIds??[]),input.noteId,...sources.map(s=>s!.id),...(stacking?[stackSource!.id]:[]),...(section122Proof?[section122Proof]:[]),...(indiaProof?.sourceIds??[]),...(copper?.sourceIds??[])];for(const n of ['65441222','65936570','65936615']){const source=input.guidance.find(g=>g.number===n);if(source)proofIds.push(source.id);}
 const reciprocalProof=!increased||sources.slice(2).every(s=>s!.text.includes('is not subject to Reciprocal tariffs under HTS 9903.01.33'));
 return{compiler:usProof?.initial?'historical-metals-2025-v6':'historical-metals-2025-v5',hts:input.hts,from:input.from,before:input.before<'2026-04-06'?input.before:'2026-04-06',lists:[],rows:input.rows.filter(r=>/^9903(?:78|81|85)\d{2}$/.test(r.hts)).map(r=>({heading:`${r.hts.slice(0,4)}.${r.hts.slice(4,6)}.${r.hts.slice(6)}`,rate:r.general.trim().replace(/\.$/,'')})),sourceIds:[...new Set(proofIds)],overlapExemptions:{section122:false,country301:false},earlier:{stacking,members,increased,...(usProof?{usProof}:{}),...(copper?{copper}:{}),cutoffs:input.guidance.flatMap(source=>['2025-03-12','2025-06-04','2025-06-23','2025-08-01','2025-08-18'].flatMap(date=>guidanceEntryCutoff(source,date)==='00:01'?[{date,time:'00:01' as const,sourceId:source.id}]:[])),reciprocalProof,...(section122Proof?{section122Proof}:{}),...(indiaProof?{indiaProof}:{})}};
}
function resolveEarlierMetals(scope:HistoricalMetals,input:Parameters<typeof resolveHistoricalMetals>[1]):MetalResolution{
 const out:MetalResolution={measures:[],requiredFacts:[],replacesBase:false,exemptsOverlaps:false,issues:[]},earlier=scope.earlier!;
 if(scope.hts!==input.hts||input.date<scope.from||input.date>=scope.before){out.issues.push('The earlier metal scope does not cover this exact code and date.');return out;}
 if(input.date>='2025-06-04'&&!earlier.increased){out.issues.push('The retained edition predates the June 4 metal-rate/content amendment.');return out;}
 for(const day of ['2025-04-04','2025-06-23','2025-08-18'])if(input.date>=day&&scope.from<day){out.issues.push('The retained edition predates the '+day+' metal inclusion; its complete dated amendment is needed.');return out;}
 if(input.date>='2025-08-01'&&!earlier.copper){out.issues.push('The complete dated copper scope has not been established.');return out;}
 if(earlier.copper?.issues.length){out.issues.push(...earlier.copper.issues);return out;}
 if(!earlier.members.length)return out;
 const need=(key:string,expected?:boolean)=>{if(typeof input.facts[key]!=='boolean'||expected!==undefined&&input.facts[key]!==expected){out.issues.push('Confirm '+key+' with dated evidence.');return false;}if(input.facts[key]===true)out.requiredFacts.push(key);return true;};
 if(!need('metal_special_claim',false))return out;
 for(const day of ['2025-03-12','2025-06-04',...earlier.members.map(m=>m.from)])if(input.date===day){const clocks=earlier.cutoffs.filter(c=>c.date===day&&c.time==='00:01');if(!clocks.length||atEasternCutoff(input.shipment?.entryTimestamp,day,'00:01')!==true){out.issues.push('The '+day+' metal change requires an actual entry timestamp after the original published cutoff.');return out;}}
 const qualified:Measure[]=[];
 for(const member of earlier.members){
  if(input.date<member.from){out.issues.push('The dated metal inclusion is not active for this entry.');continue;}
  if(member.metal==='copper'){
   if(!need('copper_exceptions_clear',true))continue;
   if(input.facts.copper_full_value_assessment===true){if(!earlier.copper?.fullValueProof){out.issues.push('A copper full-value assessment needs its original published valuation instruction.');continue;}out.requiredFacts.push('copper_full_value_assessment');out.measures.push({id:'9903.78.01',label:'Historical Section 232 copper · documented full-value assessment',rate:'50%',basis:'customs_value',quantityBasis:'copper_content',conditions:{}});continue;}
   if(!need('content_values_verified',true)||input.shipment?.copperValue===undefined){out.issues.push('Supply the evidenced copper content value, or establish that the published full-value assessment applies.');continue;}
   const value=input.shipment.copperValue,zero=/^0+(?:\.0+)?$/.test(value);
   if(!zero)out.measures.push({id:'9903.78.01',label:'Historical Section 232 copper duty',rate:'50%',basis:'copper_content',quantityBasis:'copper_content',conditions:{}});
   if(zero||value!==input.baseInput.value)out.measures.push({id:'9903.78.02',label:zero?'Historical Section 232 · evidenced no-copper content':'Historical Section 232 · non-copper content',rate:'Free',basis:'non_copper_content',conditions:{}});
   continue;
  }

  if(member.kind!=='primary'&&input.facts.aluminum_primary_covered===true&&member.metal==='aluminum'&&earlier.members.some(m=>m.metal==='aluminum'&&m.kind==='primary'))continue;
  if(member.described){const key=member.kind==='primary'?'aluminum_primary_covered':member.metal+'_derivative_covered';if(!need(key))continue;if(input.facts[key]===false)continue;}
  if(member.usException){const key=member.metal==='steel'?'us_steel_melt_pour':'us_aluminum_smelt_cast';if(!need(key))continue;if(input.facts[key]===true&&input.date>='2025-04-05'&&!earlier.usProof){out.issues.push('The exact dated U.S.-metal and overlapping-program clauses are missing or changed.');continue;}}
  if(member.metal==='aluminum'&&input.facts.russian_aluminum_clear!==true&&input.facts.russian_aluminum_subject!==true){out.issues.push('Confirm russian_aluminum_clear or russian_aluminum_subject with dated smelt/cast evidence.');continue;}
  if(member.metal==='aluminum'&&input.facts.us_aluminum_smelt_cast===true&&input.facts.russian_aluminum_subject===true){out.issues.push('U.S. smelt/cast qualification conflicts with positive Russian aluminum treatment.');continue;}
  let heading=member.heading,expected=earlier.increased&&input.origin!=='GB'?'50%':'25%',basis:Measure['basis']=member.kind==='other'||earlier.increased&&input.hts.startsWith(member.metal==='steel'?'73':'76')?(member.metal==='steel'?'steel_content':'aluminum_content'):'customs_value';
  if(member.usException&&input.facts[member.metal==='steel'?'us_steel_melt_pour':'us_aluminum_smelt_cast']===true){heading=member.metal==='steel'?'9903.81.92':'9903.85.09';expected='Free';basis='customs_value';}
  else if(member.metal==='aluminum'&&input.facts.russian_aluminum_subject===true){if(input.facts.russian_aluminum_clear===true){out.issues.push('Russian aluminum clearance and positive Russian treatment conflict.');continue;}heading=member.kind==='primary'?'9903.85.67':'9903.85.68';expected='200%';basis='customs_value';out.requiredFacts.push('russian_aluminum_subject');}
  else if(earlier.increased&&input.origin==='GB'){heading=({ '9903.81.87':'9903.81.94','9903.81.89':'9903.81.96','9903.81.90':'9903.81.97','9903.81.91':'9903.81.98','9903.85.02':'9903.85.12','9903.85.04':'9903.85.13','9903.85.07':'9903.85.14','9903.85.08':'9903.85.15'} as Record<string,string>)[heading];}
  const row=scope.rows.find(r=>r.heading===heading),simple=row?.rate.match(/^The duty provided in the applicable subheading (?:\+|plus) (\d+(?:\.\d+)?)%$/),content=row?.rate.match(/^The duty provided in the applicable subheading \+ a duty of (\d+(?:\.\d+)?)% upon the value of the (steel|aluminum) content$/);
  // A content-valued printed rate is accepted only for that same metal and
  // assessment basis. Changed wording or a full-value basis must not pass.
  const printed=row?.rate==='No change'||['9903.81.92','9903.85.09'].includes(heading)&&row?.rate==='The duty provided in the applicable subheading'?'Free':simple?simple[1]+'%':content&&content[2]===member.metal&&basis===member.metal+'_content'?content[1]+'%':null;
  if(!row||printed!==expected){out.issues.push('The published earlier metal rate '+heading+' is missing or changed.');continue;}
  if(basis!=='customs_value'){if(!need('content_values_verified',true))continue;const value=member.metal==='steel'?input.shipment?.steelValue:input.shipment?.aluminumValue;if(value===undefined){out.issues.push('Supply the explicit '+member.metal+' content value.');continue;}}
  if(expected!=='Free'&&earlier.members.some(m=>m.metal==='steel'&&m.described)&&earlier.members.some(m=>m.metal==='aluminum'&&m.described)&&input.facts.steel_derivative_covered===true&&input.facts.aluminum_derivative_covered===true){basis=member.metal==='steel'?'steel_content':'aluminum_content';if(!need('content_values_verified',true)||input.shipment?.[member.metal==='steel'?'steelValue':'aluminumValue']===undefined){out.issues.push('Both applicable metal components need their separately supported values.');continue;}}
  if(!out.measures.some(m=>m.id===heading))out.measures.push({id:heading,label:'Historical Section 232 '+member.metal+' duty',rate:expected,basis,conditions:{}});if(['9903.81.92','9903.85.09'].includes(heading))qualified.push({id:heading,label:'Evidenced U.S.-'+member.metal+' content',rate:'Free',basis:member.metal==='steel'?'steel_content':'aluminum_content',conditions:{}});
 }
 if(out.issues.length)return out;
 const charged=out.measures.filter(m=>{const value=m.basis==='steel_content'?input.shipment?.steelValue:m.basis==='aluminum_content'?input.shipment?.aluminumValue:m.basis==='copper_content'?input.shipment?.copperValue:input.baseInput.value;if(m.rate!=='Free'&&value==null)out.issues.push('The metal duty needs its explicit assessed value.');return m.rate!=='Free'&&value!=null&&!/^0+(?:\.0+)?$/.test(value);});if(out.issues.length)return out;if(charged.length){
  if(input.origin==='IN'&&input.date>='2025-08-27'&&(input.date<'2026-02-07'||input.date==='2026-02-07'&&atEasternCutoff(input.shipment?.entryTimestamp,'2026-02-07','00:01')===false)){if(!earlier.indiaProof||charged.some(m=>!earlier.indiaProof!.headings.includes(m.id))){out.issues.push('The original dated India exemption, content-line allocation and exact charged metal headings need coverage.');return out;}out.indiaMode=remainderBasis(charged);}
  if(input.date>='2026-02-24'){if(!earlier.section122Proof){out.issues.push('The original dated Section 122/metal allocation clause is missing or changed.');return out;}out.section122Mode=remainderBasis(charged);}
  if(earlier.increased&&!earlier.reciprocalProof){out.issues.push('The original reciprocal/non-metal-content instruction is missing or changed.');return out;}
  out.reciprocalMode=earlier.increased?remainderBasis(charged):'exempt';out.borderExempt=earlier.stacking==='metal_first'&&charged.some(m=>/^9903\.(?:81|85)\./.test(m.id));
  if(['CA','MX'].includes(input.origin)&&input.date<'2026-02-24'&&charged.some(m=>/^9903\.(?:81|85)\./.test(m.id))){
   if(earlier.stacking==='border_first'&&input.facts.border_exceptions_clear===true){out.measures=out.measures.map(m=>({...m,rate:'Free',label:m.label+' · IEEPA border priority exemption'}));out.reciprocalMode=undefined;out.requiredFacts.push('border_exceptions_clear');}
   else if(!out.borderExempt)out.issues.push('The dated Canada/Mexico border and metal priority needs its original instruction and ordinary border-duty scope.');
  }
 }
 if(qualified.length&&input.date>='2025-04-05'){
  if(!earlier.usProof){out.issues.push('The dated zero-duty U.S.-metal program exceptions need their original clauses.');return out;}
  const portions=[...charged,...qualified];
  if(earlier.usProof.reciprocal==='content'||input.date>='2026-02-24'){
   if(!need('content_values_verified',true))return out;
   for(const part of qualified){const value=part.basis==='steel_content'?input.shipment?.steelValue:input.shipment?.aluminumValue;if(value===undefined||/^0+(?:\.0+)?$/.test(value))out.issues.push('Supply a positive, evidenced '+part.basis.replace('_content','')+' content value for the qualified U.S.-metal exception.');}if(out.issues.length)return out;
  }
  out.reciprocalMode=earlier.usProof.reciprocal==='whole'?'exempt':remainderBasis(portions);
  if(input.date>='2026-02-24'){if(!earlier.usProof.section122){out.issues.push('The exact dated Section 122 note must explicitly cover the zero-duty U.S.-metal headings.');return out;}out.section122Mode=remainderBasis(portions);}
  if(input.origin==='IN'&&input.date>='2025-08-27'&&(input.date<'2026-02-07'||input.date==='2026-02-07'&&atEasternCutoff(input.shipment?.entryTimestamp,'2026-02-07','00:01')===false)){
   if(!earlier.indiaProof||qualified.some(m=>!earlier.indiaProof!.headings.includes(m.id))){out.issues.push('The original India exemption must explicitly name the qualified U.S.-metal heading.');return out;}out.indiaMode='exempt';
  }
 }
 out.requiredFacts=[...new Set(out.requiredFacts)];return out;
}
