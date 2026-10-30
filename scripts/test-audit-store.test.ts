import test from "node:test";
import assert from "node:assert/strict";
import {referenceGroupEnd} from "../app/api/audits/shipment";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { parseAudit,auditTable,suggestMapping } from "../app/api/audits/input";
import { evaluateAuditEntry,summarizeAudit } from "../app/api/audits/engine";
import { AUDIT_VERSION,defaultOptions } from "../app/api/audits/model";
import { readAudit,exportAudit,referenceEntries,ensureAuditProductLinks } from "../app/api/audits/store";
const id="12345678-1234-4234-8234-123456789abc",run="12345678-1234-4234-8234-123456789def";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function fixture(tamper?:string){
  const csv=readFileSync("scripts/test-fixtures/historical-audits/entries.csv","utf8");const entry=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true})[0];
  const bundle=JSON.parse(readFileSync("scripts/test-fixtures/historical-audits/rules.json","utf8")),decisions=JSON.parse(readFileSync("scripts/test-fixtures/historical-audits/decisions.json","utf8"));
  const result=evaluateAuditEntry(entry,[bundle],"synthetic-product",decisions,true);const text=JSON.stringify({entry,result}),summary=summarizeAudit([result]);
  const batch={id,customer_id:"tenant-a",filename:"SYNTHETIC.csv",revision:1,status:"completed",active_run_id:run};
  const proof={run_id:run,revision:1,verified_at:"2026-10-22T00:00:00Z",summary,engine_version:AUDIT_VERSION,result_sha256:hash(text)};
  const record={row_number:1,result_text:text,result_sha256:hash(text)};
  if(tamper==="legacy")proof.engine_version="historical-audit-v1";if(tamper==="text")record.result_text=text.replace('"300.00"','"900.00"');if(tamper==="proof")proof.result_sha256="0".repeat(64);if(tamper==="summary")proof.summary={...summary,overpayment:"999.00"};if(tamper==="engine")proof.engine_version="forged";
  const queries:{table:string;filters:Record<string,unknown>}[]=[];
  const db={from(table:string){const filters:Record<string,unknown>={};let single=false;queries.push({table,filters});const response=()=>{if(filters.customer_id!=="tenant-a")return {data:single?null:[],error:null};let data:unknown=table==="audit_batches"?batch:table==="audit_review_events"?[]:table==="tariff_impact_attestations"?single?(tamper==="missing-proof"?null:proof):[proof]:table==="audit_entry_results"?[record]:null;return {data,error:null};};const q:any={select(){return q;},eq(k:string,v:unknown){filters[k]=v;return q;},order(){return q;},limit(){return q;},range(){return q;},maybeSingle(){single=true;return q;},then(resolve:Function){return Promise.resolve(response()).then(resolve as any);}};return q;}};
  return {db:db as any,queries,summary};
}
test("saved audit reader requires worker proof and exact output/summary integrity",async()=>{
  const f=fixture();const data=await readAudit(f.db,"tenant-a",id);assert(data?.verified);assert.deepEqual(data.summary,f.summary);assert(f.queries.every(q=>q.filters.customer_id==="tenant-a"));
  for(const mode of ["text","proof","summary","engine","missing-proof"]){const bad=fixture(mode);await assert.rejects(readAudit(bad.db,"tenant-a",id),Error,mode);}
});
test("foreign audit and missing audit do not expose any rows",async()=>{
  const f=fixture();assert.equal(await readAudit(f.db,"tenant-b",id),null);assert.equal(f.queries.length,1);
});
test("export uses retained results, safe cells and current-version review states",async()=>{
  const f=fixture();const d=await readAudit(f.db,"tenant-a",id);assert(d);d.rows[0].entry.description="=HYPERLINK(\"bad\")";d.decisions=[{row:1,kind:"resolved",note:"Future revision must not resolve an earlier version",evidence:[],revision:2}];
  const csv=exportAudit(d);assert(csv.includes("'\u003dHYPERLINK"));assert(csv.includes('"expected_duty_usd"'));assert(!csv.includes('"resolved"'));assert.throws(()=>exportAudit({...d,verified:false}),/verify/);
});
test('reference exports do not present a narrowed calculation interval as the original law date',async()=>{
 const f=fixture(),d=await readAudit(f.db,'tenant-a',id);assert(d);const result=d.rows[0].result;result.validation={kind:'cante_validated',compiler:'historical-301-reference-v2',assumptions:[]};assert(result.components.length);result.components[0].id='9903.88.20';result.components[0].effectiveFrom='2019-10-31';
 const csv=exportAudit(d);assert(csv.includes('calculationCoverageFrom'));assert(csv.includes('2019-10-31'));assert(!csv.includes('legalEffectiveFrom'));assert(csv.includes('publication dates do not establish original legal effective dates'));
});
test("actual detail route derives tenant from session, rejects foreign identities and unsigned callers",async()=>{
  const code=ts.transpileModule(readFileSync("app/api/audits/[id]/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const f=fixture();let workspace:any={customerId:"tenant-a",role:"member"};let selected:string|undefined;
  const exports:any={};const dependencies:Record<string,unknown>={"@/lib/supabase/server":{getAuthenticatedWorkspace:async()=>workspace,createRequestClient:async()=>f.db},"@/lib/tariff/business-impact-store":{isArchiveId:(v:unknown)=>typeof v==="string"&&/^[a-f0-9-]{36}$/.test(v)},"../store":{readAudit:async(db:any,customerId:string,id:string,runId?:string)=>{selected=customerId;return readAudit(db,customerId,id,runId);}}};
  runInThisContext(`(function(require,exports){${code}})`)((name:string)=>{assert(name in dependencies);return dependencies[name];},exports);
  const request=new Request("https://cante.test/api/audits/"+id+"?customerId=tenant-b");
  assert.equal((await exports.GET(request,{params:Promise.resolve({id})})).status,200);assert.equal(selected,"tenant-a");workspace=null;assert.equal((await exports.GET(request,{params:Promise.resolve({id})})).status,401);workspace={customerId:"tenant-b",role:"owner"};assert.equal((await exports.GET(request,{params:Promise.resolve({id})})).status,404);
});

test("prior engine proofs stay readable and exports state the original version",async()=>{
 const f=fixture("legacy"),d=await readAudit(f.db,"tenant-a",id);assert(d?.verified);assert.equal(d.engineVersion,"historical-audit-v1");assert(exportAudit(d).includes('"historical-audit-v1"'));
});
test('support refresh uses the server engine, saved tenant input and bounded admission',async()=>{
 const code=ts.transpileModule(readFileSync('app/api/audits/[id]/rules/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let workspace:any={customerId:'tenant-a',role:'member'},missing=false,unavailable=false,admissions=0;
 const calls:any[]=[],filters:Record<string,string>={};
 const db={from(table:string){assert.equal(table,'audit_batches');const q:any={select(){return q;},eq(k:string,v:string){filters[k]=v;return q;},async maybeSingle(){return {error:null,data:missing?null:{upload_id:'original',mapping:{},options:{}}};}};return q;},async rpc(name:string,args:any){calls.push({name,args});return {data:true,error:unavailable?{message:'unavailable'}:null};}};
 const entries=[{row:1}],scopes=[{row:1,hts:'9109104010'}],deps:Record<string,unknown>={
  '@/lib/supabase/server':{getAuthenticatedWorkspace:async()=>workspace,createRequestClient:async()=>db},
  '@/app/api/request-limits':{withRequestLimit:async(r:Request,kind:string,bytes:number,handler:Function)=>{assert.equal(kind,'upload');assert.equal(bytes,1024);admissions++;return handler(r);}},
  '@/lib/tariff/business-impact-store':{isArchiveId:(s:string)=>s===id},
  '../../store':{auditOriginal:async(tenant:string,upload:string)=>{assert.equal(tenant,'tenant-a');assert.equal(upload,'original');return {csv:'original bytes'};},approvedBundleIds:async(_db:unknown,e:unknown)=>{assert.equal(e,scopes);return ['approved'];},readDecisions:async()=>[],referenceEntries:(e:unknown)=>{assert.equal(e,entries);return scopes;}},
  '../../input':{parseAudit:(csv:string)=>{assert.equal(csv,'original bytes');return entries;}},
  '../../model':{AUDIT_VERSION},'@/app/api/tariff/references/store':{selectReferenceIds:async(_db:unknown,e:unknown)=>{assert.equal(e,scopes);return ['retained'];}}
 };
 const exports:any={};runInThisContext(`(function(require,exports){${code}})`)((name:string)=>{assert(name in deps,name);return deps[name];},exports);
 const invoke=()=>exports.POST(new Request('https://cante.test/api/audits/'+id+'/rules',{method:'POST',body:JSON.stringify({customerId:'foreign',target_engine_version:'historical-audit-v999'})}),{params:Promise.resolve({id})});
 assert.equal((await invoke()).status,200);assert.deepEqual(filters,{id,customer_id:'tenant-a'});assert.deepEqual(calls,[{name:'refresh_historical_audit_support',args:{target_audit:id,selected_ids:['approved'],selected_reference_ids:['retained'],target_engine_version:AUDIT_VERSION}}]);
 missing=true;assert.equal((await invoke()).status,404);assert.equal(calls.length,1);missing=false;unavailable=true;assert.equal((await invoke()).status,503);assert.equal(calls.length,2);
 workspace={customerId:'tenant-a',role:'viewer'};assert.equal((await invoke()).status,403);workspace=null;assert.equal((await invoke()).status,401);assert.equal(calls.length,2);assert.equal(admissions,5);
});
test("historical source lookup follows only dated, supported classification corrections",()=>{
 const csv=readFileSync("scripts/test-fixtures/historical-audits/entries.csv","utf8"),entry=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true})[0];
 const d={row:entry.row,kind:"confirm_facts" as const,hts:"8501324000",facts:{classification_verified:true},note:"Synthetic reviewed classification",evidence:["SYNTHETIC-DOC"],validFrom:"2024-05-01",validBefore:"2024-06-01"};
 assert.equal(referenceEntries([entry],[d])[0].hts,d.hts);assert.equal(entry.hts,"8501314000");
 assert.equal(referenceEntries([entry],[{...d,evidence:[]}])[0].hts,entry.hts);assert.equal(referenceEntries([entry],[{...d,validFrom:"2024-06-01"}])[0].hts,entry.hts);
});
test('confirmed historical imports create tenant-scoped inactive identifiers and preserve existing product facts',async()=>{
 const csv=readFileSync('scripts/test-fixtures/historical-audits/entries.csv','utf8'),entries=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true});const stored:any[]=[];const calls:any[]=[];
 const db={from(table:string){assert.equal(table,'products');const q:any={select(){return q;},eq(k:string,v:string){assert.equal(k,'customer_id');assert.equal(v,'tenant-a');return q;},in(){return Promise.resolve({data:[{id:'existing',sku:entries[0].sku,origin_country:'VN'}],error:null});},upsert(rows:any[],options:any){calls.push(options);stored.push(...rows);return Promise.resolve({error:null});}};return q;}};
 const count=await ensureAuditProductLinks(db as never,'tenant-a',entries,'retained-upload');assert(count>0);assert(!stored.some(p=>p.sku===entries[0].sku));assert.equal(new Set(stored.map(p=>p.sku)).size,stored.length);
 assert(stored.every(p=>p.customer_id==='tenant-a'&&p.active===false&&p.origin_country===null&&p.unit_value===null));assert(calls.every(o=>o.ignoreDuplicates===true&&o.onConflict==='customer_id,sku'));assert(stored.every(p=>!('tariff_inputs'in p)&&!('classifications'in p)));
});

test('PDF work groups follow evidence-corrected chapters while retaining original declarations',()=>{
 const csv=readFileSync('scripts/test-fixtures/historical-audits/entries.csv','utf8'),e=parseAudit(csv,suggestMapping(auditTable(csv).headers),{...defaultOptions,currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true})[0];
 const entries=[{...e,row:1,hts:'7317005503'},{...e,row:2,hts:'7317005503'}],decision={row:2,kind:'confirm_facts' as const,hts:'8482105012',note:'SYNTHETIC corrected chapter supported by dated specifications.',evidence:['SYNTHETIC-SPECS'],validFrom:e.date,validBefore:'2027-01-01',facts:{classification_verified:true}};
 const revised=referenceEntries(entries,[decision]);assert.equal(referenceGroupEnd(revised,0),1);assert.equal(referenceGroupEnd(revised,1),2);assert.equal(entries[1].hts,'7317005503');
 const unproved=referenceEntries(entries,[{...decision,evidence:[]}]);assert.equal(referenceGroupEnd(unproved,0),2);
});
