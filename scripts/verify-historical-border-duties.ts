/** Read-only original-source acceptance; fictional non-preferential motors.
 * No government rate, origin, energy/potash or USMCA qualification is invented. */
import assert from'node:assert/strict';import{loadEnvConfig}from'@next/env';import{createServiceClient}from'../lib/supabase/service';import{selectReferenceIds,loadAuditReferences,referenceExecutionCache}from'../app/api/tariff/references/store';import{evaluateAuditEntry}from'../app/api/audits/engine';import type{AuditEntry,FactDecision}from'../app/api/audits/model';
loadEnvConfig(process.cwd());
async function main(){
 // Actual 2026 Note 52 rows 9903.05.29 / .55 each add 10%; the old
 // 35% / 25% IEEPA charges terminated and must never be carried forward.
 const cases=[['2025-02-15','CA','40.00'],['2025-03-15','CA','290.00'],['2025-09-15','CA','390.00'],['2025-03-15','MX','290.00'],['2025-09-15','MX','290.00'],['2026-03-15','CA','140.00'],['2026-03-15','MX','140.00'],['2026-08-15','CA','140.00'],['2026-08-15','MX','140.00']],entries:AuditEntry[]=cases.map(([date,origin],i)=>({row:i+1,entry:'SYNTHETIC-BORDER-'+i,line:'1',date,origin,hts:'8501314000',sku:'SYNTHETIC',description:'Fictional ordinary nonpreferential motor',supplier:'',value:'1000.00',paid:'0.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{synthetic:'true'}})),db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache();
 for(const[i,e]of entries.entries()){
  const [ref]=await loadAuditReferences(db,[e],ids,cache),decision:FactDecision={row:e.row,kind:'confirm_facts',note:'SYNTHETIC: ordinary non-energy, non-potash, non-USMCA scope; no transshipment or special treatment.',evidence:['SYNTHETIC-SCOPE-EVIDENCE'],validFrom:'2025-01-01',validBefore:'2027-01-01',facts:{border_exceptions_clear:true}},initial=evaluateAuditEntry(e,[],'SYNTHETIC',[],false,null,ref,true,true),r=evaluateAuditEntry(e,[],'SYNTHETIC',[decision],false,null,ref,true,true);
  console.log(JSON.stringify({date:e.date,origin:e.origin,expected:cases[i][2],actual:r.expected,issues:ref.programs?.issues,components:r.components.map(c=>({id:c.id,rate:c.rate,amount:c.amount}))}));assert.equal(r.expected,cases[i][2],JSON.stringify(r.findings));if(e.date>='2025-03-04'&&e.date<'2026-02-24')assert.equal(initial.expected,null,'Border exception facts must not come from the generic import checkbox.');
 }
 console.log(JSON.stringify({passed:cases.length,source:'Actual retained official originals',customerWrites:0,models:0,approvals:0,limitation:'Selected ordinary non-preferential scope; shipment evidence is fictional. No USMCA qualification or legal validation.'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
