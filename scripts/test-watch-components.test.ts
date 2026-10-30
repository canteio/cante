/** Public original cell excerpts; source IDs, products, declarations and evidence
 * decisions are fictional. No legal approval or external writes. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {watchStatisticalComponents,watchParentRates,type StatisticalComponentEvidence} from '../app/api/tariff/references/pdf-rates';
import {annualForEntry,corroborateAnnualStatisticalRate,watchComponentFormula,type AnnualRow} from '../app/api/tariff/references/annual-data';
import {evaluateAuditEntry,reconcileStatisticalComponents} from '../app/api/audits/engine';
import {defaultOptions,type AuditEntry,type FactDecision} from '../app/api/audits/model';
import {parseAudit,auditTable,suggestMapping} from '../app/api/audits/input';
import {referenceEntries,exportAudit} from '../app/api/audits/store';
import type{AuditReference,ReferenceRate}from'../app/api/tariff/references/store';
const pages=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/watch-statistical-page-cells.json','utf8')),components=watchStatisticalComponents(pages)!;
const raw='44¢ each + 6% on the case + 14% on the strap, band or bracelet + 5.3% on the battery';
const row:AnnualRow={record:1,hts8:'91021110',description:'SYNTHETIC declared watch',from:'2016-01-01',through:'2016-12-31',rateType:'T',adValorem:'9999.99',specific:'9999.99',other:'9999.99',textRate:raw,textRateAvailable:true,special:'',column2:'',units:['NO'],quantityCodes:['NO',''],footnote:'',additional:''};
const identity={year:2016,chapter:'91',publisherRelease:'SYNTHETIC',description:'SYNTHETIC',availableFrom:'2016-05-17',availableBefore:'2016-06-30',registryId:'SYNTHETIC-REGISTRY',detailsId:'SYNTHETIC-DETAILS',archiveId:'SYNTHETIC-ARCHIVE'};
const entry=(suffix:string,value:string,paid:string,index=Number(suffix)/10):AuditEntry=>({row:index,entry:'SYNTHETIC-WATCH',line:String(index),date:'2016-06-15',sku:'SYNTHETIC-'+suffix,description:'SYNTHETIC',hts:'91021110'+suffix,origin:'JP',supplier:'',value,paid,basePaid:null,additionalPaid:null,quantity:'100',unit:'NO',chapter99:[],documents:['SYNTHETIC-DOC'],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{label:'SYNTHETIC'},shipment:{componentGroup:'SYNTHETIC-GROUP',articleValue:'1000.00'}});
const entries=[entry('10','600.00','50.00'),entry('20','200.00','5.00'),entry('30','150.00','21.00'),entry('40','50.00','2.65')];
function reference(e:AuditEntry,parent=raw,declaredRow:AnnualRow={...row,hts8:e.hts.slice(0,8),textRate:parent},publishedDescription='SYNTHETIC component'):AuditReference{
 const initial=annualForEntry([declaredRow],2016,'SYNTHETIC-ANNUAL',e,{id:'SYNTHETIC-KEY',valid:true,fieldsSourceId:'SYNTHETIC-FIELDS'}),rate:ReferenceRate={source_id:'SYNTHETIC-CHAPTER',hts:e.hts,description:publishedDescription,general:parent,special:'',column2:'',additional_duties:'',units:['NO'],footnotes:[{marker:'1',value:'See statistical note 1 to this chapter.'}],pdfPage:13,projection:'official-annual-statistical-v1',statisticalComponent:components.get(e.hts)};
 const annual=corroborateAnnualStatisticalRate(initial,e,[{identity,sourceId:rate.source_id,rate}],'SYNTHETIC-FIELDS'),ids=[initial.sourceId,initial.codeKeySourceId!,'SYNTHETIC-FIELDS','SYNTHETIC-GN3',...(annual.scheduleCorroboration?.sourceIds??[])];
 return {annual,ordinaryCountry:{compiler:'historical-ordinary-mfn-v1',year:2016,sourceId:'SYNTHETIC-GN3',eligibleOrigins:['JP']},sources:[...new Set(ids)].map(id=>({id,release_name:null,kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC-'+id,title:'SYNTHETIC',original_sha256:'a'.repeat(64),captured_at:'2026-10-27T00:00:00Z'})),release:null,rate:null,chapter99:[],chapter99Rates:[],stackingRules:[],legacyMeasures:[],gaps:[]};
}
const run=(e=entries[0],group=entries,decisions:FactDecision[]=[],parent=raw)=>{const scoped=referenceEntries(group,decisions),related=group.map((v,i)=>({...v,...scoped[i]}));return evaluateAuditEntry(e,[],'SYNTHETIC-PRODUCT',decisions,false,null,reference({...e,...scoped[group.indexOf(e)]},parent),true,false,related);};
test('original tables establish 293 real suffixes in all 17 complete reporting patterns',()=>{
 assert.equal(components.size,293);assert.equal(new Set([...components.values()].map(c=>c.group)).size,17);assert(!components.has('9105291000'));assert.equal(components.get('9105291010')?.role,'movement');assert.equal(components.get('9105291020')?.role,'case');assert.equal(components.get('9105214010')?.branch,'ac');
 for(const mutate of [(p:typeof pages)=>p[0].cells.find((c:{text:string})=>c.text==='20').text='25',(p:typeof pages)=>p[0].cells.find((c:{text:string})=>c.text.includes('total value of the article')).text+=' except when convenient',(p:typeof pages)=>p.splice(2,1)]){const copy=structuredClone(pages);mutate(copy);assert.equal(watchStatisticalComponents(copy),null);}
});
test('every parent charge is consumed and percentages apply only to their reported component value',()=>{
 const r=entries.map(e=>run(e));assert.deepEqual(r.map(r=>r.expected),['44.00','12.00','21.00','2.65']);assert.deepEqual(r.map(r=>r.difference),['6.00','-7.00','0.00','0.00']);assert(r.every(r=>r.validation?.compiler==='historical-statistical-components-v1'&&r.componentReporting?.componentValueSum==='1000.00'));assert.equal(r[0].reference?.annual?.row?.specific,'9999.99');
 const grouped=watchComponentFormula('51 cents each + 6.25% on the case and strap, band or bracelet + 5.3% on the battery',components.get(entries[1].hts)!);assert.equal(grouped?.terms[0].rate,'6.25%');
 for(const bad of [raw+' + 1% service charge',raw+' if qualified','See 9102.11.10',raw.replace('the case','an unknown part')])assert.equal(watchComponentFormula(bad,components.get(entries[0].hts)!),null);
});
test('missing, duplicate, inconsistent or invented groups cannot produce a complete expected duty',()=>{
 for(const group of [entries.slice(0,3),[...entries,{...entries[1],row:5,line:'5'}],entries.map(e=>({...e,value:'1000.00'})),entries.map((e,i)=>i===1?{...e,shipment:{...e.shipment,articleValue:'999.00'}}:e),entries.map(e=>({...e,quantity:'0.5'})),entries.map((e,i)=>i===1?{...e,shipment:{...e.shipment,quantity2:'90',unit2:'NO'}}:e),entries.map(e=>({...e,shipment:{articleValue:'1000.00'}}))]){
  for(const e of group){const r=run(e,group);assert.equal(r.expected,null);assert(r.findings.some(f=>f.type==='statistical_components'));}
 }
 const incomplete=entries.map((e,i)=>i===3?{...e,entry:'OTHER-ENTRY'}:e);assert.equal(run(incomplete[0],incomplete).expected,null);
});
test('the explicitly published AC branch excludes battery duty; other branches require its zero or valued line',()=>{
 const e={...entries[0],hts:'9105214010',value:'1000.00',paid:'39.00',quantity:'20'},r=run(e,[e],[],'3.9% on the movement and case + 5.3% on the battery');assert.equal(r.expected,'39.00');assert.deepEqual(r.componentReporting?.suffixes,['10']);
 const zero=entries.map((e,i)=>({...e,value:['600.00','250.00','150.00','0.00'][i],quantity:i===3?'0':'100'}));assert.equal(run(zero[3],zero).expected,'0.00');assert.equal(run({...zero[3],value:'1.00'},[...zero.slice(0,3),{...zero[3],value:'1.00'}]).expected,null);
});
test('dutiable jewels are supplied explicitly; general jewels and guessed subtraction are rejected',()=>{
 const e={...entries[0],hts:'9105293010',value:'600.00',paid:'60.00',shipment:{...entries[0].shipment,quantity2:'25',unit2:'DJWL'}},c={...entries[1],hts:'9105293020',value:'400.00',paid:'19.60'},group=[e,c],parent='57 cents each + 3.7 cents/jewel over 7 + 4.9% on the case';assert.equal(run(e,group,[],parent).expected,'57.93');assert.equal(run(c,group,[],parent).expected,'19.60');const explicit={...e,shipment:{...e.shipment,quantity2:undefined,unit2:undefined,dutiableJewels:'25'}};assert.equal(run(explicit,[explicit,c],[],parent).expected,'57.93');const bad={...e,shipment:{...e.shipment,unit2:'JWL'}};assert.equal(run(bad,[bad,c],[],parent).expected,null);const fractional={...e,shipment:{...e.shipment,quantity2:'2.5'}};assert.equal(run(fractional,[fractional,c],[],parent).expected,null);
});
test('dated primary-quantity corrections reconcile the group without changing original declarations or rates',()=>{
 const original=entries.map((e,i)=>i===0?{...e,quantity:'90',shipment:{...e.shipment,quantity2:'100',unit2:'NO'}}:e);assert.equal(run(original[0],original).expected,null);
 const decisions:FactDecision[]=[{row:1,kind:'confirm_facts',note:'SYNTHETIC dated quantity evidence',evidence:['SYNTHETIC-CORRECTION'],validFrom:'2016-06-15',validBefore:'2016-06-16',shipment:{primaryQuantity:'100',primaryUnit:'NO'}}],r=run(original[0],original,decisions);assert.equal(r.expected,'44.00');assert.equal(original[0].quantity,'90');assert.equal(r.components[0].quantityInputs?.[0].quantity,'100');assert.equal(r.basis,'reviewed');assert.equal(run(original[0],original,[{...decisions[0],validBefore:'2016-06-15'}]).expected,null);
});
test('CSV distinguishes article total from component value and exports the reporting proof',()=>{
 const csv='entry_number,line_number,entry_date,sku,hts_code,country_of_origin,customs_value_usd,total_duties_paid,quantity,unit,component_group,article_total_value_usd\nSYNTHETIC,1,2016-06-15,SYNTHETIC,9102111010,JP,600.00,50.00,100,NO,SYNTHETIC-GROUP,1000.00\n',parsed=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true});assert.deepEqual(parsed[0].errors,[]);assert.equal(parsed[0].shipment?.articleValue,'1000.00');
 const report=exportAudit({batch:{id:'SYNTHETIC'},rows:entries.map(e=>({entry:e,result:run(e)})),decisions:[],verified:true,resultRevision:0});assert(report.includes('component_reporting'));assert(report.includes('componentValueSum'));assert(report.includes('9999.99'));assert(report.includes('statistical_components'));
});

test('the final printed table row remains complete below the former 100-point cutoff',()=>{
 const page=pages.find((p:{page:number})=>p.page===18),row=watchParentRates(page.cells,'SYNTHETIC',new Set(['9102295010']),18,components)[0];assert(row);assert.equal(row.general,'93¢ each + 4.8% on the case + 2.2% on the strap, band or bracelet');assert(!row.general.includes('See statistical note'));
 const low=pages.find((p:{page:number})=>p.page===12),free=watchParentRates(low.cells,'SYNTHETIC',new Set(['9101998010']),12,components)[0];assert.equal(free.general,'Free');
});

test('a later statistical note cannot establish component reporting for an uncovered historical date',()=>{
 const e={...entries[0],date:'2016-01-15'},r=run(e,[e]);assert.equal(r.expected,null);assert.equal(r.reference?.annual?.mfnRate,null);assert(r.reference?.annual?.quantityIssue?.includes('contemporaneous'));
 const current=run();assert.equal(current.components[0].effectiveFrom,'2016-05-17');assert.equal(current.components[0].effectiveBefore,'2016-06-30');
});

test('component counts remain independent; multiple batteries do not imply a quantity error',()=>{
 const group=entries.map((e,i)=>i===3?{...e,quantity:'200'}:e);assert.deepEqual(group.map(e=>run(e,group).expected),['44.00','12.00','21.00','2.65']);
});

test('an original value bracket flags a classification contradiction without guessing a replacement HTS',()=>{
 const make=(hts:string,relation:'not over'|'over',parent:string,quantity='10')=>{const e={...entries[0],hts,value:'1000.00',paid:'40.00',quantity},r=reference(e,parent,{...row,hts8:hts.slice(0,8),description:'Alarm clock movements, valued '+relation+' $5 each',textRate:parent},'AC article · Valued '+relation+' $5 each');assert.equal(r.annual?.statisticalValueCondition?.amount,'5.00');return evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,r,true,false,[e]);};
 const raw='7.5 cents each + 3.2% on the movement + 2.6% on the battery',bad=make('9109103010','not over',raw);assert.equal(bad.expected,null);assert(bad.findings.some(f=>f.type==='classification_value'&&f.certainty==='review'));assert.equal(bad.appliedHts,'9109103010');assert.equal(make('9109103010','not over',raw,'200').expected,'47.00');
 const upper='22 cents each + 3.2% on the movement + 2.6% on the battery';assert.equal(make('9109104010','over',upper,'20').expected,'36.40');assert.equal(make('9109104010','over',upper,'200').expected,null);
});
