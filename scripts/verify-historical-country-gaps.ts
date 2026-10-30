/** Read-only original-source acceptance. Fictional shipments, independent hand
 * totals, no legal approvals, customer writes or model calls. */
import assert from'node:assert/strict';import{loadEnvConfig}from'@next/env';import{createServiceClient}from'../lib/supabase/service';
import{selectReferenceIds,loadAuditReferences,referenceExecutionCache}from'../app/api/tariff/references/store';import{evaluateAuditEntry}from'../app/api/audits/engine';import type{AuditEntry}from'../app/api/audits/model';
loadEnvConfig(process.cwd());
async function main(){
 // Korea's original August 7 additional rate was 15% (2025-15010 Annex I),
 // before November 14 combined treatment: $40 base + $150 = $190.
 const cases=[['2025-09-15','DK','150.00'],['2026-08-15','ES','100.00'],['2025-09-15','CH','430.00'],['2025-12-15','CH','150.00'],['2025-09-15','LI','190.00'],['2025-12-15','LI','150.00'],['2025-08-04','VN','140.00'],['2025-08-15','JP','150.00'],['2025-09-15','KR','190.00'],['2025-12-15','KR','150.00'],['2025-09-15','IN','540.00'],['2026-02-15','IN','290.00']];
 const entries:AuditEntry[]=cases.map(([date,origin],i)=>({row:i+1,entry:'SYNTHETIC-COUNTRY-'+(i+1),line:'1',date,origin,hts:'8501314000',sku:'SYNTHETIC',description:'Fictional dated country calculation test',supplier:'',value:'1000.00',paid:'0.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{synthetic:'true'}}));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache();
 for(const[i,entry]of entries.entries()){const[ref]=await loadAuditReferences(db,[entry],ids,cache),result=evaluateAuditEntry(entry,[],'SYNTHETIC',[],false,null,ref,true,true);console.log(JSON.stringify({date:entry.date,origin:entry.origin,expected:cases[i][2],actual:result.expected,issues:ref.programs?.issues}));assert.equal(result.expected,cases[i][2],JSON.stringify(result.findings));}
 console.log(JSON.stringify({passed:cases.length,source:'Actual retained official originals',customerWrites:0,models:0,approvals:0,limitation:'Selected ordinary-commercial cases; not independent legal validation.'}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
