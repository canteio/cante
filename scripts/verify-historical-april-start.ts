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
import {referenceEntries} from '../app/api/audits/store';
import {evaluateAuditEntry} from '../app/api/audits/engine';
loadEnvConfig(process.cwd());
async function main(){
 const dir='scripts/test-fixtures/historical-audits/',csv=readFileSync(dir+'april-start-workflow-entries.csv','utf8'),golden=JSON.parse(readFileSync(dir+'april-start-workflow-expected.json','utf8'));
 const options={...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true,programExceptionsClear:true};
 const entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),options);assert.equal(entries.length,14);assert(entries.every(e=>!e.errors.length));
 const scoped=referenceEntries(entries,golden.decisions);const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache(),references=[];let failed=0;for(let start=0;start<entries.length;){const end=referenceGroupEnd(scoped,start);references.push(...await loadAuditReferences(db,scoped.slice(start,end),ids,cache));start=end;}
 for(const [i,e] of entries.entries()){
  const ref=references[i],decision=golden.decisions[i] as FactDecision,r=evaluateAuditEntry(e,[],'SYNTHETIC',[decision],false,null,ref,true,true);
  console.log(JSON.stringify({row:e.row,date:e.date,edition:ref.release?.name,expected:golden.rows[i].reviewedExpected,actual:r.expected,indiaProof:!!ref.metals?.earlier?.indiaProof,components:r.components.map(m=>({id:m.id,rate:m.rate,basis:m.basis,assessedValue:m.assessedValue,amount:m.amount})),exemptions:r.chapter99?.exemptions,issues:r.expected===null?r.findings:[]}));
  try{assert.equal(r.expected,golden.rows[i].reviewedExpected);assert.equal(r.difference,golden.rows[i].reviewedDifference);if([3,5,8,9,10,14].includes(e.row))assert(r.components.some(m=>m.sourceIds.some(url=>url.includes('/2025-06063.pdf')))||r.reference?.sources.some(s=>s.url.includes('/2025-06063.pdf')));if(e.row===8)assert(r.chapter99?.notApplicable?.some(x=>x.heading==='9903.01.25'));if(e.row===9)assert.equal(r.components.find(m=>m.id==='9903.01.25')?.amount,'100.00');if(e.row===13)assert(r.findings.some(f=>f.type==='chapter99_boundary'));if(e.row===14)assert(r.findings.some(f=>f.type==='chapter99_claim_mismatch'));}catch(error){failed++;console.error(String(error));}
 }
 console.log(JSON.stringify({cases:entries.length,failed,scope:'Retained original government sources and fictional qualifications; monetary audit, not customs filing or human legal approval.',customerWrites:0,approvals:0,modelCalls:0}));if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
