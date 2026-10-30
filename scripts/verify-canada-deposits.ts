/** Read-only actual retained public sources; fictional entries and fact decisions.
 * Independent expected amounts do not establish legal scope or refund eligibility. */
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{loadEnvConfig}from'@next/env';
import{createServiceClient}from'../lib/supabase/service';
import{parseAudit,auditTable,suggestMapping}from'../app/api/audits/input';
import{AUDIT_VERSION,defaultOptions}from'../app/api/audits/model';
import{evaluateAuditEntry,summarizeAudit}from'../app/api/audits/engine';
import{selectReferenceIds,loadAuditReferences,referenceExecutionCache,type AuditReference}from'../app/api/tariff/references/store';
import{referenceGroupEnd}from'../app/api/audits/shipment';
import{exportAudit}from'../app/api/audits/store';
import{parseCsv}from'../lib/catalogue/csv';
loadEnvConfig(process.cwd());
async function main(){
 const dir='scripts/test-fixtures/historical-audits/',csv=await readFile(dir+'canada-deposit-workflow-entries.csv','utf8'),gold=JSON.parse(await readFile(dir+'canada-deposit-workflow-expected.json','utf8'));
 assert.equal(gold.engineVersion,AUDIT_VERSION);
 const entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:false,standardCoverage:true,programExceptionsClear:true});
 assert.equal(entries.length,100);assert.deepEqual(entries[0].documents,['SYN-CADEP-1-DOC']);assert(entries.slice(0,81).every(e=>!e.errors.length));
 const db=createServiceClient(),ids=await selectReferenceIds(db,entries),cache=referenceExecutionCache(entries),refs:AuditReference[]=[];
 for(let start=0;start<entries.length;){const end=referenceGroupEnd(entries,start);refs.push(...await loadAuditReferences(db,entries.slice(start,end),ids,cache));start=end;}
 const initial=entries.map((e,i)=>evaluateAuditEntry(e,[],'FICTIONAL',[],false,null,refs[i],true,true));
 const reviewed=entries.map((entry,i)=>({entry,result:evaluateAuditEntry(entry,[],'FICTIONAL',gold.decisions,false,null,refs[i],true,true)}));
 assert.deepEqual(summarizeAudit(initial),gold.summary);assert.deepEqual(summarizeAudit(reviewed.map(r=>r.result)),gold.reviewedSummary);
 for(let i=0;i<100;i++){
  const r=reviewed[i].result;assert.equal(r.expected,gold.rows[i].reviewedExpected,'line '+(i+1)+' '+JSON.stringify(r.findings));assert.equal(r.difference,gold.rows[i].reviewedDifference);
  if(i<81){assert.equal(r.validation?.compiler,'historical-adcvd-deposits-v2');assert.equal(r.paymentStage,'cash_deposit');assert.equal(r.appliedHts,'4407110001');const amounts=r.components.filter(c=>c.id.startsWith('A-')||c.id.startsWith('C-')||c.id==='9903.01.10').map(c=>c.amount);assert.deepEqual(amounts,gold.rows[i].componentAmounts);
   for(const c of r.reference?.adcvd??[]){assert.equal(c.reviewCoverage?.indexMessages,c.caseNumber==='A122857'?80:95);assert.equal(c.reviewCoverage?.loadedDepositMessages,c.caseNumber==='A122857'?15:19);}
   if(i%3===0){const ad=r.components.find(c=>c.id==='A-122-857-001')!;assert.match(ad.explanation,/2025-07-29/);assert.equal(ad.sourceIds.filter(u=>u.includes('service-messages')).length,5);}
  }
 }
 const report=parseCsv(exportAudit({batch:{id:'FICTIONAL-CA-DEPOSITS'},rows:reviewed,decisions:gold.decisions,verified:true,resultRevision:1}),undefined,true);
 assert.equal(report.rows.length,100);for(let i=0;i<100;i++){assert.equal(report.rows[i].expected_duty_usd,gold.rows[i].reviewedExpected??'');assert.equal(report.rows[i].paid_minus_expected_usd,gold.rows[i].reviewedDifference??'');assert.equal(report.rows[i].declared_hts,entries[i].hts);}
 const browser={...gold.browserDecision};delete browser.usedExporter;delete browser.expected;
 const restored=evaluateAuditEntry(entries[84],[],'FICTIONAL',[...gold.decisions,browser],false,null,refs[84],true,true);
 assert.equal(restored.expected,gold.browserDecision.expected);assert.equal(entries[84].shipment?.exporter,undefined);
 console.log(JSON.stringify({actualSources:'CBP complete Canadian A122857/C122858 public indexes and all 34 deposit originals, dated USITC/Chapter99/actions',pinnedSources:ids.length,entries:100,initial:gold.summary,reviewed:gold.reviewedSummary,independentAmountsAndCsvVerified:true,missingExporterCorrectionVerified:true,referenceCacheBytes:cache.pdfRateBytes,sourceWrites:0,customerWrites:0,models:0,approvals:0,limitation:'Fictional qualifications, not actual savings or legal accuracy. Final assessments, unparsed messages and later timber Section232 coverage remain separate.'}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
