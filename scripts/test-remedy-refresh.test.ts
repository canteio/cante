import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { compileOfficialRemedySnapshot, parseCurrentChinaCoverage, resolveCurrentMetal232, fetchOfficialRemedySnapshot, withOfficialRemedyCache, REMEDY_URLS, type OfficialRemedySnapshot, type RemedyFacts } from "../lib/tariff/section232-live";
import { resolveCurrentSection301, resolveCurrentChina301 } from "../lib/tariff/section301";
import { parseRemedyFacts } from "../lib/tariff/bulk";
import { computeStackedDuty } from "../lib/tariff/stack";
import { parseDutyRate } from "../lib/tariff/duty-expression";
import { easternIsoDate } from "../lib/tariff/date";
const fixture=JSON.parse(gunzipSync(readFileSync("scripts/test-fixtures/tariff-remedies/usitc-2026-rev21.json.gz"),{maxOutputLength:12*1024*1024}).toString("utf8"));
let snapshot:OfficialRemedySnapshot;
const ordinary:RemedyFacts={standardCommercial:true,special232Claim:false,usMetalQualification:false,motorcycleUse:false,equipmentUse:false,other232Heading:"none"};
const bearing={hts:"8482.10.50.16",country:"CN",baseRate:.09};
test.before(()=>{snapshot={...compileOfficialRemedySnapshot(fixture.revision,fixture.notes,fixture.headings,"2026-10-18T04:30:00Z"),chinaCoverage:parseCurrentChinaCoverage(fixture.chinaText)};});
test("real source fixture establishes all eleven metal tables, four China lists and Note 52 exclusions",()=>{
  assert.equal(snapshot.status,"verified_structure",snapshot.issues.join(" "));
  assert.equal(Object.keys(snapshot.notes[16].lists).length,11);assert.equal(snapshot.notes[16].lists["(iii)"].includes("7208"),true);
  assert.equal(Object.keys(snapshot.chinaCoverage!).length,10460);assert.equal(snapshot.chinaCoverage!["84821050"],"9903.88.01");
  assert.equal(snapshot.notes[52].lists["(b)"].length,863);
});
test("changed operative law, extra clauses, missing tables and duplicate headings cannot be silently activated",()=>{
  const altered=compileOfficialRemedySnapshot(fixture.revision,fixture.notes.replace("at least 15 percent","at least 20 percent"),fixture.headings,"2026-10-18");assert.equal(altered.status,"pending_verification");assert.ok(altered.issues.some(s=>s.includes("operative text changed")));
  const duplicate=compileOfficialRemedySnapshot(fixture.revision,fixture.notes,[...fixture.headings,fixture.headings.find((h:{htsno:string})=>h.htsno==="9903.05.31")],"2026-10-18");assert.equal(duplicate.status,"pending_verification");
  assert.throws(()=>parseCurrentChinaCoverage("China Tariffs Last Updated today\n8501.31.40 bad-rate"),/Unrecognized/);
});
test("metal weight threshold, US metal qualification and the actual selected heading control stacking",()=>{
  assert.equal(resolveCurrentMetal232(snapshot,bearing).status,"needs_facts");
  const high=resolveCurrentMetal232(snapshot,{...bearing,facts:{...ordinary,metalWeightPercent:90}});assert.equal(high.heading,"9903.82.09");assert.equal(high.rate,.25);
  const low=resolveCurrentMetal232(snapshot,{...bearing,facts:{...ordinary,metalWeightPercent:14.99}});assert.equal(low.heading,"9903.82.03");
  const exact=resolveCurrentMetal232(snapshot,{...bearing,facts:{...ordinary,metalWeightPercent:15}});assert.equal(exact.rate,.25);
  const us=resolveCurrentMetal232(snapshot,{...bearing,facts:{...ordinary,metalWeightPercent:90,usMetalQualification:true}});assert.equal(us.heading,"9903.82.06");assert.equal(us.rate,.1);
  const surcharge=(section232:ReturnType<typeof resolveCurrentMetal232>)=>resolveCurrentSection301(snapshot,{...bearing,section232,facts:ordinary});
  assert.equal(surcharge(high).heading,"9903.05.90");assert.equal(surcharge(high).rate,0);
  assert.equal(surcharge(low).heading,"9903.05.31");assert.equal(surcharge(low).rate,.125);
});
test("zero-duty headings are checked against their published rate expression",()=>{
  const changed={...snapshot,headings:snapshot.headings.map(h=>h.htsno==="9903.82.03"?{...h,general:"The duty provided in the applicable subheading + 25%"}:h)};
  assert.equal(resolveCurrentMetal232(changed,{...bearing,facts:{...ordinary,metalWeightPercent:10}}).status,"pending_verification");
  const missing={...snapshot,headings:snapshot.headings.filter(h=>h.htsno!=="9903.05.90")};
  const metal=resolveCurrentMetal232(snapshot,{...bearing,facts:{...ordinary,metalWeightPercent:90}});
  assert.equal(resolveCurrentSection301(missing,{...bearing,section232:metal,facts:ordinary}).status,"pending_verification");
});
test("unknown qualifications and unsupported mobile industrial treatment remain unresolved",()=>{
  const metal=resolveCurrentMetal232(snapshot,{...bearing,country:"GB",facts:{...ordinary,metalWeightPercent:90}});assert.deepEqual(metal.missingFacts,["uk_metal_qualification"]);
  const known=resolveCurrentMetal232(snapshot,{...bearing,country:"GB",facts:{...ordinary,metalWeightPercent:90,ukMetalQualification:true}});assert.equal(known.heading,"9903.82.05");assert.equal(known.rate,.15);
  assert.throws(()=>parseRemedyFacts({standard_commercial:"maybe"}));assert.throws(()=>parseRemedyFacts({metal_weight_percent:"101"}));assert.equal(parseRemedyFacts({}),undefined);
});
test("China coverage must agree with the separately published reference, and changed rates are read from current headings",()=>{
  const standard=resolveCurrentChina301(snapshot,"8501.31.40.00");assert.equal(standard.rate,.25);
  const conflict={...snapshot,chinaCoverage:{...snapshot.chinaCoverage,"85013140":"9903.91.01"}};assert.equal(resolveCurrentChina301(conflict,"8501.31.40.00").status,"pending_verification");
  const changed={...snapshot,headings:snapshot.headings.map(h=>h.htsno==="9903.88.02"?{...h,general:"The duty provided in the applicable subheading + 30%"}:h)};assert.equal(resolveCurrentChina301(changed,"8501.31.40.00").rate,.30);
});
test("combined Section 301 rates subtract base duty and never become an extra full threshold",()=>{
  const section232=resolveCurrentMetal232(snapshot,{hts:"8501.31.40.00",country:"JP",baseRate:.04,facts:ordinary});
  const below=resolveCurrentSection301(snapshot,{hts:"8501.31.40.00",country:"JP",baseRate:.04,section232,facts:ordinary});assert.ok(Math.abs(below.rate!-.085)<1e-12);
  const above=resolveCurrentSection301(snapshot,{hts:"8501.31.40.00",country:"JP",baseRate:.15,section232,facts:ordinary});assert.equal(above.rate,0);
});
test("the actual engine uses current compiled rules without the stale Section 232 database",async()=>{
  const pub={htsCode:"8501.31.40.00",description:"Motor",units:["No."],general:parseDutyRate("4%"),special:parseDutyRate("Free (S)"),specialProgrammes:["S"],column2:parseDutyRate("35%"),additionalDuties:null,fetchedAt:new Date().toISOString()};
  const result=await computeStackedDuty({htsCode:pub.htsCode,countryOfOrigin:"CN",value:10000,importDate:easternIsoDate(),remedyFacts:ordinary},undefined,async()=>({status:"unflagged"}),async()=>new Set(),pub,snapshot);
  assert.equal(result?.totalAmount,4150);assert.equal(result.remedyRefresh?.status,"verified_structure");assert.equal(result.components.find(c=>c.measureId==="9903.05.31")?.amount,1250);
});
test("refresh failures and malformed government payloads never return a previous snapshot",async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response("down",{status:503});
  try{await assert.rejects(fetchOfficialRemedySnapshot(),/HTTP 503/);}finally{globalThis.fetch=original;}
  let calls=0;globalThis.fetch=async()=>Response.json({name:++calls===1?"A":"B"});
  try{await assert.rejects(fetchOfficialRemedySnapshot());}finally{globalThis.fetch=original;}
});

test("money rounds half cents exactly and combined components subtract the rounded base amount",async()=>{
  const {computeAdValoremAmount,computeDuty}=await import("../lib/tariff/duty-expression");
  assert.equal(computeAdValoremAmount(.2,.075),.02);assert.equal(computeDuty(parseDutyRate("7.5%"),{value:.2}).amount,.02);
  assert.equal(computeAdValoremAmount(.1,.05),.01);assert.equal(computeAdValoremAmount(Infinity,.1),null);
});
