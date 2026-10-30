/** Retained official annual/code-key/field/GN3 originals, fictional declarations
 * and independent hand arithmetic. Read-only; no models, approvals or tenants. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {selectReferenceIds,loadAuditReferences,referenceExecutionCache} from '../app/api/tariff/references/store';
import {auditTable,parseAudit,suggestMapping} from '../app/api/audits/input';
import {defaultOptions} from '../app/api/audits/model';
import {referenceEntries,exportAudit} from '../app/api/audits/store';
import {referenceGroupEnd} from '../app/api/audits/shipment';
import {evaluateAuditEntry,summarizeAudit} from '../app/api/audits/engine';
loadEnvConfig(process.cwd());
async function main(){
 const dir='scripts/test-fixtures/historical-audits/',csv=readFileSync(dir+'annual-quantity-workflow-entries.csv','utf8'),gold=JSON.parse(readFileSync(dir+'annual-quantity-workflow-expected.json','utf8')),entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true});assert.equal(entries.length,21);assert(entries.every(e=>e.documents.length===1));assert(entries.every(e=>!e.errors.length),JSON.stringify(entries.flatMap(e=>e.errors)));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache(),references:import('../app/api/tariff/references/store').AuditReference[]=[];
 for(let start=0;start<entries.length;){const end=referenceGroupEnd(entries,start);references.push(...await loadAuditReferences(db,entries.slice(start,end),ids,cache));start=end;}
 const initial=entries.map((e,i)=>evaluateAuditEntry(e,[],'SYNTHETIC-PRODUCT',[],false,null,references[i],true)),scoped=referenceEntries(entries,gold.decisions),reviewedReferences:import('../app/api/tariff/references/store').AuditReference[]=[];
 for(let start=0;start<entries.length;){const end=referenceGroupEnd(scoped,start);reviewedReferences.push(...await loadAuditReferences(db,scoped.slice(start,end),ids,cache));start=end;}
 let failed=0;const rows=entries.map((entry,i)=>({entry,result:evaluateAuditEntry(entry,[],'SYNTHETIC-PRODUCT',gold.decisions,false,null,reviewedReferences[i],true)}));
 for(const[i,{entry,result}]of rows.entries()){console.log(JSON.stringify({row:entry.row,method:references[i].annual?.row?.rateType,publishedRate:references[i].annual?.row?.textRate,initial:initial[i].expected,reviewed:result.expected,quantities:result.components[0]?.quantityInputs,issues:result.expected===null?result.findings:[]}));try{assert.equal(initial[i].expected,gold.rows[i].initialExpected);assert.equal(initial[i].difference,gold.rows[i].initialDifference);assert.equal(result.expected,gold.rows[i].reviewedExpected);assert.equal(result.difference,gold.rows[i].reviewedDifference);if(entry.row>=20){const a=result.reference?.annual;assert(a?.scheduleCorroboration);assert.equal(a.row?.specific,'0.01');assert.equal(a.row?.other,'0.13');assert.equal(a.row?.adValorem,'0.06');assert.equal(a.scheduleCorroboration.originals.length,2);assert.equal(a.scheduleCorroboration.reconciledFields.length,3);assert(a.scheduleCorroboration.sourceIds.every(id=>result.reference!.sources.some(s=>s.id===id)));assert(a.scheduleCorroboration.dateBasis.includes('not used as legal effective dates'));}if(result.expected!==null){assert.equal(result.validation?.compiler,entry.row>=20?'historical-ordinary-annual-v2':'historical-ordinary-quantity-v1');assert(result.components[0].sourceIds.includes('https://dataweb.usitc.gov/assets/content/annual-tariffs/td-fields.pdf'));}}catch(e){failed++;console.error(String(e));}}
 assert.deepEqual(summarizeAudit(initial),gold.summary);assert.deepEqual(summarizeAudit(rows.map(r=>r.result)),gold.reviewedSummary);const report=exportAudit({batch:{id:'SYNTHETIC-ANNUAL-QUANTITY'},rows,decisions:gold.decisions,verified:true,resultRevision:4});assert(report.includes('quantityInputs')&&report.includes('td-fields.pdf')&&report.includes('scheduleCorroboration')&&report.includes('historical-ordinary-annual-v2'));
 console.log(JSON.stringify({cases:rows.length,failed,pinnedSources:ids.length,customerWrites:0,models:0,approvals:0,limitation:'Declared uniform legal-line classification/origin and ordinary customs-duty scope; statistical suffix and qualifications are not independently determined. Excise tax is excluded.'}));if(failed)process.exitCode=1;
}main().catch(e=>{console.error(e);process.exitCode=1});
