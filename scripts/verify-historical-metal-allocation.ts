/** Retained official originals; explicitly fictional entry facts. No writes,
 * approvals, model calls or claim of independent legal/financial validation. */
import assert from'node:assert/strict';import{loadEnvConfig}from'@next/env';import{createServiceClient}from'../lib/supabase/service';
import{selectReferenceIds,loadAuditReferences,referenceExecutionCache}from'../app/api/tariff/references/store';import{evaluateAuditEntry}from'../app/api/audits/engine';import type{AuditEntry,FactDecision}from'../app/api/audits/model';
loadEnvConfig(process.cwd());
async function main(){
 const cases=[
  {date:'2026-03-15',origin:'CN',expected:'670.00',steel:'800.00',aluminum:'100.00',copper:'50.00'},
  {date:'2026-03-15',origin:'VN',expected:'420.00',steel:'800.00'},
  {date:'2026-03-15',origin:'GB',expected:'220.00',steel:'800.00'},
  {date:'2026-03-15',origin:'CA',expected:'420.00',steel:'800.00'},
  {date:'2026-03-15',origin:'IN',expected:'420.00',steel:'800.00'},
  {date:'2026-03-15',origin:'CN',expected:'719.00',hts:'7614105000',steel:'100.00',aluminum:'800.00',copper:'50.00'},
  {date:'2026-03-15',origin:'CN',expected:'2299.00',hts:'7614105000',aluminum:'800.00',russian:true},
  {date:'2025-06-15',origin:'CN',expected:'870.00',steel:'800.00',aluminum:'100.00',copper:'50.00'},
  {date:'2025-06-15',origin:'CN',expected:'870.00',steel:'800.00'},
  {date:'2026-03-15',origin:'CN',expected:'670.00',steel:'800.00'},
  {date:'2026-02-24',time:'05:00:59',origin:'CN',expected:'650.00',steel:'800.00'},
  {date:'2026-02-24',time:'05:01:00',origin:'CN',expected:'670.00',steel:'800.00'},
 ];
 const entries:AuditEntry[]=cases.map((c,i)=>({row:i+1,entry:'SYNTHETIC-METAL-ALLOCATION-'+(i+1),line:'1',date:c.date,origin:c.origin,hts:c.hts??'7317005503',sku:'SYNTHETIC',description:'Fictional content allocation verification',supplier:'',value:'1000.00',paid:'1000.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{synthetic:'true'},shipment:{...(c.steel?{steelValue:c.steel}:{}),...(c.aluminum?{aluminumValue:c.aluminum}:{}),...(c.copper?{copperValue:c.copper}:{}),...(c.time?{entryTimestamp:c.date+'T'+c.time+'Z'}:{})}}));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache();
 for(const[i,e]of entries.entries()){
  const[ref]=await loadAuditReferences(db,[e],ids,cache),c=cases[i],decision:FactDecision={row:e.row,kind:'confirm_facts',note:'SYNTHETIC material definition and separately evidenced valuations; no real shipment or approval.',evidence:['SYNTHETIC-METAL-ALLOCATION-EVIDENCE'],validFrom:e.date,validBefore:e.date<'2026-01-01'?'2026-01-01':'2026-04-06',facts:{metal_special_claim:false,content_values_verified:true,...(e.hts.startsWith('76')?{aluminum_derivative_covered:true,russian_aluminum_clear:!c.russian,russian_aluminum_subject:!!c.russian}:{steel_derivative_covered:true})}},r=evaluateAuditEntry(e,[],'SYNTHETIC',[decision],false,null,ref,true,true);
  console.log(JSON.stringify({row:e.row,date:e.date,origin:e.origin,edition:ref.release?.name,expected:c.expected,actual:r.expected,allocationProof:ref.metals?.earlier?.section122Proof,components:r.components.map(m=>({id:m.id,basis:m.basis,assessedValue:m.assessedValue,amount:m.amount})),issues:r.expected===null?r.findings:[]}));assert.equal(r.expected,c.expected);
 }
 console.log(JSON.stringify({passed:cases.length,source:'Retained government originals; fictional qualifications',writes:0,models:0,approvals:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
