/** Real retained government sources, fictional entries, hand-entered expected
 * amounts. Read-only; never approves rules or writes customer workspaces. */
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';import {selectReferenceIds,loadAuditReferences,referenceExecutionCache,type AuditReference} from '../app/api/tariff/references/store';
import {parseAudit,auditTable,suggestMapping} from '../app/api/audits/input';import {defaultOptions,factDecisionSchema} from '../app/api/audits/model';import {evaluateAuditEntry,summarizeAudit} from '../app/api/audits/engine';import {exportAudit} from '../app/api/audits/store';import {parseCsv} from '../lib/catalogue/csv';
loadEnvConfig(process.cwd());
async function main(){
 const started=Date.now();
 const dir='scripts/test-fixtures/historical-audits/',csv=await readFile(dir+'chapter99-history-entries.csv','utf8'),golden=JSON.parse(await readFile(dir+'chapter99-history-expected.json','utf8'));
 const options={...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true,programExceptionsClear:true},entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),options),db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache(),refs:AuditReference[]=[];
 // Exactly the worker's bounded contiguous date-month chunks; shared originals
 // are hash-verified and held only in its bounded request-local execution cache.
 for(let i=0;i<entries.length;){let end=i+1;while(end<entries.length&&end-i<25&&entries[end].date.slice(0,7)===entries[i].date.slice(0,7))end++;const groupStarted=Date.now();refs.push(...await loadAuditReferences(db,entries.slice(i,end),ids,cache));console.log(JSON.stringify({phase:'sources',through:end,elapsedMs:Date.now()-groupStarted,release:refs.at(-1)?.release?.name}));i=end;}
 const decisions=golden.decisions.map((d:unknown)=>factDecisionSchema.parse(d)),initial=entries.map((e,i)=>evaluateAuditEntry(e,[],'FICTIONAL-PRODUCT',[],false,null,refs[i],true,true)),rows=entries.map((entry,i)=>({entry,result:evaluateAuditEntry(entry,[],'FICTIONAL-PRODUCT',decisions,false,null,refs[i],true,true)}));
 await writeFile('/tmp/cante-chapter99-history-reference-cache.json',JSON.stringify({label:'Fictional entries; parsed retained real official references for diagnostic replay only, not a provenance substitute.',ids,entries,refs}),{mode:0o600});
 assert.equal(entries.length,120);const failures:string[]=[];
 for(const [i,{entry,result}]of rows.entries()){const expected=golden.rows[i];try{assert.equal(entry.entry,expected.entry);assert.equal(initial[i].expected,expected.initialExpected,`${expected.cohort} initial: ${JSON.stringify(initial[i].findings)}`);assert.equal(result.expected,expected.reviewedExpected,`${expected.cohort} reviewed: ${JSON.stringify(result.findings)}`);assert.equal(result.difference,expected.reviewedDifference,expected.cohort);if(result.expected!==null)assert.equal(result.validation?.kind,'cante_validated');}catch(error){failures.push(error instanceof Error?error.message:String(error));}}
 assert.deepEqual(failures,[],failures.join('\n'));
 const out=parseCsv(exportAudit({batch:{id:'FICTIONAL-HISTORY'},rows,decisions,verified:true,resultRevision:1}),undefined,true);assert.equal(out.rows.length,120);out.rows.forEach((r,i)=>assert.equal(r.expected_duty_usd,golden.rows[i].reviewedExpected??''));
 // Independent low-base combined-rate goldens against those same pinned real
 // editions. Origin changes require fresh scoped references, never reused proofs.
 const combinedCases=[['2025-09-15','DE','150.00'],['2026-08-15','DE','100.00'],['2026-08-15','JP','125.00'],['2026-08-15','KR','125.00']];
 for(const [date,origin,expected]of combinedCases){const entry={...entries[0],date,origin,hts:'8501314000',value:'1000.00',chapter99:[],exclusion:'',errors:[],warnings:[]},[reference]=await loadAuditReferences(db,[entry],ids,cache),result=evaluateAuditEntry(entry,[],'FICTIONAL-COMBINED',[],false,null,reference,true,true);assert.equal(result.expected,expected,`${origin} ${date}: ${JSON.stringify(result.findings)}`);}
 console.log(JSON.stringify({source:'Actual retained USITC/USTR/CBP originals',entries:120,combinedRateCases:combinedCases.length,years:[2019,2020,2021,2022,2023,2024,2025,2026],initial:summarizeAudit(initial),reviewed:summarizeAudit(rows.map(r=>r.result)),pinnedSources:ids.length,elapsedMs:Date.now()-started,exportRows:out.rows.length,models:0,writes:0,humanApprovals:0,limitation:'Selected ordinary-commercial scopes only; synthetic qualification and independent hand arithmetic are not legal validation.'}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
