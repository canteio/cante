import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual, createHmac } from "node:crypto";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { parseLiveProducts, type LiveCheckResult } from "../app/api/tariff/live-check/check";
import { compareSavedChecks, attachCheckComparison } from "../app/api/tariff/live-check/comparison";
import { boundedRequest } from "../app/api/request-body";
import { DUTY_CALCULATION_VERSION } from "../lib/tariff/duty-expression";

function moduleAt(path: string, deps: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInThisContext(`(function(require,exports){${code}\n})`)((name: string) => { if (!(name in deps)) throw Error(`Unexpected dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const checkId = "12345678-1234-4234-8234-123456789abc";
const customerId = "12345678-1234-4234-8234-123456789def";
const csv = readFileSync("public/examples/tariff-workflow-test.csv", "utf8");
function report(): LiveCheckResult {
  return { consistentRevision: true, checkedAt: "2026-10-21T16:00:00Z", basis: "annual", totalDuty: null, coverageNotes: [], comparison: null, rows: parseLiveProducts(csv).map(product => ({ product, error: null, stack: { totalAmount: 100, unresolvedMeasures: [] }, quote: { column: "general", computation: { amount: 10 } }, verification: { status: "passed" } })), sources: [], historicalComparison: { status: "compared", candidateSkus: [] } } as unknown as LiveCheckResult;
}
const sign = (secret: string, timestamp: string, body: string, cookie: string) => createHmac("sha256", secret).update(`${timestamp}\n${body}\n${cookie}`).digest("hex");

test("hosted dispatch accepts only the current worker calculation method",async()=>{
 const api=moduleAt("app/api/tariff/live-check/worker-client.ts",{
  "node:crypto":{createHmac},"next/headers":{cookies:async()=>{throw Error("Bearer fixture must not read cookies");}},
  "@/lib/tariff/duty-expression":{DUTY_CALCULATION_VERSION},
  "@/lib/supabase/server":{createRequestClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:"synthetic-session"}},error:null})}})},
 });
 const originalFetch=globalThis.fetch,oldUrl=process.env.CANTE_CHECK_WORKER_URL,oldSecret=process.env.CANTE_CHECK_DISPATCH_SECRET;
 process.env.CANTE_CHECK_WORKER_URL="https://worker.synthetic.invalid/api/check";process.env.CANTE_CHECK_DISPATCH_SECRET="synthetic-dispatch-secret-32-characters";
 try {
  for(const version of [undefined,"old-arithmetic",DUTY_CALCULATION_VERSION]){
   const result={...report(),...(version?{calculationVersion:version}:{})};
   globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),process.env.CANTE_CHECK_WORKER_URL);assert.equal(options?.redirect,"error");
    assert.equal(new Headers(options?.headers).get("authorization"),"Bearer synthetic-session");
    return new Response(JSON.stringify({type:"done",checkId,verified:true,result})+"\n");
   };
   const execution=api.dispatchCheck(checkId,customerId,new AbortController().signal,()=>{});
   if(version===DUTY_CALCULATION_VERSION)assert.deepEqual(await execution,result);
   else await assert.rejects(execution,/worker needs the current calculation update/);
  }
 } finally {globalThis.fetch=originalFetch;if(oldUrl===undefined)delete process.env.CANTE_CHECK_WORKER_URL;else process.env.CANTE_CHECK_WORKER_URL=oldUrl;if(oldSecret===undefined)delete process.env.CANTE_CHECK_DISPATCH_SECRET;else process.env.CANTE_CHECK_DISPATCH_SECRET=oldSecret;}
});

test("the public workflow fixture contains supported qualifications and an intentionally incomplete product", () => {
  const products = parseLiveProducts(csv); assert.equal(products.length, 5); assert(products.every(p => p.fictional));
  assert.equal(products[1].remedyFacts?.metalWeightPercent, 90);
  assert.equal(products[2].remedyFacts?.usMetalQualification, true);
  assert.equal(products[4].remedyFacts?.metalWeightPercent, undefined);
});
test("historical quantity and units propagate; incomplete quantities and conflicting units cannot be guessed", () => {
  const header = "entry_id,line_number,entry_date,sku,hts_code,origin_country,customs_value_usd,quantity,unit\n";
  const a = "A,1,2026-09-15,DEMO-X,8501314000,CN,100,1.25,No.";
  const b = "B,1,2026-09-16,DEMO-X,8501314000,CN,200,2.5,No.";
  const product = parseLiveProducts(header + a + "\n" + b)[0];
  assert.equal(product.quantity, 3.75); assert.equal(product.unit, "No."); assert.equal(product.customsValue, 300); assert.equal(product.history?.entries.length, 2);
  assert.equal(parseLiveProducts(header + a + "\n" + b.replace(",2.5,", ",,"))[0].quantity, null);
  assert.throws(() => parseLiveProducts(header + a + "\n" + b.replace("No.", "kg")), /units differ/);
});
test("reviewed USMCA decisions survive CSV intake, while incomplete and unsupported claims fail explicitly", () => {
  const head = "sku,hts_code,origin_country,annual_customs_value_usd,usmca_verified,usmca_decision,usmca_details\n";
  const row = "DEMO-MX,8501314000,MX,1000,true,qualifies,SYNTHETIC reviewed qualification assumption";
  assert.equal(parseLiveProducts(head + row)[0].usmcaQualification?.decision, "qualifies");
  assert.throws(() => parseLiveProducts(head + row.replace(",true,", ",false,")), /reviewed records/);
  assert.throws(() => parseLiveProducts("sku,hts_code,origin_country,annual_customs_value_usd,exclusion_id\nDEMO-X,8501314000,CN,1000,unreviewed"), /cannot silently apply or ignore/);
});
test("partial portfolios retain comparable product costs but withhold the overall exposure", () => {
  const before = report(); const after = structuredClone(before);
  after.rows[0].stack!.totalAmount = 125.01; after.rows[1].stack!.totalAmount = null;
  after.rows[1].stack!.unresolvedMeasures = ["Missing weight"];
  const delta = compareSavedChecks(before, after);
  assert.equal(delta.fullDutyDifference, null); assert.equal(delta.changedProducts, null);
  assert.equal(delta.rows[0].difference, 25.01); assert.equal(delta.rows[1].difference, null);
  assert.equal(delta.rows[1].status, "unresolved"); assert.equal(delta.topChanges.length, 1);
  assert.equal(compareSavedChecks(null, after).rows.length, 0);
  after.rows[0].product.origin = "JP"; assert.equal(compareSavedChecks(before, after).rows[0].status, "unresolved");
});

function worker(options: { foreign?: boolean; viewer?: boolean; completed?: boolean; tamper?: boolean; proofFail?: boolean; sourceTamper?: boolean; runFail?: boolean } = {}) {
  const calls: string[] = []; const result = report(); let event: any;
  const record = { id: checkId, actor_id: "user", input_csv: csv, input_sha256: createHash("sha256").update(csv).digest("hex"), confirmations: {}, created_at: "2026-10-21T15:00:00Z" };
  const chain: any = { select: () => chain, eq: () => chain, lt: () => chain, order: () => chain, limit: async () => ({ data: [], error: null }) };
  const db: any = { auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from: () => chain };
  const deps: Record<string,unknown> = {
    "@/app/api/tariff/workspace-data":{parseWorkspaceUpload:parseLiveProducts},
    "node:crypto": { createHash, timingSafeEqual },
    "@/app/api/request-body": { boundedRequest },
    "@/lib/supabase/server": { createRequestClient: async () => db, getAuthenticatedWorkspace: async () => options.foreign ? null : { customerId, userId: "user", role: options.viewer ? "viewer" : "member" } },
    "@/lib/supabase/service": { createServiceClient: () => ({ from: () => ({ insert: async (proof: any) => { calls.push("attest"); assert.equal(proof.terminal_event_id, "event"); return { error: options.proofFail ? {} : null }; } }) }) },
    "@/lib/tariff/business-impact-store": {
      isArchiveId: (s: string) => /^[a-f0-9-]{36}$/.test(s),
      readLiveCheckArchive: async () => ({ record, events: event ? [event] : options.completed ? [{ kind: "completed" }] : [] }),
      finishLiveCheckArchive: async (_db: any, tenant: string, id: string, computed: any) => {
        calls.push("archive"); assert.equal(tenant, customerId); assert.equal(id, checkId);
        const { sources, ...report } = structuredClone(computed); if (options.tamper) report.totalDuty = 987654321;
        if (options.sourceTamper) sources.push({ url: "https://hts.usitc.gov/", sha256: "invented" });
        const payload_text = JSON.stringify({ report, sources }); event = { id: "event", kind: "completed", payload_text, payload_sha256: createHash("sha256").update(payload_text).digest("hex") }; return "event";
      },
      failLiveCheckArchive: async () => { calls.push("fail"); },
    },
    "@/app/api/tariff/live-check/check": { parseLiveProducts, runLiveCheck: async (products: any, _signal: any, progress: Function, observe: Function) => { calls.push("fetch-and-calculate"); assert.equal(products.length, 5); observe([]); progress("Actual fixture stage"); if (options.runFail) throw Error("internal error"); return result; } },
    "@/app/api/tariff/live-check/comparison": { compareSavedChecks, attachCheckComparison },
    "@/app/api/tariff/live-check/worker-client": { dispatchSignature: sign },
  };
  deps["./execute"]=moduleAt("app/api/internal/tariff-live-check/execute.ts",deps);
  const api=moduleAt("app/api/internal/tariff-live-check/route.ts",deps);
  return { api, calls };
}
const secret = "test-only-dispatch-secret-0123456789";
function request(signed = true, timestamp = Date.now().toString(), cookie = "session=fixture") {
  const body = JSON.stringify({ checkId, customerId });
  return new Request("https://worker.test/api/internal/tariff-live-check", { method: "POST", headers: { cookie, "x-cante-dispatched-at": timestamp, "x-cante-dispatch-signature": signed ? sign(secret, timestamp, body, cookie) : "0".repeat(64) }, body });
}
const envKeys = ["CANTE_TRUSTED_CHECK_WORKER", "CANTE_CHECK_DISPATCH_SECRET", "VERCEL"] as const;
let originalEnv: (string | undefined)[];
test.beforeEach(() => { originalEnv = envKeys.map(key => process.env[key]); process.env.CANTE_TRUSTED_CHECK_WORKER = "true"; process.env.CANTE_CHECK_DISPATCH_SECRET = secret; delete process.env.VERCEL; });
test.afterEach(() => { envKeys.forEach((key,i) => { if (originalEnv[i] === undefined) delete process.env[key]; else process.env[key] = originalEnv[i]; }); });
test("worker refuses hosted execution, unsigned/expired dispatches, read-only and foreign sessions before fetching", async () => {
  const hosted = worker(); process.env.VERCEL = "1"; assert.equal((await hosted.api.POST(request())).status, 409); delete process.env.VERCEL;
  for (const req of [request(false), request(true, String(Date.now()-120000))]) assert.equal((await worker().api.POST(req)).status, 401);
  for (const options of [{ foreign: true }, { viewer: true }, { completed: true }]) { const h = worker(options); assert([403,409].includes((await h.api.POST(request())).status)); assert.equal(h.calls.length,0); }
});
test("worker fetches and calculates before saving and attesting its own exact output", async () => {
  const h = worker(); const response = await h.api.POST(request()); const events = (await response.text()).trim().split("\n").map((line: string) => JSON.parse(line));
  assert.deepEqual(h.calls, ["fetch-and-calculate", "archive", "attest"]);
  assert.equal(events.at(-1).type, "done"); assert.equal(events.at(-1).verified, true);
});
for (const options of [{ tamper: true }, { sourceTamper: true }, { proofFail: true }, { runFail: true }]) test(`worker withholds completion when verification fails: ${JSON.stringify(options)}`, async () => {
  const h = worker(options); const text = await (await h.api.POST(request())).text();
  assert.match(text, /"type":"error"/); assert.doesNotMatch(text, /"type":"done"/);
  if (!options.proofFail) assert(!h.calls.includes("attest"));
});

test("the actual stacking engine produces the cost change for a labelled fictional rate amendment", async () => {
  const { gunzipSync } = await import("node:zlib");
  const { compileOfficialRemedySnapshot, parseCurrentChinaCoverage } = await import("../lib/tariff/section232-live");
  const { computeStackedDuty } = await import("../lib/tariff/stack");
  const { parseDutyRate } = await import("../lib/tariff/duty-expression");
  const { easternIsoDate } = await import("../lib/tariff/date");
  const fixture = JSON.parse(gunzipSync(readFileSync("scripts/test-fixtures/tariff-remedies/usitc-2026-rev21.json.gz"), { maxOutputLength: 12*1024*1024 }).toString());
  const original = { ...compileOfficialRemedySnapshot(fixture.revision, fixture.notes, fixture.headings, "2026-10-21"), chinaCoverage: parseCurrentChinaCoverage(fixture.chinaText) };
  // Deliberately fictional amendment: never saved to any legal-rule or tenant table.
  const amended = { ...original, headings: original.headings.map(h => h.htsno === "9903.88.02" ? { ...h, general: "The duty provided in the applicable subheading + 30%" } : h) };
  const product = parseLiveProducts(csv)[0];
  const published = { htsCode: product.hts, description: "Fixture motor", units: ["No."], general: parseDutyRate("4%"), special: parseDutyRate("Free (S)"), specialProgrammes: ["S"], column2: parseDutyRate("35%"), additionalDuties: null, fetchedAt: new Date().toISOString() };
  const compute = (snapshot: typeof original) => computeStackedDuty({ htsCode: product.hts, countryOfOrigin: product.origin, value: product.customsValue, importDate: easternIsoDate(), remedyFacts: product.remedyFacts }, undefined, async () => ({ status:"unflagged" }), async () => new Set(), published, snapshot);
  const beforeDuty = await compute(original); const afterDuty = await compute(amended);
  assert.equal(beforeDuty?.totalAmount, 4150); assert.equal(afterDuty?.totalAmount, 4650);
  const before = report(); const after = report(); before.rows = [before.rows[0]]; after.rows = [after.rows[0]];
  before.rows[0].stack = beforeDuty; after.rows[0].stack = afterDuty; before.totalDuty = 4150; after.totalDuty = 4650;
  const comparison = compareSavedChecks(before, after);
  assert.equal(comparison.fullDutyDifference,500); assert.equal(comparison.changedProducts,1); assert.equal(comparison.rows[0].difference,500);
});

function dashboard(options: { role?: string; empty?: boolean; failedRead?: boolean; executeFail?: boolean; invalidLatest?: boolean } = {}) {
  const calls: string[] = []; let executedProducts: any;
  const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: options.empty ? [] : [{ id: checkId }], error: options.failedRead ? {} : null }) };
  const api = moduleAt("app/api/tariff/check-now/route.ts", {
    "../workspace-data":{loadWorkspaceSnapshot:async()=>{if(options.failedRead||options.invalidLatest)throw Error("Product snapshot unavailable");return {count:options.empty?0:5,csv,products:parseLiveProducts(csv).map(p=>({...p,remedyFacts:{standardCommercial:true,other232Heading:"none",...p.remedyFacts}}))};}},
    "@/app/api/request-limits": { withRequestLimit: async (request: Request, op: string, _bytes: number, handler: Function) => { assert.equal(op,"check"); calls.push("shared-admission"); return handler(request); } },
    "@/lib/supabase/server": { getAuthenticatedWorkspace: async () => ({ customerId,role:options.role??"member" }), createRequestClient: async () => ({ from: () => chain }) },
    "@/lib/tariff/business-impact-store": {
      readLiveCheckArchive: async () => ({ record: { id:checkId,input_csv:options.invalidLatest?"bad":csv,filename:"fixture.csv",confirmations:{standardCommercial:true,noOther232:true} }, verifiedResult:null, provenance:{status:"unverified"}, events:[] }),
      beginLiveCheckArchive: async () => { calls.push("save-original"); return checkId; },
      failLiveCheckArchive: async () => { calls.push("save-failure"); },
    },
    "../live-check/check": { parseLiveProducts },
    "../live-check/execute": { executeArchivedCheck: async (_db:any,_customer:any,_id:any,products:any,_signal:any,progress:Function) => { calls.push("execute"); executedProducts=products; progress("Fetching fixture evidence"); if(options.executeFail)throw Error(); return report(); } },
    "../live-check/worker-client": { checkWorkerConfigured: () => false },
    "@/config/tariff-remedy-contract.json": {},
  });
  return {api,calls,get products(){return executedProducts;}};
}
test("dashboard refresh uses saved catalogue products and their explicit declarations, without a privileged hosted database client", async () => {
  const h=dashboard();const response=await h.api.POST(new Request("https://cante.test/api/tariff/check-now",{method:"POST"}));const text=await response.text();
  assert.deepEqual(h.calls,["shared-admission","save-original","execute"]);assert.match(text,/"type":"done"/);
  assert.equal(h.products[0].remedyFacts.standardCommercial,true);assert.equal(h.products[4].remedyFacts.metalWeightPercent,undefined);
});
test("dashboard cannot invent a product snapshot, report success after failure, or execute for viewers", async () => {
  for(const options of [{empty:true},{invalidLatest:true},{role:"viewer"},{failedRead:true}]) {
    const h=dashboard(options);const response=await h.api.POST(new Request("https://cante.test/api/tariff/check-now",{method:"POST"}));
    assert(response.status>=400);assert(!h.calls.includes("execute"));
  }
  const h=dashboard({executeFail:true});const text=await(await h.api.POST(new Request("https://cante.test/api/tariff/check-now",{method:"POST"}))).text();
  assert(h.calls.includes("save-failure"));assert.doesNotMatch(text,/"type":"done"/);
});

test("comparison and dated news are attached before saving, without trusting an unattested baseline", () => {
  const before=report();const current=report();current.entryDate="2026-10-21";current.notices=[{title:"Today",url:"https://www.federalregister.gov/fixture",date:"2026-10-21",source:"Federal Register"},{title:"Old",url:"https://www.federalregister.gov/old",date:"2026-10-20",source:"Federal Register"}];
  attachCheckComparison(current,{record:{id:checkId},verifiedResult:null});
  assert.equal(current.comparison?.fullDutyDifference,null);assert.equal(current.baselineCheckId,null);
  assert.equal(current.chatRecheck?.sourceCheckId,checkId);assert.equal(current.chatRecheck?.todayNotices.length,1);
  assert.equal(current.chatRecheck?.todayNotices[0].title,"Today");
  const after=structuredClone(current);before.totalDuty=500;after.totalDuty=525;after.rows[0].stack!.totalAmount=125;
  attachCheckComparison(after,{record:{id:checkId},verifiedResult:before});
  assert.equal(after.baselineCheckId,checkId);assert.equal(after.chatRecheck?.fullDutyDifference,25);
  const saved=JSON.parse(JSON.stringify(after));assert.equal(saved.chatRecheck.fullDutyDifference,25);
});

test("China exclusion-note changes match the declared origin as well as HTS", async () => {
  const { historicalProductCandidates } = await import("../app/api/tariff/live-check/history");
  const products=parseLiveProducts(csv);
  const comparison:any={legalChanges:[{note:20,codes:["8501.31.40"]}],headingChanges:[],baseChanges:[]};
  assert.deepEqual(historicalProductCandidates(comparison,products),["DEMO-MOTOR-CN"]);
  comparison.headingChanges=[{code:"9903.05.31"}];
  const measures=new Map([["DEMO-MOTOR-JP",["9903.05.31"]]]);
  assert.deepEqual(historicalProductCandidates(comparison,products,measures),["DEMO-MOTOR-CN","DEMO-MOTOR-JP"]);
});

test("one SKU imported from two countries retains distinct affected-product identities", async () => {
  const { historicalProductCandidateRows }=await import("../app/api/tariff/live-check/history");
  const base=parseLiveProducts(csv)[0];const products=[base,{...base,origin:"JP"}];
  const comparison:any={legalChanges:[{note:20,codes:["8501.31.40"]}],headingChanges:[],baseChanges:[]};
  assert.deepEqual(historicalProductCandidateRows(comparison,products),[{sku:base.sku,hts:base.hts,origin:"CN"}]);
});

test("a blocked archive index preserves independently fetched before/after legal-note evidence", async () => {
  const {gunzipSync,gzipSync}=await import("node:zlib");
  const f=JSON.parse(gunzipSync(readFileSync("scripts/test-fixtures/historical-rules/usitc-20-21.json.gz"),{maxOutputLength:32*1024*1024}).toString());
  const api=moduleAt("app/api/tariff/live-check/history.ts",{
    "node:crypto":{createHash},"node:zlib":{gzipSync},"cheerio":{},
    "@/lib/tariff/duty-expression":{},"@/lib/tariff/rates":{},
    "unpdf":{getDocumentProxy:async(bytes:Uint8Array)=>({numPages:1,old:Buffer.from(bytes).toString().includes("Rev20")}),extractText:async(pdf:any)=>({text:pdf.old?f.beforeText:f.afterText})},
  });
  const original=globalThis.fetch;
  globalThis.fetch=async(url:any)=>{
    const u=new URL(url);if(u.pathname.endsWith('/releaseList'))return Response.json(f.releaseList);
    if(u.pathname.endsWith('/file'))return new Response('%PDF-'+u.searchParams.get('release'));
    if(u.hostname==='www.usitc.gov')return new Response('blocked',{status:403});
    throw Error('Unexpected request');
  };
  try {
    const sources:any[]=[];const result=await api.compareHistoricalRules({currentRevision:'2026HTSRev21',products:[],currentRows:new Map(),currentHeadings:[],sources,progress:()=>{}});
    assert.equal(result.status,'compared');assert.deepEqual(result.notesCompared,[16,20,52]);assert.equal(result.legalChanges.length,1);
    assert.equal(result.coverage.legalNotes,true);assert.equal(result.coverage.historicalSchedule,false);
    assert.equal(result.baseChanges.length,0);assert.equal(result.headingChanges.length,0);
    assert(sources.some(s=>s.status==='failed'&&s.error.includes('403')));assert(result.scope.some((s:string)=>s.includes('empty arrays do not mean no change')));
    assert.equal(sources.filter(s=>s.status==='fetched'&&s.url.includes('filename=Chapter')).length,2);
  } finally {globalThis.fetch=original;}
});
