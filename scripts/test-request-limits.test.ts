import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import * as bodyLimits from "../app/api/request-body";
const id="12345678-1234-4234-8234-123456789abc";
function helper(options: {auth?:boolean; authError?:boolean; backendError?:boolean; allowed?:boolean; error?:boolean; malformed?:boolean; concurrent?:number}={}) {
  let active=0,releases=0,started=0;
  const compiled=ts.transpileModule(readFileSync("app/api/request-limits.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const api:any={};
  runInThisContext(`(function(require,exports){${compiled}\n})`)((name:string)=>{
    if(name==="./request-body")return bodyLimits;
    assert.equal(name,"@/lib/supabase/server");
    return {getAuthenticatedWorkspace:async()=>{if(options.authError)throw Error("secret fixture configuration");return options.auth===false?null:{customerId:id,userId:id,role:"member"};},createRequestClient:async()=>{if(options.backendError)throw Error("secret backend detail");return {rpc:async(name:string,args:any)=>{
      if(name==="release_api_request"){active--;releases++;return {error:null};}
      assert.equal(name,"acquire_api_request"); assert.equal(args.target_customer_id,id);
      if(options.error)return {error:{code:"offline"}};
      if(options.malformed)return {data:{allowed:"true"}};
      if(options.allowed===false||active>=(options.concurrent??2))return {data:{allowed:false,retryAfter:37,reason:"Too many requests"}};
      active++;started++;return {data:{allowed:true,leaseId:id}};
    }};}};
  },api);
  return {api,active:()=>active,releases:()=>releases,started:()=>started};
}
function request(body="hello",headers={}){return new Request("https://cante.test/api/chat",{method:"POST",body,headers});}
for(const [opts,status] of [[{auth:false},401],[{allowed:false},429],[{error:true},503],[{malformed:true},503],[{authError:true},503],[{backendError:true},503]] as const){
 test(`admission ${JSON.stringify(opts)} blocks body processing and paid work`,async()=>{
  const h=helper(opts);let called=false;const req=request();
  const response=await h.api.withRequestLimit(req,"chat",100,async()=>{called=true;return Response.json({});});
  assert.equal(response.status,status);assert.equal(called,false);assert.equal(req.bodyUsed,false);
  if(status===429)assert.equal(response.headers.get("retry-after"),"37");
 });
}
test("parallel requests share the backend concurrency budget until streams finish",async()=>{
 const h=helper();let runs=0;
 const responses=await Promise.all(Array.from({length:12},()=>h.api.withRequestLimit(request(),"chat",100,async()=>{runs++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("data: done\n\n"));c.close();}}),{headers:{"content-type":"text/event-stream"}});} )));
 assert.equal(runs,2);assert.equal(responses.filter(r=>r.status===429).length,10);
 await Promise.all(responses.filter(r=>r.status===200).map(r=>r.text()));assert.equal(h.active(),0);assert.equal(h.releases(),2);
});
test("disconnects cannot release a slot while work may still be unwinding",async()=>{
 const h=helper();const response=await h.api.withRequestLimit(request(),"check",100,async()=>new Response(new ReadableStream({}),{headers:{"content-type":"application/x-ndjson"}}));
 await response.body.cancel();assert.equal(h.releases(),0);assert.equal(h.active(),1);
});
test("oversized body is rejected before multipart parsing and releases its slot",async()=>{
 const h=helper();let parsed=false;
 const response=await h.api.withRequestLimit(request("x".repeat(1025),{"content-type":"multipart/form-data; boundary=x","content-length":"1"}),"upload",1024,async(r:Request)=>{parsed=true;await r.formData();return Response.json({});});
 assert.equal(response.status,413);assert.equal(parsed,false);assert.equal(h.releases(),1);
});
test("missing Content-Length cannot bypass the streaming byte cap",async()=>{
 let pulls=0,cancelled=false;const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(512));},cancel(){cancelled=true;}});
 const req=new Request("https://cante.test/upload",{method:"POST",body:stream,duplex:"half"} as RequestInit);
 await assert.rejects(()=>bodyLimits.boundedRequest(req,1024),(e:any)=>e.status===413);
 assert(cancelled);assert(pulls<10);
});
test("large declared size is rejected without reading; exact byte limit remains valid",async()=>{
 const h=helper();let called=false;
 const rejected=await h.api.withRequestLimit(request("x",{"content-length":"99999"}),"upload",10,async()=>{called=true;return Response.json({});});assert.equal(rejected.status,413);assert(!called);
 const good=await bodyLimits.boundedRequest(request("café"),5);assert.equal(await good.text(),"café");
});
test("ordinary completion and thrown handlers release exactly one permit",async()=>{
 const h=helper();assert.equal((await h.api.withRequestLimit(request(),"chat",10,async()=>Response.json({ok:true}))).status,200);
 await assert.rejects(()=>h.api.withRequestLimit(request(),"chat",10,async()=>{throw Error("fixture");}),/fixture/);
 assert.equal(h.releases(),2);assert.equal(h.active(),0);
});

test("aborted uploads cancel a pending reader instead of waiting for the full body", async () => {
 const abort=new AbortController();let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const request=new Request("https://cante.test/upload",{method:"POST",body:stream,signal:abort.signal,duplex:"half"} as RequestInit);
 const result=bodyLimits.boundedRequest(request,100);abort.abort();
 await assert.rejects(()=>result);assert(cancelled);
});
