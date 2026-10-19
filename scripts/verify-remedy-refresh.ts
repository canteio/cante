/** Real official-source refresh and real engine; no models or customer-data writes. */
import "./load-env";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fetchOfficialRemedySnapshot, remedyHash, type RemedyFacts } from "../lib/tariff/section232-live";
import { computeStackedDuty } from "../lib/tariff/stack";
import { lookupTariff } from "../lib/tariff/rates";
import { easternIsoDate } from "../lib/tariff/date";
async function main(){
  const original=globalThis.fetch;let officialRequests=0,databaseReads=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(typeof input==="string"?input:input instanceof URL?input:input.url);const method=(init?.method??(input instanceof Request?input.method:"GET")).toUpperCase();
    if(url.hostname==="hts.usitc.gov")officialRequests++;
    else if(url.hostname.endsWith(".supabase.co")&&(method==="GET"||method==="HEAD"))databaseReads++;
    else throw Error(`Verification forbids ${method} ${url.hostname}${url.pathname}`);
    return original(input,init);
  };
  try{
    const snapshot=await fetchOfficialRemedySnapshot(AbortSignal.timeout(90000));
    assert.equal(snapshot.status,"verified_structure",snapshot.issues.join(" "));
    const ordinary:RemedyFacts={standardCommercial:true,special232Claim:false,other232Heading:"none",usMetalQualification:false,motorcycleUse:false,equipmentUse:false};
    const examples=[
      {name:"China motor, no metal-list match",code:"8501.31.40.00",country:"CN",facts:ordinary,expected:4150},
      {name:"China bearing, 90% applicable metal",code:"8482.10.50.16",country:"CN",facts:{...ordinary,metalWeightPercent:90},expected:5900},
      {name:"China bearing, below metal-weight threshold",code:"8482.10.50.16",country:"CN",facts:{...ordinary,metalWeightPercent:10},expected:4650},
      {name:"China bearing, verified qualifying U.S. metal",code:"8482.10.50.16",country:"CN",facts:{...ordinary,metalWeightPercent:90,usMetalQualification:true},expected:4400},
      {name:"Japan motor, combined base + Section 301 threshold",code:"8501.31.40.00",country:"JP",facts:ordinary,expected:1250},
      {name:"Missing bearing metal weight is withheld",code:"8482.10.50.16",country:"CN",facts:ordinary,expected:null},
    ];
    const results=[];
    for(const example of examples){
      const row=await lookupTariff(example.code,{fresh:true});assert(row);
      const result=await computeStackedDuty({htsCode:example.code,countryOfOrigin:example.country,value:10000,importDate:easternIsoDate(),remedyFacts:example.facts},undefined,undefined,undefined,row,snapshot);assert(result);
      results.push({...example,result});
      assert.equal(result.totalAmount,example.expected,`${example.name}: ${result.unresolvedMeasures.join(" ")}`);
      for(const component of result.components)if(component.ratePercent!==null&&component.amount!==null)assert.equal(Math.round(component.amount*100),Math.round(component.ratePercent*1000000));
    }
    const dir="raw/tariff-rule-update";await mkdir(dir,{recursive:true});
    const file=`${dir}/verified-${Date.now()}.json`;await writeFile(file,JSON.stringify({checkedAt:new Date().toISOString(),inputDisclosure:"Hypothetical shipment values and explicit qualification assertions; live official rates, no real customer facts.",snapshot,results,officialRequests,databaseReads,customerWrites:0,llmCalls:0},null,2));
    console.log(JSON.stringify({file,revision:snapshot.revision,status:snapshot.status,chinaCoverageRows:Object.keys(snapshot.chinaCoverage??{}).length,officialRequests,databaseReads,customerWrites:0,llmCalls:0,cases:results.map(r=>({name:r.name,amount:r.result.totalAmount,components:r.result.components.map(c=>({heading:c.measureId,amount:c.amount})),unresolved:r.result.unresolvedMeasures}))},null,2));
  }finally{globalThis.fetch=original;}
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
