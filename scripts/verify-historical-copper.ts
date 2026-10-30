/** Real retained originals and hand-calculated goldens on fictional shipments.
 * Read-only: no workspace writes, model calls, approvals or legal conclusions. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {selectReferenceIds,loadAuditReferences,referenceExecutionCache} from '../app/api/tariff/references/store';
import {auditTable,parseAudit,suggestMapping} from '../app/api/audits/input';
import {defaultOptions,type FactDecision} from '../app/api/audits/model';
import {evaluateAuditEntry} from '../app/api/audits/engine';
loadEnvConfig(process.cwd());
async function main(){
 const dir='scripts/test-fixtures/historical-audits/',csv=readFileSync(dir+'copper-workflow-entries.csv','utf8'),golden=JSON.parse(readFileSync(dir+'copper-workflow-expected.json','utf8'));
 const options={...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true,programExceptionsClear:true};
 const entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),options);assert.equal(entries.length,18);assert(entries.every(e=>!e.errors.length));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache();let failed=0;
 for(const [i,e] of entries.entries()){
  const [ref]=await loadAuditReferences(db,[e],ids,cache),decision=golden.decisions[i] as FactDecision,r=evaluateAuditEntry(e,[],'SYNTHETIC',[decision],false,null,ref,true,true);
  console.log(JSON.stringify({row:e.row,date:e.date,origin:e.origin,edition:ref.release?.name,expected:golden.rows[i].reviewedExpected,actual:r.expected,copperScope:ref.metals?.earlier?.copper,components:r.components.map(m=>({id:m.id,rate:m.rate,basis:m.basis,assessedValue:m.assessedValue,quantity:m.quantity,unit:m.unit,amount:m.amount})),findings:r.expected===null?r.findings:[]}));
  try{assert.equal(r.expected,golden.rows[i].reviewedExpected);assert.equal(r.difference,golden.rows[i].reviewedDifference);if(r.expected!==null){const cu=r.components.find(m=>m.id==='9903.78.01');if(e.row===16){assert.equal(cu?.quantity,null);assert.match(cu!.explanation,/kilograms were not supplied/);}else if(cu&&e.shipment?.copperQuantityKg)assert.equal(cu.quantity,e.shipment.copperQuantityKg);const remainder=r.components.find(m=>m.id==='9903.78.02');if(remainder&&e.row!==15)assert.notEqual(remainder.assessedValue,null);if(e.row===11)assert.equal(r.components.find(m=>m.id==='9903.01.25')?.assessedValue,'100.00');}}catch(error){failed++;console.error(String(error));}
 }
 console.log(JSON.stringify({cases:entries.length,failed,scope:'Retained original government sources and fictional qualifications; monetary audit, not customs filing or human legal approval.',customerWrites:0,approvals:0,modelCalls:0}));if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
