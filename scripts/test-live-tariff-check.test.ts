import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { parseLiveProducts, verifyBaseMath } from "../app/api/tariff/live-check/check";
import { lookupTariff, quoteDuty, resetTariffCacheForTests } from "../lib/tariff/rates";

test("actual example input ignores invented baseline rates and annualizes values exactly", () => {
  const products = parseLiveProducts(readFileSync("public/examples/equipment-demo/products.csv", "utf8"));
  assert.equal(products.length,50); assert.equal(products[0].customsValue,2775000); assert.equal(products[0].fictional,true);
  assert.equal("baselineBps" in products[0], false);
  assert.deepEqual(parseLiveProducts("sku,hts_code,origin_country,annual_customs_value_usd\nA,8501104060,China,10000.01")[0], { sku:"A",hts:"8501.10.40.60",origin:"CN",customsValue:10000.01,quantity:null,unit:null,fictional:false });
});
test("reject malformed codes, duplicate identities and ambiguous values", () => {
  for (const row of ["A,85011040,CN,100", "A,8501104060,CN,-1", "A,8501104060,CN,1.001"]) assert.throws(() => parseLiveProducts("sku,hts_code,origin_country,annual_customs_value_usd\n"+row));
  assert.throws(() => parseLiveProducts("sku,hts_code,origin_country,annual_customs_value_usd\nA,8501104060,CN,1\nA,8501104060,CN,2"));
});
test("independent decimal verifier catches wrong engine answers and half-cent rounding", () => {
  assert.equal(verifyBaseMath("4.4%",10000,440).status,"passed");
  assert.equal(verifyBaseMath("4.4%",10000,441).status,"failed");
  assert.equal(verifyBaseMath("5%",0.10,0.01).expectedAmount,0.01);
  assert.equal(verifyBaseMath("Free",10000,0).status,"passed");
  assert.equal(verifyBaseMath("2.5¢/kg + 8.5%",10000,850).status,"not_checked");
  assert.equal(verifyBaseMath("See 9903.00.00",10000,0).status,"not_checked");
});
test("fresh rate lookup bypasses cached values and never falls back on fetch failure", async () => {
  const original = globalThis.fetch; let raw="4.4%", fail=false, calls=0; const modes: (RequestCache | undefined)[]=[];
  globalThis.fetch = async (_url, init) => { calls++; modes.push(init?.cache); if(fail) throw Error("private detail"); return Response.json([{htsno:"8501.10.40.60",general:raw,other:"35%",units:["No."]}]); };
  resetTariffCacheForTests();
  try {
    const first=await lookupTariff("8501.10.40.60"); assert.equal(first?.general.raw,"4.4%"); raw="5%";
    assert.equal((await lookupTariff("8501.10.40.60"))?.general.raw,"4.4%"); assert.equal(calls,1);
    const sources:unknown[]=[]; const next=await lookupTariff("8501.10.40.60",{fresh:true,onSource:s=>sources.push(s)});
    assert.equal(next?.general.raw,"5%"); assert.equal(modes.at(-1),"no-store"); assert.equal(sources.length,1);
    fail=true; await assert.rejects(()=>lookupTariff("8501.10.40.60",{fresh:true}));
    const quote=await quoteDuty({htsCode:"8501.10.40.60",value:10000},next!); assert.equal(quote?.computation.amount,500);
    await assert.rejects(()=>quoteDuty({htsCode:"8501.10.40.20",value:10000},next!));
  } finally {globalThis.fetch=original;resetTariffCacheForTests();}
});
test("inherited duty rate preserves statistical leaf units", async () => {
  const original=globalThis.fetch; globalThis.fetch=async()=>Response.json([{htsno:"8501.10.40",general:"4.4%",units:[]},{htsno:"8501.10.40.60",general:"",units:["No."]}]);
  try {resetTariffCacheForTests(); const row=await lookupTariff("8501.10.40.60",{fresh:true});assert.deepEqual(row?.units,["No."]);assert.equal(row?.inheritedFromHtsCode,"8501.10.40");} finally {globalThis.fetch=original;resetTariffCacheForTests();}
});
function route(auth=true, fail=false, archiveFailure: "start"|"finish"|null=null, role="member") {
  const source=ts.transpileModule(readFileSync("app/api/tariff/live-check/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:{POST?:(request:Request)=>Promise<Response>}={};
  runInThisContext(`(function(require,exports){${source}\n})`)((id:string)=> {
    if(id==="@/app/api/request-limits")return {withRequestLimit:async(request:Request,_op:string,_max:number,handler:Function)=>handler(request)};
    if(id==="@/lib/supabase/server")return {getAuthenticatedWorkspace:async()=>auth?{customerId:"fixture",role}:null,createRequestClient:async()=>({})};
    if(id==="@/config/tariff-remedy-contract.json")return {version:1};
    if(id==="@/lib/tariff/business-impact-store")return {beginLiveCheckArchive:async()=>{if(archiveFailure==="start")throw Error();return "archive-fixture";},finishLiveCheckArchive:async()=>{if(archiveFailure==="finish")throw Error("The calculation could not be archived.");},failLiveCheckArchive:async()=>{}};
    if(id==="./check")return {LIVE_MAX_BYTES:1000000,parseLiveProducts,runLiveCheck:async(_p:unknown,_signal:AbortSignal,progress:(m:string)=>void)=>{progress("real stage boundary fixture");if(fail)throw Error("private internal failure");return {totalAnnualDuty:null,unresolvedProducts:1};}};
    throw Error(`Unexpected dependency ${id}`);
  },exports);return exports.POST!;
}
const request=()=>new Request("http://localhost/api/tariff/live-check",{method:"POST",body:"sku,hts_code,origin_country,annual_customs_value_usd\nA,8501104060,CN,10000"});
test("handler enforces authentication, strict CSV validation and byte limit",async()=>{
  assert.equal((await route(false)(request())).status,401);
  assert.equal((await route()(new Request("http://localhost",{method:"POST",body:"bad"}))).status,400);
  assert.equal((await route()(new Request("http://localhost",{method:"POST",body:"a".repeat(1000001)}))).status,413);
});
test("handler streams unresolved results and does not turn a failure into a result",async()=>{
  const good=await (await route()(request())).text();assert.match(good,/"totalAnnualDuty":null/);assert.match(good,/"type":"progress"/);
  const failed=await (await route(true,true)(request())).text();assert.match(failed,/"type":"error"/);assert.doesNotMatch(failed,/"type":"done"|private internal failure/);
});

test("the supplied 600-line imports.csv groups into 50 products without becoming an annual forecast", () => {
  const csv=readFileSync("public/examples/equipment-demo/imports.csv","utf8"); const products=parseLiveProducts(csv);
  assert.equal(products.length,50); assert.equal(products.reduce((n,p)=>n+p.history!.entries.length,0),600);
  const catalogue=parseLiveProducts(readFileSync("public/examples/equipment-demo/products.csv","utf8"));
  for(const p of products) { const original=catalogue.find(q=>q.sku===p.sku)!; assert.equal(p.customsValue,original.customsValue); assert.equal(p.history!.entries.length,12); assert.equal(p.history!.startDate,"2025-10-15");assert.equal(p.history!.endDate,"2026-09-15");assert.equal(p.quantity,null); }
  assert.equal(products.find(p=>p.sku==="DEMO-MOT-001")!.history!.paidDuty,30360);
});
test("import history rejects duplicate entries, invalid dates and incomplete ledger headers",()=>{
  const head="entry_id,line_number,entry_date,sku,hts_code,origin_country,customs_value_usd,paid_duty_usd\n";
  const row="ENTRY-A,1,2026-09-15,MOTOR,8501104060,CN,123.45,5.43";
  assert.throws(()=>parseLiveProducts(head+row+"\n"+row),/duplicate entry/);
  assert.throws(()=>parseLiveProducts(head+row.replace("2026-09-15","2026-02-30")),/valid entry date/);
  assert.throws(()=>parseLiveProducts("entry_id,sku,hts_code,origin_country,customs_value_usd\nENTRY-A,MOTOR,8501104060,CN,123.45"),/Import history requires/);
  const p=parseLiveProducts(head+row+"\n"+row.replace("ENTRY-A","ENTRY-B").replace(",CN,",",VN,"));
  assert.equal(p.length,2);assert.equal(p[0].history!.paidDuty,5.43);assert.equal(p[1].origin,"VN");
});
test("HTTP intake accepts the actual 600-row imports file",async()=>{
  const response=await route()(new Request("http://localhost/api/tariff/live-check",{method:"POST",body:readFileSync("public/examples/equipment-demo/imports.csv","utf8")}));
  assert.equal(response.status,200);assert.match(await response.text(),/"type":"done"/);
});

test("qualification facts are explicit, validated and preserved through historical grouping",()=>{
  const history="entry_id,line_number,entry_date,sku,hts_code,origin_country,customs_value_usd,standard_commercial,other_232_heading,metal_weight_percent\nA,1,2026-09-15,BRG,8482105016,CN,100,true,none,90";
  assert.deepEqual(parseLiveProducts(history)[0].remedyFacts,{standardCommercial:true,metalWeightPercent:90,other232Heading:"none"});
  assert.throws(()=>parseLiveProducts(history+"\n"+history.split("\n")[1].replace("A,1","B,1").replace(",90",",10")),/facts differ/);
  assert.throws(()=>parseLiveProducts(history.replace(",90",",101")),/between 0 and 100/);
});
test("shipment-confirmation headers reject implicit or malformed truth values",async()=>{
  const base=request();const req=new Request(base,{headers:{"x-cante-standard-commercial":"yes"}});assert.equal((await route()(req)).status,400);
});

test("archive failure cannot be reported as a saved completed check, and viewers cannot start",async()=>{
 assert.equal((await route(true,false,"start")(request())).status,503);
 assert.equal((await route(true,false,null,"viewer")(request())).status,403);
 const failed=await(await route(true,false,"finish")(request())).text();assert.match(failed,/could not be archived/);assert.doesNotMatch(failed,/"type":"done"/);
 const saved=await(await route()(request())).text();assert.match(saved,/"archived":true/);assert.match(saved,/"checkId":"archive-fixture"/);
});
