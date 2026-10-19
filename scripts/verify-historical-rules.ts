import { mkdirSync,writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { compareHistoricalRules } from "../app/api/tariff/live-check/history";
import { lookupTariff } from "../lib/tariff/rates";
import { fetchOfficialRemedySnapshot } from "../lib/tariff/section232-live";
import type { LiveProduct,LiveSource } from "../app/api/tariff/live-check/check";
async function main(){
const products:LiveProduct[]=[{sku:"QA-MOTOR",hts:"8501.31.40.00",origin:"CN",customsValue:10000,quantity:null,unit:null,fictional:true},{sku:"QA-EXCLUSION-SCOPE",hts:"8479.90.95.91",origin:"CN",customsValue:10000,quantity:null,unit:null,fictional:true}];
const sources:LiveSource[]=[];
const snapshot=await fetchOfficialRemedySnapshot();const currentRows=new Map();for(const p of products)currentRows.set(p.hts,await lookupTariff(p.hts,{fresh:true}));
const result=await compareHistoricalRules({currentRevision:snapshot.revision,products,currentRows,currentHeadings:snapshot.headings,sources,progress:console.log});
if(result.status!=="compared")throw Error(result.issues.join(' '));
for(const s of sources){if(s.body!==null){const bytes=Buffer.from(s.body,s.bodyEncoding==='base64'?'base64':'utf8');if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw Error('Stored-byte hash mismatch');if(s.compression==='gzip'&&createHash('sha256').update(gunzipSync(bytes,{maxOutputLength:32*1024*1024})).digest('hex')!==s.originalSha256)throw Error('Original-byte hash mismatch');}}
mkdirSync('raw/historical-rules',{recursive:true});writeFileSync('raw/historical-rules/live-comparison.json',JSON.stringify({result,sources},null,2));
console.log(JSON.stringify({status:result.status,previous:result.previous?.name,current:result.current?.name,baseComparisons:result.baseChanges,legalChanges:result.legalChanges,headingChanges:result.headingChanges.length,documents:result.modifyingDocuments,candidateSkus:result.candidateSkus,issues:result.issues,sources:sources.length,retainedBytes:sources.reduce((n,s)=>n+Buffer.byteLength(s.body??''),0)},null,2));

}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
