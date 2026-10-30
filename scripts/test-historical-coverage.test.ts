/** Explicitly synthetic source text. These tests establish compiler behaviour,
 * not that the fictional clauses constitute law or independent legal approval. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {proveHistoricalTextContract,historicalChangeTimeResolved,type HistoricalContract} from '../app/api/tariff/references/historical-contract';
import {compileHistoricalReference} from '../app/api/audits/compiled-reference';
import {evaluateAuditEntry} from '../app/api/audits/engine';
import {auditBlockers} from '../app/api/audits/readiness';
import {referencePackage} from '../app/api/tariff/references/ingestion';
import {readReferenceBytes,digest,type AuditReference} from '../app/api/tariff/references/store';
import type {AuditEntry} from '../app/api/audits/model';
import {ratesOnPdfPage,type PdfCell} from '../app/api/tariff/references/pdf-rates';
const codes=(prefix:string,n:number)=>Array.from({length:n},(_,i)=>`${prefix}.${String(Math.floor(i/100)).padStart(2,'0')}.${String(i%100).padStart(2,'0')}`);
const clause=(part:string,h:string,r:string)=>`(${part}) For the purposes of heading ${h}, products of China shall be subject to an additional ${r} percent ad valorem duty, except an exclusion under 9903.88.67. These goods shall also be subject to the general rates of duty.`;
const sourceText=[clause('a','9903.88.01','25'),'(b) The products are',...codes('1100',100),clause('c','9903.88.02','25'),'(d) The products are',...codes('2200',100),clause('e','9903.88.03','25'),'(f) The products are',...codes('3300',1000),'(g) The products described here need qualification.',clause('r','9903.88.15','7.5'),'(s) The products (i)',...codes('4400',1000),'(ii) Descriptive products under 5500.00.01','(t) The next section.'].join(' ');
const actions=[{id:'list1',documentNumber:'2018-13248',text:'SYNTHETIC: 9903.88.01 July 6, 2018, 25 percent'},{id:'list2',documentNumber:'2018-17709',text:'SYNTHETIC: 9903.88.02 August 23, 2018, 25 percent'},{id:'list3',documentNumber:'2018-20610',text:'SYNTHETIC: 9903.88.03 September 24, 2018, 10 percent'},{id:'increase',documentNumber:'2019-09681',text:'SYNTHETIC: May 10, 2019, 25 percent'},{id:'list4',documentNumber:'2019-17865',text:'SYNTHETIC: 9903.88.15'},{id:'rate15',documentNumber:'2019-18838',text:'SYNTHETIC: September 1, 2019, 15 percent'},{id:'reduce',documentNumber:'2020-00904',text:'SYNTHETIC: February 14, 2020, 7.5 percent'}];
const prove=(patch:Partial<Parameters<typeof proveHistoricalTextContract>[0]>={})=>proveHistoricalTextContract({release:'2024HTSRev3',from:'2024-06-14',before:'2024-06-28',noteId:'notes',notes:sourceText,actions,...patch});
function reference(contract:HistoricalContract,hts:string,heading:string,rate:string):AuditReference{
 const ids=['schedule','notes',...actions.map(a=>a.id)];return {contract,sources:ids.map(id=>({id,release_name:'2024HTSRev3',kind:id==='schedule'?'hts_json':id==='notes'?'chapter99_pdf':'legal_document',url:`https://www.usitc.gov/SYNTHETIC-${id}`,title:'SYNTHETIC compiler test only',original_sha256:'a'.repeat(64),captured_at:'2026-10-22T00:00:00Z'})),release:{name:'2024HTSRev3',description:'SYNTHETIC test',published_on:'2024-06-14',available_from:'2024-06-14',available_until:'2024-06-28'},rate:{source_id:'schedule',hts,description:'SYNTHETIC',general:'4%',special:'',column2:'35%',additional_duties:'',units:[],footnotes:[]},chapter99:[heading],chapter99Rates:[{source_id:'schedule',hts:heading.replaceAll('.',''),description:'SYNTHETIC',general:`The duty provided in the applicable subheading + ${rate}`,special:'',column2:'',additional_duties:'',units:[],footnotes:[]}],stackingRules:[],legacyMeasures:[],gaps:[]};
}
const entry=(hts:string):AuditEntry=>({row:1,entry:'SYNTHETIC-ENTRY',line:'1',date:'2024-06-20',sku:'SYNTHETIC-SKU',description:'Fictional compiler test',hts,origin:'CN',supplier:'',value:'1000.00',paid:'300.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{label:'SYNTHETIC'}});
test('dated compiler supports four explicit list tables and excludes descriptive List 4 scope',()=>{
 const c=prove();assert(c);assert.deepEqual(c.measures.map(m=>m.heading),['9903.88.01','9903.88.02','9903.88.03','9903.88.15']);assert(!c.measures.some(m=>m.hts8.includes('55000001')));
 for(const [prefix,heading,rate,expected] of [['1100','9903.88.01','25%','290.00'],['2200','9903.88.02','25%','290.00'],['3300','9903.88.03','25%','290.00'],['4400','9903.88.15','7.5%','115.00']]){
  const e=entry(prefix+'000000'),ref=reference(c,e.hts,heading,rate),r=evaluateAuditEntry(e,[],'SYNTHETIC-PRODUCT',[],false,null,ref,true);assert.equal(r.expected,expected,JSON.stringify(r.findings));assert.equal(r.validation?.kind,'cante_validated');assert.equal(r.difference,expected==='115.00'?'185.00':'10.00');
 }
});
test('missing original actions, changed operative text and missing 2025 programs do not gain total-duty coverage',()=>{
 assert(prove({release:'2025HTSBasic',from:'2025-01-01',before:'2025-02-01'}));assert(prove({release:'2025HTSRev1',from:'2025-02-04',before:'2025-03-01'}));const modern=reference(prove({release:'2025HTSRev1',from:'2025-02-04',before:'2025-03-01'})!,'2200000000','9903.88.02','25%');assert.equal(compileHistoricalReference({...entry('2200000000'),date:'2025-02-15'},modern),null,'China list coverage alone must never omit the newer additional programs.');assert.equal(prove({actions:[]}),null);
 assert.equal(prove({notes:sourceText.replaceAll('shall also be subject to the general rates of duty','possibly other taxes')}),null);
 const c=prove({actions:actions.filter(a=>a.documentNumber!=='2020-00904')});assert(c);assert(!c.measures.some(m=>m.heading==='9903.88.15'));
 const wrongIdentity=prove({actions:actions.map(a=>a.documentNumber==='2020-00904'?{...a,documentNumber:'2020-00934'}:a)});assert(wrongIdentity);assert(!wrongIdentity.measures.some(m=>m.heading==='9903.88.15'),'Adjacent-page text under the wrong original document identity must not establish the rate change.');
});
test('PDF tables with adjacent cells retain their complete list instead of dropping most codes',()=>{
 const c=prove({notes:sourceText.replace(/(\d{4}\.\d{2}\.\d{2})\s+(?=\d{4}\.\d{2}\.\d{2})/g,'$1')});assert(c);assert.equal(c.measures.find(m=>m.heading==='9903.88.02')?.hts8.length,100);
});
test('earlier list rates are kept separate and are never carried past their modification',()=>{
 const c=prove({release:'2019HTSARev1',from:'2019-01-01',before:'2019-06-01',notes:sourceText.replace(clause('e','9903.88.03','25'),clause('e','9903.88.03','10'))});assert(c);const m=c.measures.find(m=>m.heading==='9903.88.03');assert.equal(m?.rate,'10%');assert.equal(m?.legalBefore,'2019-05-10');
 const e={...entry('3300000000'),date:'2019-05-15'},ref=reference(c!,e.hts,'9903.88.03','10%');assert.equal(compileHistoricalReference(e,ref),null);
});
test('exclusion claims, origin discrepancies and unsupported headings withhold the total',()=>{
 const c=prove()!,e=entry('2200000000'),ref=reference(c,e.hts,'9903.88.02','25%');
 for(const patch of [{exclusion:'9903.88.67'},{evidenceOrigin:'VN'},{chapter99:['9903.88.99']}]){const r=evaluateAuditEntry({...e,...patch},[],'SYNTHETIC-PRODUCT',[],false,null,ref,true);assert.equal(r.expected,null);assert(Object.values(auditBlockers(r)).some(x=>x.length));}
 const missing=evaluateAuditEntry({...e,errors:['Customs value is missing.']},[],'SYNTHETIC-PRODUCT');assert.equal(auditBlockers(missing).shipment_data.length,1);
 const absent=evaluateAuditEntry(e,[],'SYNTHETIC-PRODUCT');assert.equal(auditBlockers(absent).historical_sources.length,1);
});
test('large original storage verifies object size, fixed bucket/path and both content hashes',async()=>{
 const original=randomBytes(9500000),pack=referencePackage({kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC',title:'SYNTHETIC large original test',bytes:original,external:true});assert(pack.storageBytes);assert.equal(pack.body,'');
 const source={id:'source',...pack,metadata:pack.metadata};
 const mock=(patch:Record<string,unknown>={},content=pack.storageBytes!)=>({from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{...source,...patch},error:null})}),storage:{from:(bucket:string)=>{assert.equal(bucket,'official-tariff-references');return {download:async()=>({data:new Blob([new Uint8Array(content)]),error:null})};}}});
 assert.deepEqual((await readReferenceBytes(mock() as never,'source')).bytes,original);
 await assert.rejects(readReferenceBytes(mock({metadata:{storage:{...pack.metadata.storage,path:'other.bin'}}}) as never,'source'),/pointer/);
 const changed=Buffer.from(pack.storageBytes!);changed[0]^=1;await assert.rejects(readReferenceBytes(mock({},changed) as never,'source'),/hash mismatch|integrity/);
 assert.equal(digest(original),pack.original_sha256);
});
test('original download retries transient reads once but never permissions, size or integrity failures',async()=>{
 const bytes=Buffer.from('SYNTHETIC original'),sha=digest(bytes),source={id:'source',compression:'none',original_bytes:bytes.length,original_sha256:sha,metadata:{storage:{bucket:'official-tariff-references',path:sha+'.bin',storedBytes:bytes.length,storedSha256:sha}}};
 let calls=0;const mock=(results:any[])=>({from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:source,error:null})}),storage:{from:()=>({download:async()=>results[Math.min(calls++,results.length-1)]})}}),ok={data:new Blob([bytes]),error:null};
 assert.deepEqual((await readReferenceBytes(mock([{error:{statusCode:'503'}},ok]) as never,'source')).bytes,bytes);assert.equal(calls,2);
 calls=0;assert.deepEqual((await readReferenceBytes(mock([{error:{status:503,statusCode:'InternalError'}},ok]) as never,'source')).bytes,bytes);assert.equal(calls,2);
 calls=0;assert.deepEqual((await readReferenceBytes(mock([{error:{name:'StorageUnknownError',originalError:new TypeError('fetch failed')}},ok]) as never,'source')).bytes,bytes);assert.equal(calls,2);
 for(const status of [403,404]){calls=0;await assert.rejects(readReferenceBytes(mock([{error:{statusCode:String(status)}},ok]) as never,'source'),new RegExp(String(status)));assert.equal(calls,1);}
 calls=0;await assert.rejects(readReferenceBytes(mock([{error:{statusCode:'503'}}]) as never,'source'),/503/);assert.equal(calls,2);
 calls=0;await assert.rejects(readReferenceBytes(mock([{data:new Blob(['truncated']),error:null},ok]) as never,'source'),/size mismatch/);assert.equal(calls,1);
 calls=0;const controller=new AbortController();controller.abort();await assert.rejects(readReferenceBytes(mock([ok]) as never,'source',controller.signal));assert.equal(calls,0);
});
test('PDF lookup requires the printed full statistical code, column contract and complete rate',()=>{
 const c=(text:string,x:number,y:number):PdfCell=>({text,x,y});
 const page=[c('Rates of Duty',457,719),c('General',399,701),c('Special',471,701),c('8501.31.40',48,570),c('00',96,570),c('Declared fictional motor',168,570),c('4%',381,557),c('1/',393,562),c('No........',338,559),c('8501.31.50',48,510),c('00',96,510),c('Other fictional motor',168,510),c('3.3%',381,508),c('2/',400,515)];
 const rates=ratesOnPdfPage(page,'SYNTHETIC-PDF',new Set(['8501314000']),9);assert.equal(rates.length,1);assert.equal(rates[0].general,'4%');assert.equal(rates[0].hts,'8501314000');assert.equal(rates[0].pdfPage,9);
 assert.deepEqual(rates[0].footnotes,[{marker:'1',value:''}],'The next row superscript must not change this row tariff treatment');
 assert.equal(ratesOnPdfPage(page,'SYNTHETIC',new Set(['8501314001']),9).length,0);
 assert.equal(ratesOnPdfPage(page.filter(c=>c.text!=='General'),'SYNTHETIC',new Set(['8501314000']),9).length,0);
 assert.equal(ratesOnPdfPage(page.map(c=>c.text==='4%'?{...c,text:'4% plus an unknown charge'}:c),'SYNTHETIC',new Set(['8501314000']),9).length,0);
 assert.equal(ratesOnPdfPage(page.filter(c=>!(c.x===96&&c.y===570)),'SYNTHETIC',new Set(['8501314000']),9).length,0);
});

test('a law printed before its effective date activates on the legal date, not the edition start',()=>{
 const c=prove({release:'2018HTSARevision7',from:'2018-07-01',before:'2018-08-01',notes:sourceText})!;
 assert(c.measures.some(m=>m.heading==='9903.88.01'&&m.legalEffectiveOn==='2018-07-06'));
 const e={...entry('1100000000'),date:'2018-07-05'},ref=reference(c,e.hts,'9903.88.01','25%');
 assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true).expected,'40.00');const earlyClaim=evaluateAuditEntry({...e,chapter99:['9903.88.01']},[],'SYNTHETIC',[],false,null,ref,true);assert.equal(earlyClaim.expected,'40.00');assert(earlyClaim.findings.some(f=>f.type==='chapter99_claim_mismatch'));
 assert.equal(evaluateAuditEntry({...e,date:'2018-07-10'},[],'SYNTHETIC',[],false,null,ref,true).expected,'290.00');
});

test('change-day time and 2019 increased-rate transit treatment are explicit shipment facts',()=>{
 const c=prove({release:'2019HTSARev6',from:'2019-05-10',before:'2019-07-01'})!,e={...entry('3300000000'),date:'2019-05-15'},ref=reference(c,e.hts,'9903.88.03','25%');
 assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true).expected,null);
 const d={row:1,kind:'confirm_facts' as const,note:'SYNTHETIC dated shipping evidence confirms no transit exception.',evidence:['SYNTHETIC-SHIPPING'],validFrom:'2019-05-15',validBefore:'2019-05-16',facts:{section301_transit_clear:true}};assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[d],false,null,ref,true).expected,'290.00');
 const boundary=evaluateAuditEntry({...e,date:'2019-05-10'},[],'SYNTHETIC',[],false,null,ref,true);assert.equal(boundary.expected,null);assert(boundary.findings.some(f=>f.type==='chapter99_boundary'));
});

test('China list change-day support requires its original published time and a consistent actual instant',()=>{
 const dated=actions.map(a=>a.id==='list1'?{...a,text:a.text+' SYNTHETIC entered for consumption on or after 12:01 a.m. eastern daylight time on July 6, 2018.'}:a),c=prove({release:'2018HTSARevision7',from:'2018-07-01',before:'2018-08-01',actions:dated})!;
 assert.equal(c.measures[0].legalCutoff,'00:01');const e={...entry('1100000000'),date:'2018-07-06',shipment:{entryTimestamp:'2018-07-06T04:01:00Z'}},ref=reference(c,e.hts,'9903.88.01','25%');
 assert.equal(evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true).expected,'290.00');
 for(const timestamp of [undefined,'2018-07-06T04:00:59Z','2018-07-06T00:01:00Z'])assert.equal(evaluateAuditEntry({...e,shipment:{entryTimestamp:timestamp}},[],'SYNTHETIC',[],false,null,ref,true).expected,null);
 const legacy=prove({release:'2018HTSARevision7',from:'2018-07-01',before:'2018-08-01'})!;assert.equal(historicalChangeTimeResolved(legacy,e),false);assert.equal(historicalChangeTimeResolved(legacy,{...e,origin:'VN'}),true);
 const changed=prove({release:'2018HTSARevision7',from:'2018-07-01',before:'2018-08-01',actions:dated.map(a=>({...a,text:a.text.replace('12:01','12:02')}))})!;assert.equal(historicalChangeTimeResolved(changed,e),false);
});

test('initial 2018 lists end at the printed table boundary and do not require later exclusion language',()=>{
 const initial=(part:string,heading:string,list:string)=>`(${part}) For the purposes of heading ${heading}, products of China shall be subject to an additional 25 percent ad valorem duty. All products of China that are classified in the subheadings enumerated in U.S. note 20(${list}) to subchapter III are subject to the additional 25 percent ad valorem rate of duty imposed by heading ${heading}. Goods shall also be subject to the general rates of duty. (${list}) Heading ${heading} applies to all products of China that are classified in the following 8-digit subheadings: `;
 const originals=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/initial301-public.json','utf8')),list=(heading:string)=>originals.contexts.find((c:any)=>c.release.name==='2018HTSARevision13'&&c.heading===heading).list;
 const tableHeader='Rates of Duty Unit of Quantity Article Description Stat. Suf- fix Heading/ Subheading 2 1 Special General',notes=initial('a','9903.88.01','b').split('(b) Heading')[0]+'(b) '+list('9903.88.01')+' '+initial('c','9903.88.02','d').split('(d) Heading')[0]+'(d) '+list('9903.88.02')+' '+tableHeader+' 9903.04.05 Unrelated commodity 3300.00.00',input={release:'2018HTSARevision10',from:'2018-08-22',before:'2018-08-30',notes},c=prove(input)!;
 assert(c.completeScope);assert.equal(c.measures.length,2);assert(!c.measures.some(m=>m.hts8.includes('33000000')));
 for(const changed of [notes.replace(tableHeader,'Unknown unbounded table'),notes.replace('3403.19.10','3403.19.11'),notes.replace('3403.19.10','3403.19.10 for military use only')])assert.notEqual(prove({...input,notes:changed})?.completeScope,true);
 assert.notEqual(prove({...input,before:'2018-10-01'})?.completeScope,true,'The initial-list contract must not absorb later tariff periods.');
});

test('PDF mixed/specific expressions keep the General column and matching unit without borrowing Special rates',()=>{
 const c=(text:string,x:number,y:number):PdfCell=>({text,x,y}),page=[c('Rates of Duty',457,719),c('General',399,701),c('Special',471,701),c('8501.31.40',48,570),c('00',96,570),c('SYNTHETIC mixed-duty layout',168,570),c('2.5 cents/kg +',381,557),c('4%',381,545),c('Free',470,557),c('99%',540,557),c('kg........',338,559)];
 const rows=ratesOnPdfPage(page,'SYNTHETIC-PDF',new Set(['8501314000']),1);assert.equal(rows.length,1);assert.equal(rows[0].general,'2.5 cents/kg + 4%');assert.deepEqual(rows[0].units,['kg']);assert.equal(ratesOnPdfPage(page.map(p=>p.text==='4%'?{...p,text:'unknown charge'}:p),'SYNTHETIC-PDF',new Set(['8501314000']),1).length,0);
});

test('older PDF inline footnote markers remain evidence, while Special and Column 2 stay independent',()=>{
 const c=(text:string,x:number,y:number):PdfCell=>({text,x,y}),page=[c('Rates of Duty',457,719),c('General',399,701),c('Special',471,701),c('8501.31.40',48,570),c('00',96,570),c('SYNTHETIC printed motor',168,570),c('4% 2/',381,557),c('Free (CA,',446,557),c('MX)',450,545),c('35%',524,557),c('No........',338,559)];
 const [row]=ratesOnPdfPage(page,'SYNTHETIC-PDF',new Set(['8501314000']),7);assert.equal(row.general,'4%');assert.deepEqual(row.footnotes,[{marker:'2',value:'',scope:'general_rate',scopeEvidence:{text:'4% 2/',x:381,y:557}}]);assert.equal(row.special,'Free (CA, MX)');assert.equal(row.column2,'35%');
 assert.equal(ratesOnPdfPage(page.map(p=>p.text==='4% 2/'?{...p,text:'4% plus an unknown charge 2/'}:p),'SYNTHETIC-PDF',new Set(['8501314000']),7).length,0);
 const multiple=ratesOnPdfPage(page.map(p=>p.text==='4% 2/'?{...p,text:'4% 2/3/'}:p),'SYNTHETIC-PDF',new Set(['8501314000']),7)[0];assert.deepEqual(multiple.footnotes.map(f=>(f as {marker:string}).marker),['2','3']);
});

test('reference metadata failures remain distinct from absent evidence and do not expose raw database errors',async()=>{
 const mock=(result:unknown)=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>result})})})});
 await assert.rejects(readReferenceBytes(mock({data:null,error:{code:'PGRST000',message:'PRIVATE DATABASE DETAIL'}}) as never,'SYNTHETIC'),error=>error instanceof Error&&error.message.includes('metadata read failed (PGRST000)')&&!error.message.includes('PRIVATE'));
 await assert.rejects(readReferenceBytes(mock({data:null,error:null}) as never,'SYNTHETIC'),/Retained reference SYNTHETIC not found/);
});

test('a transient cancelled reference lookup retries once; absence, permissions and cancellation do not',async()=>{
 const bytes=Buffer.from('SYNTHETIC retained original'),pack=referencePackage({kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC',title:'SYNTHETIC',bytes}),source={id:'SYNTHETIC',...pack};let calls=0;
 const mock=(responses:unknown[])=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>responses[Math.min(calls++,responses.length-1)]})})})});
 const r=await readReferenceBytes(mock([{data:null,error:{code:'57014'}},{data:source,error:null}]) as never,'SYNTHETIC');assert.deepEqual(r.bytes,bytes);assert.equal(calls,2);
 calls=0;await assert.rejects(readReferenceBytes(mock([{data:null,error:{code:'57014'}}]) as never,'SYNTHETIC'),/failed \(57014\)/);assert.equal(calls,2);
 for(const failure of [{data:null,error:{code:'42501'}},{data:null,error:null}]){calls=0;await assert.rejects(readReferenceBytes(mock([failure,{data:source,error:null}]) as never,'SYNTHETIC'));assert.equal(calls,1);}
 calls=0;const cancelled=new AbortController();cancelled.abort();await assert.rejects(readReferenceBytes(mock([{data:source,error:null}]) as never,'SYNTHETIC',cancelled.signal));assert.equal(calls,0);
});
