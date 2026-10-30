import{createHash}from'node:crypto';
import{atEasternCutoff,type ShipmentDetails}from'@/app/api/audits/shipment';
import type{BundleDefinition,FactValue}from'@/app/api/audits/model';
import type{ReferenceRate}from'./store';
import{guidanceEntryCutoff,type CbpGuidance}from'./cbp-guidance';
import type{Chapter99Action}from'./chapter99-contract';
type Measure=Pick<BundleDefinition['measures'][number],'id'|'label'|'rate'|'basis'|'conditions'|'quantityBasis'>;
export type HistoricalWood={compiler:'historical-wood-232-v1';hts:string;origin:string;from:string;before:string;kind:'timber'|'furniture'|'cabinet'|null;rows:{heading:string;rate:string}[];sourceIds:string[];issues:string[];korea?:string;taiwan?:string;overlaps:{reciprocal:string[];border:string[];india:string[];section122:string[];country301:string[]}};
const contracts=new Set(['6db234dd55bee8890a08f1aa74c3b03dd1ee6204dd830696a517c5f1fc9df8d3','2d001aa10069bc54f9c5359f3f133053725ca3fb9ccdd6cdc5a98de925baffcb','2c1c7c0c29ba22c299f70eef1a50705631703ca0aff50bc595d4a62b47b6a2e6']);
const clean=(s:string)=>s.replace(/\s+/g,' ').replace(/Harmonized Tariff Schedule of the United States(?: Revision \d+ \(20\d{2}\)| \(20\d{2}\)(?: Revision \d+)?) Annotated for Statistical Reporting Purposes XXII 99 - III - \d+ U\.S\. Notes(?: \(con\.\))?/g,' ').replace(/\s+/g,' ').trim();
export function extractWoodNote37(raw:string){
 const text=clean(raw),start=/(?<!\d)37\. \(a\) Heading/.exec(text);if(!start)return null;const tail=text.slice(start.index),end=/(?:38\. \(a\)|Harmonized Tariff Schedule of the United States)/.exec(tail),note=(end?tail.slice(0,end.index):tail).trim();
 if(note.length>20000)return null;return{note,sha256:createHash('sha256').update(note).digest('hex')};
}
export function woodNote37(raw:string){
 const captured=extractWoodNote37(raw);if(!captured||!contracts.has(captured.sha256))return null;const{note}=captured;
 const list=(key:string,next:string,length:number,width:number)=>{const begin=note.indexOf('('+key+') '+(key==='f'?'Except':'The rates')),before=note.indexOf('('+next+') ',begin+1);if(begin<0||before<begin)return null;const part=note.slice(begin,before),colon=part.indexOf(':'),codes=part.slice(colon+1).trim().split(/\s+/);return colon>=0&&codes.length===length&&new Set(codes).size===length&&codes.every(c=>new RegExp('^\\d{4}\\.\\d{2}\\.\\d{2}'+(width===10?'\\d{2}':'')+'$').test(c))?codes.map(c=>c.replaceAll('.','')):null;};
 const timber=list('b','c',15,8),furniture=list('d','e',4,10),cabinet=list('f','g',3,10);return timber&&furniture&&cabinet?{note,timber,furniture,cabinet}:null;
}
export function historicalWood(input:{hts:string;origin:string;date:string;from:string;before:string;notes:string;noteId:string;rows:ReferenceRate[];guidance:CbpGuidance[];actions:Chapter99Action[]}):HistoricalWood|null{
 if(input.date<'2025-10-10'||!/^(?:44|9401|9403)/.test(input.hts))return null;
 const scope=woodNote37(input.notes),out:HistoricalWood={compiler:'historical-wood-232-v1',hts:input.hts,origin:input.origin,from:input.from,before:input.before,kind:null,rows:[],sourceIds:[input.noteId],issues:[],overlaps:{reciprocal:[],border:[],india:[],section122:[],country301:[]}};
 if(!scope){out.issues.push('The complete dated wood Note37 is missing or its wording changed.');return out;}
 out.kind=scope.timber.includes(input.hts.slice(0,8))?'timber':scope.furniture.includes(input.hts)?'furniture':scope.cabinet.includes(input.hts)?'cabinet':null;if(!out.kind)return null;
 const guidance=input.guidance.find(g=>g.number==='66492057'&&guidanceEntryCutoff(g,'2025-10-14')==='00:01'&&g.text.includes('9903.76.01')&&g.text.includes('9903.76.22'));
 const initial=input.actions.find(a=>a.documentNumber==='2025-19482'&&a.text.includes('Proclamation 10976')&&a.text.includes('October 14, 2025'));
 if(!guidance||!initial){out.issues.push('Retain the original wood enactment and its dated CBP implementation instructions.');return out;}out.sourceIds.push(guidance.id,initial.id);
 if(input.date>='2026-01-01'){
  const delay=input.actions.find(a=>a.documentNumber==='2026-00327'&&a.text.includes('Proclamation 11000')&&/revising clause 5 to read as follows:[\s\S]{0,2000}Effective January 1, 2027/.test(a.text));
  if(!delay){out.issues.push('The original postponement of the January2026 wood increases is missing or changed.');return out;}out.sourceIds.push(delay.id);
 }
 for(const row of input.rows.filter(r=>/^990376(?:0[1-4]|2[0-4])$/.test(r.hts)))out.rows.push({heading:row.hts.slice(0,4)+'.'+row.hts.slice(4,6)+'.'+row.hts.slice(6),rate:row.general.trim()});
 const text=clean(input.notes);
 const headingList='((?:9903\\.76\\.\\d{2}(?:,?\\s*(?:and\\s*)?)?)+)';
 const excluded=(head:string)=>{const re=new RegExp(head+' shall apply to wood products provided for in heading 9903\\.76\\.04, but shall not apply to wood products provided for in headings '+headingList+'\\.');return [...(re.exec(text)?.[1]??'').matchAll(/9903\.76\.\d{2}/g)].map(m=>m[0]);};
 out.overlaps.reciprocal=excluded('The additional duties imposed by headings 9903\\.01\\.25[^;]{0,250}');
 out.overlaps.india=excluded('The additional duties imposed by heading 9903\\.01\\.84');
 const border=/provided for in headings ([\s\S]{1,250}?), then the additional tariffs/.exec(guidance.text)?.[1];
 if(border&&guidance.text.includes('IEEPA Canada tariffs')&&guidance.text.includes('IEEPA Mexico tariffs')&&guidance.text.includes('do not apply'))out.overlaps.border=[...border.matchAll(/9903\.76\.\d{2}/g)].map(m=>m[0]);
 const exceptionList=(heading:string,target:string,source=text)=>{const begin=source.indexOf('As provided in heading '+heading+', the additional dut');if(begin<0)return[];const block=source.slice(begin,begin+8000),intro=new RegExp('^As provided in heading '+heading.replaceAll('.','\\.')+', the additional dut(?:y|ies) imposed by headings? '+target+' shall not apply to:');if(!intro.test(block))return[];const before=block.search(/\([ivxlc]{2,}\) |\([a-z]\) As provided/),part=before<0?block:block.slice(0,before),match=new RegExp('\\([a-z0-9]+\\) wood products provided for in headings '+headingList+'[;.]').exec(part);return [...(match?.[1]??'').matchAll(/9903\.76\.\d{2}/g)].map(m=>m[0]);};
 out.overlaps.section122=exceptionList('9903.03.06','9903\\.03\\.01');
 out.overlaps.country301=exceptionList('9903.05.90','9903\\.05\\.20–9903\\.05\\.84');
 if(input.origin==='KR'&&input.date>='2025-11-14'&&out.kind!=='timber'){
  const k=input.guidance.find(g=>g.number==='66987366'&&guidanceEntryCutoff(g,'2025-11-14')==='00:01'&&g.text.includes('9903.76.23')&&g.text.includes('November 14, 2025')&&g.text.includes('combined Column 1 and additional Section 232 duty rate is 15 percent'));
  if(!k)out.issues.push('The dated Korea wood agreement instructions are missing or changed.');else{out.korea=k.id;out.sourceIds.push(k.id);if(k.text.includes('Continued Exemption from Reciprocal Tariffs for Products Subject to Section 232')&&k.text.includes('Proclamation 10976'))out.overlaps.reciprocal.push('9903.76.23');if(!out.rows.some(r=>r.heading==='9903.76.23'))out.rows.push({heading:'9903.76.23',rate:'15%'});}
 }
 if(input.origin==='TW'&&input.date>='2026-05-01'&&out.kind!=='timber'){
  const g=input.guidance.find(g=>g.number==='68762890'&&guidanceEntryCutoff(g,'2026-05-01')==='00:01'&&g.text.includes('9903.76.24')),a=input.actions.find(a=>a.documentNumber==='2026-10571'&&a.text.includes('9903.76.24')&&a.text.includes('May 1, 2026'));
  if(!g||!a||!/Wood products 9903\.76\.24:[\s\S]{0,500}15%/.test(g.text)||!a.text.includes('shall be collected in lieu of any special rate of duty'))out.issues.push('The original retroactive Taiwan wood agreement and its instructions are missing or changed.');else{out.taiwan=g.id;out.sourceIds.push(g.id,a.id);if(out.overlaps.section122.includes('9903.76.23')&&/U\.S\. note 2\(aa\)\(v\)\(4\) is modified by deleting ‘‘9903\.76\.22 and 9903\.76\.23’’ and inserting ‘‘9903\.76\.22, 9903\.76\.23 and 9903\.76\.24’’ in lieu thereof\./.test(a.text))out.overlaps.section122.push('9903.76.24');if(!out.rows.some(r=>r.heading==='9903.76.24'))out.rows.push({heading:'9903.76.24',rate:'15%'});}
 }
 return out;
}
const eu=new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
export function resolveHistoricalWood(scope:HistoricalWood,input:{hts:string;date:string;origin:string;shipment?:ShipmentDetails;facts:Record<string,FactValue|undefined>}){
 const out:{measures:Measure[];requiredFacts:string[];replacesBase:boolean;active:boolean;issues:string[];nonApplicable:{heading:string;reason:string}[];overlaps:Record<keyof HistoricalWood['overlaps'],boolean>}={measures:[],requiredFacts:[],replacesBase:false,active:false,issues:[...scope.issues],nonApplicable:[],overlaps:{reciprocal:false,border:false,india:false,section122:false,country301:false}};
 if(out.issues.length||!scope.kind)return out;
 if(scope.hts!==input.hts||scope.origin!==input.origin||input.date<scope.from||input.date>=scope.before){out.issues.push('The wood snapshot does not cover this code, origin and date.');return out;}
 if(input.date<'2025-10-14'){out.nonApplicable.push(...scope.rows.map(r=>({heading:r.heading,reason:'The original wood enactment creates these duties onOctober14,2025 at00:01 Eastern, after this entry. Other duties remain independent.'})));return out;}
 if(input.date==='2025-10-14'){const state=atEasternCutoff(input.shipment?.entryTimestamp,input.date,'00:01');if(state===null){out.issues.push('Wood duties start at00:01 Eastern on October14; supply the actual entry timestamp.');return out;}if(!state){out.nonApplicable.push(...scope.rows.map(r=>({heading:r.heading,reason:'The actual entry precedes the original published00:01 Eastern creation of the wood duties on October14,2025. Independently applicable duties remain.'})));return out;}}
 for(const key of ['wood_scope_verified','wood_auto_overlap_clear'])if(input.facts[key]!==true)out.issues.push('Confirm '+key.replaceAll('_',' ')+' with dated evidence.');else out.requiredFacts.push(key);
 if(out.issues.length)return out;
 let heading=scope.kind==='timber'?'9903.76.01':scope.kind==='furniture'?'9903.76.02':'9903.76.03';
 if(scope.kind==='cabinet'){
  if(typeof input.facts.wood_cabinet_use!=='boolean'){out.issues.push('Confirm whether these goods meet the completed kitchen cabinet/vanity or parts definition.');return out;}
  if(!input.facts.wood_cabinet_use)heading='9903.76.04';
 }
 const precedingAgreement=new Set<string>();
 for(const [origin,day,id,code]of [['KR','2025-11-14',scope.korea,'9903.76.23'],['TW','2026-05-01',scope.taiwan,'9903.76.24']]as const)if(input.origin===origin&&input.date===day&&id&&scope.kind!=='timber'&&heading!=='9903.76.04'){const state=atEasternCutoff(input.shipment?.entryTimestamp,day,'00:01');if(state===null){out.issues.push('The '+origin+' wood agreement requires the actual entry timestamp.');return out;}if(!state){precedingAgreement.add(origin);out.nonApplicable.push({heading:code,reason:'The actual entry precedes the published00:01 Eastern country agreement cutoff. The separately retained original wood enactment establishes the preceding ordinary25% wood duty.'});}}
 if(heading!=='9903.76.04'&&scope.kind!=='timber'){
  if(input.origin==='GB')heading='9903.76.20';else if(input.origin==='JP')heading='9903.76.21';else if(eu.has(input.origin))heading='9903.76.22';
  else if(scope.korea&&!precedingAgreement.has('KR'))heading='9903.76.23';else if(scope.taiwan&&!precedingAgreement.has('TW'))heading='9903.76.24';
 }

 const row=scope.rows.find(r=>r.heading===heading),combined=['9903.76.21','9903.76.22','9903.76.23','9903.76.24'].includes(heading);
 const expected=heading==='9903.76.04'?'The duty provided in the applicable subheading':combined?'15%':'The duty provided in the applicable subheading + '+(['9903.76.01','9903.76.20'].includes(heading)?'10%':'25%');
 if(!row||row.rate!==expected){out.issues.push('The complete dated wood rate '+heading+' is missing or changed.');return out;}
 for(const key of Object.keys(out.overlaps) as (keyof typeof out.overlaps)[])out.overlaps[key]=scope.overlaps[key].includes(heading);
 out.replacesBase=combined;out.active=heading!=='9903.76.04';
 out.measures.push({id:heading,label:'Historical Section232 wood duty',rate:combined?'15%':heading==='9903.76.04'?'Free':['9903.76.01','9903.76.20'].includes(heading)?'10%':'25%',basis:'customs_value',conditions:{}});
 if(heading==='9903.76.04')out.nonApplicable.push({heading:'9903.76.03',reason:'The dated reviewed product use does not meet the kitchen cabinet/vanity/parts definition. Heading9903.76.04 adds no wood duty and does not establish an exemption from other programs.'});
 return out;
}
