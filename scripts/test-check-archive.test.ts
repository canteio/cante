import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync,gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { runInThisContext } from "node:vm";
import ts from "typescript";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function store(){const source=ts.transpileModule(readFileSync("lib/tariff/business-impact-store.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports:Record<string,Function>={};runInThisContext(`(function(require,exports){${source}\n})`)((name:string)=>{if(name==="node:crypto")return {createHash};if(name==="node:zlib")return {gunzipSync};if(name==="@/lib/supabase/server")return {};if(name==="./date"||name==="./business-impact")return {};throw Error(name);},exports);return exports;}
function client(records:unknown,events:unknown[],versions:unknown[]=[],attestation:unknown=null){const scopes:string[]=[];return {scopes,from:(table:string)=>{let value=table==="tariff_check_records"?records:table==="tariff_check_events"?events:table==="tariff_check_attestations"?attestation:versions;const chain:any={select:()=>chain,eq:(key:string,value:string)=>{if(key==="customer_id")scopes.push(value);return chain;},in:()=>chain,order:()=>chain,limit:()=>chain,range:(start:number,end:number)=>{if(Array.isArray(value))value=value.slice(start,end+1);return chain;},maybeSingle:async()=>({data:value,error:null}),then:(resolve:Function)=>resolve({data:value,error:null})};return chain;}};}
const record=()=>({id:"id",input_csv:"original,CSV,✓",input_sha256:hash("original,CSV,✓")});
function completed(body="government text"){const payload_text=JSON.stringify({report:{totalDuty:null},sources:[{versionId:"version",sha256:hash(body)}]});return {id:"event",kind:"completed",payload_text,payload_sha256:hash(payload_text)};}
test("archived input tampering is rejected instead of rendered as original",async()=>{const db=client({...record(),input_csv:"rewritten"},[completed()]);await assert.rejects(()=>store().readLiveCheckArchive(db,"workspace","id"),/input integrity/);});
test("archived calculation tampering is rejected",async()=>{const db=client(record(),[{...completed(),payload_text:JSON.stringify({report:{totalDuty:0},sources:[]})}]);await assert.rejects(()=>store().readLiveCheckArchive(db,"workspace","id"),/event integrity/);});
test("full exports verify source bytes and scope every read to the workspace",async()=>{const db=client(record(),[completed()],[{id:"version",body:"government text",encoding:"utf8",sha256:hash("government text")}]);const output=await store().readLiveCheckArchive(db,"workspace","id",true);assert.equal(output.result.sources[0].body,"government text");assert.equal(output.result.totalDuty,null);assert.deepEqual(db.scopes,["workspace","workspace","workspace","workspace"]);const corrupt=client(record(),[completed()],[{id:"version",body:"changed",encoding:"utf8",sha256:hash("government text")}]);await assert.rejects(()=>store().readLiveCheckArchive(corrupt,"workspace","id",true),/source integrity/);});
test("a missing source version blocks export; a missing check remains not found",async()=>{await assert.rejects(()=>store().readLiveCheckArchive(client(record(),[completed()]),"workspace","id",true),/source version is missing/);assert.equal(await store().readLiveCheckArchive(client(null,[]),"workspace","id"),null);});

test("failed checks retain captured source evidence without pretending to have a result",async()=>{const event=completed();event.kind="failed";const db=client(record(),[event],[{id:"version",body:"government text",encoding:"utf8",sha256:hash("government text")}]);const output=await store().readLiveCheckArchive(db,"workspace","id",true);assert.equal(output.result,null);assert.equal(output.sourceEvidence[0].body,"government text");});

test("review histories page beyond database response limits without dropping decisions",async()=>{const reviews=Array.from({length:260},(_,i)=>{const payload_text=JSON.stringify({decision:"reviewed",note:`Decision ${i}`});return {id:`review-${i}`,kind:"review",payload_text,payload_sha256:hash(payload_text)};});const result=await store().readLiveCheckArchive(client(record(),[completed(),...reviews]),"workspace","id");assert.equal(result.events.length,261);assert.match(result.events.at(-1).payload_text,/Decision 259/);});

test("compressed archives preserve original government bytes and reject a changed original hash",async()=>{const original="original government JSON";const zipped=gzipSync(Buffer.from(original));const digest=createHash("sha256").update(zipped).digest("hex");const payload_text=JSON.stringify({report:{totalDuty:null},sources:[{versionId:"version",sha256:digest,compression:"gzip",originalSha256:hash(original)}]});const event={kind:"completed",payload_text,payload_sha256:hash(payload_text)};const version={id:"version",body:zipped.toString("base64"),encoding:"base64",sha256:digest,compression:"gzip",original_sha256:hash(original)};const output=await store().readLiveCheckArchive(client(record(),[event],[version]),"workspace","id",true);assert.equal(gunzipSync(Buffer.from(output.result.sources[0].body,"base64")).toString(),original);await assert.rejects(()=>store().readLiveCheckArchive(client(record(),[event],[{...version,original_sha256:hash("changed")}]),"workspace","id",true),/original source integrity/);});

test("self-authored report claims and valid hashes cannot establish execution provenance", async () => {
 const payload_text=JSON.stringify({report:{totalDuty:987654321,provenance:{status:"verified"}},sources:[]});
 const event={id:"event",kind:"completed",payload_text,payload_sha256:hash(payload_text)};
 const output=await store().readLiveCheckArchive(client(record(),[event]),"workspace","id");
 assert.equal(output.result.totalDuty,987654321); // Raw history remains available, explicitly unverified.
 assert.equal(output.provenance.status,"unverified");assert.equal(output.verifiedResult,null);
});
test("only an independently protected attestation matching check, tenant, input and terminal event is trusted", async () => {
 const event=completed();const proof={check_id:"id",customer_id:"workspace",terminal_event_id:"event",input_sha256:record().input_sha256,event_sha256:event.payload_sha256,verifier_version:"trusted-worker-fixture"};
 const output=await store().readLiveCheckArchive(client(record(),[event],[],proof),"workspace","id");
 assert.equal(output.provenance.status,"verified");assert(output.verifiedResult);
 for(const key of ["check_id","customer_id","terminal_event_id","input_sha256","event_sha256","verifier_version"]){
  const bad=await store().readLiveCheckArchive(client(record(),[event],[],{...proof,[key]:key==="verifier_version"?"":"wrong"}),"workspace","id");
  assert.equal(bad.verifiedResult,null,key);
 }
 const db=client(record(),[event]);const read=db.from;db.from=(name:string)=>{if(name==="tariff_check_attestations")throw Error("Missing migration");return read(name);};
 assert.equal((await store().readLiveCheckArchive(db,"workspace","id")).verifiedResult,null);
});
