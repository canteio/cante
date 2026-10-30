/** Public cells and expressly fictional shipment relationships. No legal approval. */
import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{annualForEntry,proveRelatedArticleInstruction,proveRelatedArticleRate,type AnnualScheduleEvidence}from'../app/api/tariff/references/annual-data';
import{ratesOnPdfPage}from'../app/api/tariff/references/pdf-rates';import{evaluateAuditEntry}from'../app/api/audits/engine';import{factDecisionSchema,type AuditEntry,type FactDecision}from'../app/api/audits/model';import{relatedArticleHeading,shipmentSchema}from'../app/api/audits/shipment';import{auditBlockers}from'../app/api/audits/readiness';import type{AuditReference}from'../app/api/tariff/references/store';
const fixture=JSON.parse(readFileSync('scripts/test-fixtures/historical-audits/2017-related-article-cells.json','utf8'));
const e:AuditEntry={row:1,entry:'SYNTHETIC-RELATED',line:'001',date:'2017-06-15',sku:'SYNTHETIC',description:'FICTIONAL accessory',hts:'9620001500',origin:'CU',supplier:'',value:'1000.50',paid:'500.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',shipment:{relatedArticleHts:'9005100040'},chapter99:[],documents:['SYNTHETIC-DOC'],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{hts_code:'9620001500'}};
const decision:FactDecision={row:1,kind:'confirm_facts',validFrom:'2017-01-01',validBefore:'2018-01-01',evidence:['SYNTHETIC-CLASSIFICATION'],note:'FICTIONAL evidence supports the complete article classification and accessory relationship.',facts:{related_article_verified:true}};
function ref(entry=e,lookup=false):{reference:AuditReference;evidence:AnnualScheduleEvidence[]} {
 const row=fixture.annual.find((r:any)=>r.hts8===entry.hts.slice(0,8));assert(row);const annual=annualForEntry([row],2017,'SYNTHETIC-ANNUAL',entry,{id:'SYNTHETIC-KEY',valid:true,fieldsSourceId:'SYNTHETIC-FIELDS',column2FieldsSourceId:'SYNTHETIC-FIELDS'});
 const evidence:AnnualScheduleEvidence[]=fixture.originals.flatMap((o:any)=>{const rate=ratesOnPdfPage(o.cells,o.sourceId,new Set([entry.hts]),o.page,true)[0];if(!rate)return[];return[{sourceId:o.sourceId,rate:{...rate,projection:'official-annual-chapter-v1'},identity:{year:2017,chapter:entry.hts.slice(0,2),publisherRelease:o.url.includes('NTE')?'NTE':'basicCorrections2',description:'Public 2017 original',availableFrom:o.url.includes('NTE')?'2017-10-30':'2017-02-09',availableBefore:o.url.includes('NTE')?'2017-12-21':'2017-06-30',archiveId:'SYNTHETIC-ARCHIVE'}}];});
 const column=entry.origin==='CU'?'column2':'general',sources=['SYNTHETIC-ANNUAL','SYNTHETIC-KEY','SYNTHETIC-FIELDS','SYNTHETIC-GN3','SYNTHETIC-ARCHIVE',...evidence.map(x=>x.sourceId)].map(id=>({id,release_name:null,kind:'legal_document',url:'https://www.usitc.gov/SYNTHETIC-'+id,title:'SYNTHETIC test source identity',original_sha256:'a'.repeat(64),captured_at:'2026-10-28T00:00:00Z'}));
 const reference:AuditReference={annual,ordinaryCountry:{compiler:'historical-ordinary-mfn-v1',year:2017,sourceId:'SYNTHETIC-GN3',eligibleOrigins:['JP'],excludedOrigins:['CU','KP']},sources,release:null,rate:null,chapter99:[],chapter99Rates:[],stackingRules:[],legacyMeasures:[],gaps:[]};
 if(lookup)reference.relatedArticleProof=proveRelatedArticleRate(annual,entry,evidence,column)??undefined;else reference.relatedArticleInstruction=proveRelatedArticleInstruction(annual,entry,evidence,column)??undefined;
 return{reference,evidence};
}
function setup(entry=e){const child=ref(entry),parentHts=entry.shipment!.relatedArticleHts!,parent=ref({...entry,hts:parentHts,shipment:undefined},true);child.reference.relatedArticle={hts:parentHts,reference:parent.reference};return{child,parent};}
const run=(entry=e,reference=setup(entry).child.reference,decisions=[decision])=>evaluateAuditEntry(entry,[],'SYNTHETIC-PRODUCT',decisions,false,null,reference,true);
test('three original accessory families use the documented article percentage on accessory value',()=>{
 for(const[hts,parent,expected]of[['9620001500','9005100040','600.30'],['9620003010','9015104000','400.20'],['9015900110','9015104000','400.20']]){const entry={...e,hts,raw:{hts_code:hts},shipment:{relatedArticleHts:parent}},r=run(entry);assert.equal(r.expected,expected,JSON.stringify(r.findings));assert.equal(r.appliedHts,hts);assert.equal(r.validation?.compiler,'historical-related-article-v1');assert.equal(r.tariffColumn,'column2');assert.match(r.components[0].explanation,new RegExp(parent));assert.equal(entry.raw.hts_code,hts);}
});
test('ordinary MFN and Column2 remain separate; a zero rate still needs the relationship review',()=>{
 const entry={...e,origin:'JP'},r=run(entry);assert.equal(r.expected,'0.00');assert.equal(r.tariffColumn,'column1');assert.equal(run(entry,setup(entry).child.reference,[]).expected,null);
 const part={...e,origin:'JP',hts:'9015900110',shipment:undefined};assert.equal(run(part,ref(part).reference,[]).expected,'0.00','Its published MFN Free rate does not depend on a parent code.');
});
test('a parent declaration alone, missing evidence or an out-of-date decision never establishes the relationship',()=>{
 for(const ds of[[],[{...decision,evidence:[]}],[{...decision,validBefore:'2017-06-15'}],[{...decision,facts:{related_article_verified:false}}]])assert.equal(run(e,setup().child.reference,ds).expected,null);
 const reference=setup().child.reference;delete reference.relatedArticle;const r=run(e,reference);assert.equal(r.expected,null);assert(r.findings.some(f=>f.type==='related_article'));
});
test('wrong headings, substituted reporting suffixes, self references, unretained sources and changed columns stay unresolved',()=>{
 const variants=[(r:AuditReference)=>{r.relatedArticle!.hts='9015104000';},(r:AuditReference)=>{r.relatedArticle!.reference.relatedArticleProof!.hts='9005100080';},(r:AuditReference)=>{r.relatedArticle!.reference.relatedArticleProof!.column='general';},(r:AuditReference)=>{r.relatedArticleInstruction!.hts='9620003010';},(r:AuditReference)=>{r.sources=[];r.relatedArticle!.reference.sources=[];},(r:AuditReference)=>{r.relatedArticle!.reference.relatedArticle={hts:e.hts,reference:ref(e).reference};}];for(const edit of variants){const r=setup().child.reference;edit(r);assert.equal(run(e,r).expected,null);}
 assert.equal(relatedArticleHeading('2202993600'),null);assert.equal(relatedArticleHeading('9620001500'),'9005');assert(!shipmentSchema.safeParse({relatedArticleHts:'9005.10.0040'}).success);
 assert(!factDecisionSchema.safeParse({...decision,shipment:{relatedArticleHts:'9005100040'},facts:{}}).success);
});
test('complete original instruction and exact parent formulas must agree without unresolved notes',()=>{
 const{child,parent}=setup(),a=child.reference.annual!,p=parent.reference.annual!,entry={...e,hts:'9005100040',shipment:undefined};
 assert(proveRelatedArticleInstruction(a,e,child.evidence,'column2'));assert(proveRelatedArticleRate(p,entry,parent.evidence,'column2'));
 for(const evidence of[[],child.evidence.map(x=>({...x,rate:{...x.rate!,column2:x.rate!.column2+' if qualified'}})),child.evidence.map(x=>({...x,rate:{...x.rate!,footnotes:[{value:'Unresolved note'}]}}))])assert.equal(proveRelatedArticleInstruction(a,e,evidence,'column2'),null);
 for(const evidence of[[],parent.evidence.map(x=>({...x,rate:{...x.rate!,hts:'9005100080'}})),parent.evidence.map(x=>({...x,rate:{...x.rate!,column2:'61%'}})),parent.evidence.map(x=>({...x,rate:{...x.rate!,column2:'$1/no + 60%'}}))])assert.equal(proveRelatedArticleRate(p,entry,evidence,'column2'),null);
 assert.equal(proveRelatedArticleRate(p,{...entry,date:'2018-01-01'},parent.evidence,'column2'),null);assert.equal(proveRelatedArticleInstruction(a,e,child.evidence,'column2',[{sourceId:'SYNTHETIC',reason:'fetch failed'}]),null);
});

test('a subsequent accessory reclassification invalidates an older relationship decision',()=>{
 const original={...e,hts:'9015900110',shipment:{relatedArticleHts:'9015104000'}},corrected={...original,hts:'9620003010'},reference=setup(corrected).child.reference,changed:FactDecision={...decision,hts:corrected.hts,facts:{classification_verified:true}};
 const result=run(original,reference,[decision,changed]);assert.equal(result.expected,null);assert(result.findings.some(f=>f.missing.includes('related_article_verified')));
 assert.equal(run(original,reference,[decision,{...changed,facts:{classification_verified:true,related_article_verified:true}}]).expected,'400.20');
});

test('declared preferences and special procedures identify their own blockers instead of blaming a proved parent rate',()=>{
 for(const[shipment,type]of[[{...e.shipment,preference:'NAFTA'},'preference_coverage'],[{...e.shipment,entryType:'21'},'entry_type_coverage']] as const){const entry={...e,shipment},r=run(entry,setup().child.reference);assert.equal(r.expected,null);assert(r.findings.some(f=>f.type===type));assert(!r.findings.some(f=>f.type==='related_article'));}
 for(const entry of[{...e,shipment:{...e.shipment,cases:['A-570-909-229'],dutyStage:'cash_deposit' as const}},{...e,chapter99:['9902.01.01']},{...e,exclusion:'9903.88.67'}]){const r=run(entry,setup().child.reference);assert.equal(r.expected,null);assert(r.findings.some(f=>f.type===(entry.shipment?.cases?.length?'adcvd_shipment':'additional_scope')));assert(!r.findings.some(f=>f.type==='related_article'));}
});

test('missing shipment data, evidence, original instructions and unsupported interpretation remain distinct blockers',()=>{
 const entry={...e,shipment:{...e.shipment,cases:['A-570-909-229'],dutyStage:'cash_deposit' as const}},reference=setup().child.reference,r=run(entry,reference);assert.equal(r.expected,null);const groups=auditBlockers(r);assert(groups.shipment_data.some(f=>f.type==='adcvd_shipment'&&f.missing.includes('exporter')));assert(groups.evidence.some(f=>f.type==='adcvd_evidence'));assert.equal(groups.rule_support.length,0);assert(!r.findings.some(f=>f.type==='historical_coverage'));
 const facts={adcvd_scope_verified:true,adcvd_party_verified:true,adcvd_instructions_clear:true,adcvd_cases_complete:true},complete={...entry,shipment:{...entry.shipment,exporter:'SYNTHETIC EXPORTER'}},missing=run(complete,reference,[{...decision,facts}]);assert.equal(missing.expected,null);assert(auditBlockers(missing).historical_sources.some(f=>f.type==='adcvd_sources'));assert.equal(auditBlockers(missing).shipment_data.length,0);
 const final=run({...complete,shipment:{...complete.shipment,dutyStage:'final_assessment'}},reference,[{...decision,facts}]);assert.equal(final.expected,null);assert(auditBlockers(final).rule_support.some(f=>f.type==='adcvd_instructions'));assert(!final.findings.some(f=>f.type==='historical_coverage'));
});
