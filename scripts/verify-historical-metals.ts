/** Actual retained originals; fictional shipment facts, read-only. */
import assert from 'node:assert/strict';import{loadEnvConfig}from'@next/env';import{createServiceClient}from'../lib/supabase/service';import{selectReferenceIds,loadAuditReferences,referenceExecutionCache}from'../app/api/tariff/references/store';import{evaluateAuditEntry}from'../app/api/audits/engine';import type{AuditEntry,FactDecision}from'../app/api/audits/model';
loadEnvConfig(process.cwd());
async function main(){
 const cases=[{hts:'7317005503',origin:'CN',expected:'1032.80',adcvd:true},{hts:'7317005503',origin:'CN',expected:'750.00'},{hts:'7317005503',origin:'VN',expected:'500.00'},{hts:'7317005503',origin:'GB',expected:'250.00',uk:true},{hts:'7317005503',origin:'CN',expected:'350.00',us:true}];
 const entries:AuditEntry[]=cases.map((c,i)=>({row:i+1,entry:'SYNTHETIC-METAL-'+i,line:'1',date:'2026-08-15',origin:c.origin,hts:c.hts,sku:'SYNTHETIC',description:'Fictional modern metal rate verification',supplier:'',value:'1000.00',paid:'0.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{synthetic:'true'},...(c.adcvd?{shipment:{cases:['A-570-909-229'],exporter:'Shanghai Yueda Nails Co., Ltd.',dutyStage:'cash_deposit' as const}}:{})}));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),references=await loadAuditReferences(db,entries,ids,referenceExecutionCache());
 for(const[i,entry]of entries.entries()){
  const c=cases[i],decision:FactDecision={row:entry.row,kind:'confirm_facts',note:'Fictional qualification evidence for arithmetic test',evidence:['SYNTHETIC-ONLY'],validFrom:'2026-06-01',validBefore:'2026-09-01',facts:{...(c.adcvd?{adcvd_scope_verified:true,adcvd_party_verified:true,adcvd_instructions_clear:true,adcvd_cases_complete:true}:{}),metal_special_claim:false,us_metal_qualified:!!c.us,...(c.origin==='GB'?{uk_metal_qualified:!!c.uk}:{})}},ref=references[i],result=evaluateAuditEntry(entry,[],'SYNTHETIC',[decision],false,null,ref,true,true);
  console.log(JSON.stringify({hts:entry.hts,origin:entry.origin,base:ref.rate?.general,lists:ref.metals?.lists,overlaps:ref.metals?.overlapExemptions,programIssues:ref.programs?.issues,chapter99:ref.chapter99,expected:c.expected,actual:result.expected,components:result.components.map(c=>({id:c.id,rate:c.rate,amount:c.amount})),issues:result.findings}));assert.equal(result.expected,c.expected);
 }
 console.log(JSON.stringify({passed:cases.length,source:'Actual retained official originals',customerWrites:0,approvals:0,models:0,limitation:'Fictional shipment qualification; not independent legal validation.'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
