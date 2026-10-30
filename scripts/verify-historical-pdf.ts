/** Fictional declarations, actual archived originals, independent cents oracle.
 * No customer writes, LLM calls or human-approval claims. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {loadAuditReferences,selectReferenceIds} from '../app/api/tariff/references/store';
import {evaluateAuditEntry} from '../app/api/audits/engine';
import type {AuditEntry} from '../app/api/audits/model';
loadEnvConfig(process.cwd());
async function main(){
 const db=createServiceClient(),expected=JSON.parse(await readFile('scripts/test-fixtures/historical-audits/official-pdf-expected.json','utf8'));
 const entries:AuditEntry[]=expected.cases.map(({date}:{date:string},i:number)=>({row:i+1,entry:`FICTIONAL-PDF-${i+1}`,line:'1',date,sku:'FICTIONAL-MOTOR',description:'Fictional declared motor, not a customer product',hts:expected.hts,origin:'CN',supplier:'',value:expected.customsValue,paid:expected.paid,basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{label:'FICTIONAL'}}));
 const references=await loadAuditReferences(db,entries,await selectReferenceIds(db,entries));
 const output=[];
 for(const [i,e] of entries.entries()){
  const ref=references[i],golden=expected.cases[i];assert.equal(ref.rate?.projection,'official-pdf-table-v1',`${e.date}: ${JSON.stringify(ref.gaps)}`);assert.equal(ref.rate.general,expected.base);assert(ref.rate.pdfPage);assert.equal(ref.release?.name,golden.edition);
  const result=evaluateAuditEntry(e,[],'FICTIONAL-PRODUCT',[],false,null,ref,true);
  assert.equal(result.expected,golden.chinaExpected,`${e.date}: ${JSON.stringify(result.findings)}`);
  if(result.expected!==null)assert.equal(result.difference,'10.00');else {assert(result.findings.some(f=>f.type==='historical_coverage'),'A withheld total must explain its missing treatment');for(const heading of golden.missingTreatment)assert(ref.chapter99.includes(heading));}
  const vn=evaluateAuditEntry({...e,origin:'VN'},[],'FICTIONAL-PRODUCT',[],false,null,ref,true);assert.equal(vn.expected,golden.vietnamExpected);if(vn.expected!==null)assert.equal(vn.difference,'260.00');
  const conflict=evaluateAuditEntry({...e,evidenceOrigin:'VN'},[],'FICTIONAL-PRODUCT',[],false,null,ref,true);assert.equal(conflict.expected,null);
  output.push({entryDate:e.date,edition:ref.release?.name,page:ref.rate.pdfPage,base:'4%',chinaExpected:result.expected,vietnamExpected:vn.expected,chapter99:ref.chapter99,footnotes:ref.rate.footnotes,reviewReasons:result.expected===null?result.findings.map(f=>f.reason):[]});
 }
 console.log(JSON.stringify({fictionalEntries:true,originals:'actual retained official PDF schedules and legal notes',independentArithmetic:true,writes:0,modelCalls:0,humanApprovalClaimed:false,cases:output,limitation:'Declared ordinary scope only; not comprehensive legal coverage or a customer ledger.'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
