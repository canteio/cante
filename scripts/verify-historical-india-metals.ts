/** Real retained originals and hand-calculated goldens on fictional shipments.
 * Read-only: no workspace writes, model calls, approvals or legal conclusions. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {selectReferenceIds,loadAuditReferences,referenceExecutionCache} from '../app/api/tariff/references/store';
import {auditTable,parseAudit,suggestMapping} from '../app/api/audits/input';
import {defaultOptions,type FactDecision} from '../app/api/audits/model';
import {referenceGroupEnd} from '../app/api/audits/shipment';
import {evaluateAuditEntry} from '../app/api/audits/engine';
loadEnvConfig(process.cwd());
async function main(){
 const dir='scripts/test-fixtures/historical-audits/',csv=readFileSync(dir+'india-metal-workflow-entries.csv','utf8'),golden=JSON.parse(readFileSync(dir+'india-metal-workflow-expected.json','utf8'));
 const options={...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true,programExceptionsClear:true};
 const entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),options);assert.equal(entries.length,16);assert(entries.every(e=>!e.errors.length));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache(),references=[];let failed=0;for(let start=0;start<entries.length;){const end=referenceGroupEnd(entries,start);references.push(...await loadAuditReferences(db,entries.slice(start,end),ids,cache));start=end;}
 for(const [i,e] of entries.entries()){
  const ref=references[i],decision=golden.decisions[i] as FactDecision,r=evaluateAuditEntry(e,[],'SYNTHETIC',[decision],false,null,ref,true,true);
  console.log(JSON.stringify({row:e.row,date:e.date,edition:ref.release?.name,expected:golden.rows[i].reviewedExpected,actual:r.expected,indiaProof:!!ref.metals?.earlier?.indiaProof,components:r.components.map(m=>({id:m.id,rate:m.rate,basis:m.basis,assessedValue:m.assessedValue,amount:m.amount})),exemptions:r.chapter99?.exemptions,issues:r.expected===null?r.findings:[]}));
  try{assert.equal(r.expected,golden.rows[i].reviewedExpected);assert.equal(r.difference,golden.rows[i].reviewedDifference);if(e.chapter99.includes('9903.01.87')&&r.expected!==null&&![7,12].includes(e.row)){assert.equal(r.chapter99?.unresolved.length,0);assert(r.chapter99?.exemptions?.some(x=>x.heading==='9903.01.87'));}if([7,12].includes(e.row)){assert(r.chapter99?.notApplicable?.some(x=>x.heading==='9903.01.87'));assert(r.findings.some(f=>f.type==='chapter99_claim_mismatch'));}if(e.row===3)assert.equal(r.components.find(m=>m.id==='9903.01.84')?.assessedValue,'100.00');}catch(error){failed++;console.error(String(error));}
 }
 console.log(JSON.stringify({cases:entries.length,failed,scope:'Retained original government sources and fictional qualifications; monetary audit, not customs filing or human legal approval.',customerWrites:0,approvals:0,modelCalls:0}));if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
