/** Fictional entries; actual immutable USITC/USTR originals. No customer writes,
 * rule approval or LLM calls. Independent integer arithmetic is the oracle. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parseAudit,auditTable,suggestMapping} from "../app/api/audits/input";
import {defaultOptions} from "../app/api/audits/model";
import { loadEnvConfig } from "@next/env";
import { createServiceClient } from "../lib/supabase/service";
import { selectReferenceIds,loadAuditReferences } from "../app/api/tariff/references/store";
import { evaluateAuditEntry,summarizeAudit } from "../app/api/audits/engine";
import type { AuditEntry } from "../app/api/audits/model";
loadEnvConfig(process.cwd());
async function main(){
 const db=createServiceClient();
 const entry:AuditEntry={row:1,entry:"FICTIONAL-REFERENCE-1",line:"1",date:"2024-02-15",sku:"FICTIONAL-MOTOR",description:"Synthetic entry, declared classification and origin",hts:"8501314000",origin:"CN",supplier:"Fictional supplier",value:"1000.00",paid:"300.00",basePaid:null,additionalPaid:null,quantity:null,unit:"",chapter99:[],documents:["FICTIONAL-DOC"],evidenceOrigin:"",evidenceHts:"",exclusion:"",errors:[],warnings:[],raw:{label:"FICTIONAL"}};
 const scopes=[entry,{...entry,date:"2023-05-01"}];
 const refs=await loadAuditReferences(db,scopes,await selectReferenceIds(db,scopes));
 for(const ref of refs){assert(ref.contract,"Actual original publications must establish the historical contract");assert.equal(ref.rate?.general,"4%");assert(ref.contract.measures.some(m=>m.heading==='9903.88.02'&&m.hts8.includes("85013140")));}
 const cases=[{origin:"CN",paid:"300.00",expected:"290.00",difference:"10.00"},{origin:"CN",paid:"200.00",expected:"290.00",difference:"-90.00"},{origin:"CN",paid:"290.00",expected:"290.00",difference:"0.00"},{origin:"VN",paid:"300.00",expected:"40.00",difference:"260.00"}];
 for(const [i,c] of cases.entries())for(const [j,ref] of refs.entries()){
  const result=evaluateAuditEntry({...entry,...c,date:scopes[j].date},[],"FICTIONAL-PRODUCT",[],false,null,ref,true);
  assert.equal(result.expected,c.expected,JSON.stringify(result.findings));assert.equal(result.difference,c.difference);assert.equal(result.validation?.kind,"cante_validated");assert.equal(result.components.length,c.origin==="CN"?2:1);
  // Independent hand formula: $1,000 x (4% + China-only 25%).
  assert.equal(Number(result.expected)*100,100000*(4+(c.origin==="CN"?25:0))/100);
 }
 for(const patch of [{exclusion:"9903.88.67"},{date:"2022-01-01"},{origin:"RU"},{chapter99:["9903.88.67"]},{evidenceOrigin:"VN"}])assert.equal(evaluateAuditEntry({...entry,...patch},[],"FICTIONAL-PRODUCT",[],false,null,refs[0],true).expected,null,JSON.stringify(patch));
 assert.equal(evaluateAuditEntry(entry,[],"FICTIONAL-PRODUCT",[],false,null,refs[0],false).expected,null);
 const csv=await readFile("scripts/test-fixtures/historical-audits/official-reference-entries.csv","utf8");
 const expected=JSON.parse(await readFile("scripts/test-fixtures/historical-audits/official-reference-expected.json","utf8"));
 const entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,standardCoverage:true});
 const allReferences=await loadAuditReferences(db,entries,await selectReferenceIds(db,entries));
 const results=entries.map((entry,i)=>evaluateAuditEntry(entry,[],"FICTIONAL-PRODUCT",[],false,null,allReferences[i],true));
 results.forEach((result,i)=>{assert.equal(result.expected,expected.rows[i].expected,`Line ${i+1}`);assert.equal(result.difference,expected.rows[i].difference,`Line ${i+1}`);});
 assert.deepEqual(summarizeAudit(results),{...expected.summary,discrepancies:70});
 console.log(JSON.stringify({source:"actual retained original government publications",entries:"fictional",independentGoldens:8,fullFixtureLines:120,fixtureSummary:summarizeAudit(results),unresolvedGuards:6,humanApprovalClaimed:false,writes:0,releases:refs.map(r=>r.release?.name),code:entry.hts,base:"4%",china301:"25%",limitation:"Narrow declared scope only. Not a customer ledger or proof of complete historical legal accuracy."}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
