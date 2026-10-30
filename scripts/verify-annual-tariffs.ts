/** Read-only linked-government-source verification. All declarations fictional. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadEnvConfig} from '@next/env';
import {createServiceClient} from '../lib/supabase/service';
import {selectReferenceIds,loadAuditReferences} from '../app/api/tariff/references/store';
import {evaluateAuditEntry,summarizeAudit} from '../app/api/audits/engine';
import type {AuditEntry} from '../app/api/audits/model';
loadEnvConfig(process.cwd());
async function main(){
 const expected=JSON.parse(await readFile('scripts/test-fixtures/historical-audits/official-annual-expected.json','utf8')),db=createServiceClient();
 const entries:AuditEntry[]=expected.years.map((year:number,i:number)=>({row:i+1,entry:`FICTIONAL-ANNUAL-${year}`,line:'1',date:`${year}-06-15`,sku:'FICTIONAL-MOTOR',description:'Fictional declared motor; not a customer product',hts:expected.hts,origin:'JP',supplier:'',value:expected.customsValue,paid:'100.00',basePaid:null,additionalPaid:null,quantity:null,unit:'',chapter99:[],documents:[],evidenceOrigin:'',evidenceHts:'',exclusion:'',errors:[],warnings:[],raw:{label:'FICTIONAL'}}));
 const ids=await selectReferenceIds(db,entries),references=await loadAuditReferences(db,entries,ids),results=entries.map((entry,i)=>evaluateAuditEntry(entry,[],'FICTIONAL-PRODUCT',[],false,null,references[i],true));
 for(const [i,result]of results.entries()){const annual=result.reference?.annual;assert.equal(annual?.status,'matched',`${entries[i].date}: ${JSON.stringify(result.findings)}`);assert.equal(annual.mfnRate,expected.rate);assert.equal(annual.baseDutyScenario?.amount,expected.baseScenario);assert.equal(annual.hts8,expected.hts.slice(0,8));assert.equal(annual.year,expected.years[i]);assert.equal(result.expected,expected.expectedTotal);assert.equal(result.difference,"60.00");assert.equal(result.validation?.compiler,"historical-ordinary-mfn-v1");}
 assert.equal(summarizeAudit(results).overpayment,'900.00');
 console.log(JSON.stringify({fictionalEntries:true,source:'Actual retained USITC annual originals',modelCalls:0,writes:0,approvedRulesCreated:0,pinnedSources:ids.length,cases:results.map(r=>({date:entries.find(e=>e.row===r.row)!.date,rate:r.reference!.annual!.mfnRate,baseScenario:r.reference!.annual!.baseDutyScenario!.amount,expectedTotal:r.expected})),limitation:'Dated ordinary-duty estimates on explicit standard scope and declared classification/origin. Special duties, claimed preferences/exclusions and refund eligibility are not established.'}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
