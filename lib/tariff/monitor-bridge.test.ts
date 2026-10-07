import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const state = { rows: [] as Record<string, unknown>[], fail: false, workspace: "tenant" as string | null, reads: [] as unknown[][], writes: [] as { table: string; value: Record<string, unknown> }[] };
Object.assign(globalThis, { monitorBridgeTest: state });
const dir = mkdtempSync(`${tmpdir()}/monitor-bridge-`);
const modules: Record<string, string> = {
  "supabase/server": `exports.createClient = async () => client;
exports.createRequestClient = async () => client;
exports.getAuthenticatedWorkspace = async () => globalThis.monitorBridgeTest.workspace ? {customerId:globalThis.monitorBridgeTest.workspace} : null;
const client = { from(table) {
 const s = globalThis.monitorBridgeTest;
 const q = {
 select(){return q},eq(...args){s.reads.push([table,...args]);return q},not(){return q},range:async()=>({data:s.rows,error:null}),in(){return q},order(){return q},limit(){return q},
 maybeSingle: async()=>({data:table==='findings'?{id:'finding'}:null,error:null}),
 insert(value){s.writes.push({table,value});return q},
 update(value){s.writes.push({table,value});return q},
 upsert(value,options){if(table==='tariff_monitor_candidates' && (options.onConflict!=='finding_id,product_id' || !options.ignoreDuplicates)) throw Error('Unsafe conflict handling');if(table==='tariff_monitor_candidates') {if(s.fail) throw Error('bridge outage');for(const row of value) if(!s.rows.some(r=>r.finding_id===row.finding_id&&r.product_id===row.product_id)) s.rows.push(row);}return q},
 then(resolve,reject){return Promise.resolve({data:null,error:null}).then(resolve,reject)}
 };return q;
}}; exports.client=client;`,
  "supabase/service": `exports.createServiceClient=()=>require('./supabase_server.cjs').client;`,
  "catalogue/products": `exports.listProducts=async()=>[{id:'exact',sku:'A',materials:['steel']},{id:'prefix',sku:'B',materials:[]},{id:'material',sku:'C',materials:['steel']}];`,
  "catalogue/classifications": `exports.listClassifications=async(id)=>id==='material'?[]:[{code:id==='exact'?'8201.10.0000':'8201.10',tier:'human',status:'approved',supersededAt:null}]; exports.resolveProductCodes=async()=>({});`,
  "db/queries": `exports.getCustomerWithProfile=async()=>({customer:{},profile:{}});exports.getJurisdictionProfile=async()=>null;exports.getSeenRegulations=async()=>[];exports.listMemories=async()=>[];exports.reapStaleRuns=async()=>{};`,
  "llm": `exports.getProvider=()=>({available:async()=>({ok:true})});`,
  "checks/judge": `exports.judge=async()=>({findings:[]});`,
  "checks/judge-batched": `exports.planBatches=()=>[];exports.judgeAllEntries=async()=>({findings:[{title:'HTS 8201.10.0000 alleged 99.9% duty',summaryEn:null,reasoning:null,regulationRef:null,relevance:'flagged',url:'https://example.test/rule'}],coverageCaveats:[],whatsappMessage:'Review finding',batches:1,failedBatches:0});`,
  "checks/lifecycle": `exports.linkRegulation=async()=>[];exports.detectRegulationLinks=()=>[];`,
  "checks/briefing": `exports.briefFindings=async()=>[];exports.renderBriefings=()=>'';`,
  "checks/source-changes": `exports.selectSourceChanges=async()=>({regulations:[],caveats:[],newCount:0,changedCount:0,baselinedCount:0});`,
  "checks/checklist": `exports.refreshChecklistForCustomer=async()=>{};`,
  "sources/fetch": `exports.fetchAllSources=async()=>({outcomes:[{sourceId:'source',success:true}],regulations:[],heartbeats:[],coverageCaveats:[]});`,
  "sources/pasal-dates": `exports.enrichPasalDates=async()=>({caveats:[],attempted:0});`,
  "sources/fallback": `exports.selectFallbackSources=()=>[];exports.fallbackCaveat=()=>'';`,
  "sources/registry": `exports.selectMonitoredSources=()=>({sources:[{id:'source'}],coverageCaveats:[]});`,
};
for (const [name, source] of Object.entries(modules)) writeFileSync(`${dir}/${name.replaceAll('/', '_')}.cjs`, source);
const hooks = registerHooks({ resolve(specifier, context, next) {
  const key = specifier.replace(/^@\/lib\//, '');
  if (modules[key]) return { url: pathToFileURL(`${dir}/${key.replaceAll('/', '_')}.cjs`).href, shortCircuit: true };
  return next(specifier, context);
} });
let bridge: typeof import('./monitor-bridge');
let run: typeof import('../checks/run');
let route: typeof import('@/app/api/tariff/monitor-candidates/route');
test.before(async()=>{bridge=await import('./monitor-bridge');run=await import('../checks/run');route=await import('@/app/api/tariff/monitor-candidates/route');hooks.deregister();});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
test.beforeEach(()=>{state.rows=[];state.writes=[];state.reads=[];state.fail=false;state.workspace="tenant";});
const finding = { id: 'finding', title: 'HTS 8201.10.0000', summaryEn: 'Future duty 99.9%', reasoning: 'Claimed $987654 exposure', regulationRef: null, relevance: 'flagged' };

test('real matcher produces exact/prefix signals, excludes materials, and duplicate calls preserve original rows',async()=>{
 await bridge.queueTariffMonitorCandidates('tenant',finding);
 assert.deepEqual(state.rows.map(r=>r.match_kind),['exact_code','code_prefix']);
 const original=structuredClone(state.rows);
 await bridge.queueTariffMonitorCandidates('tenant',finding);
 assert.deepEqual(state.rows,original);
 for(const row of state.rows) {
  assert.deepEqual(Object.keys(row).sort(),['customer_id','finding_id','id','match_kind','match_reason','product_id']);
  assert.doesNotMatch(JSON.stringify(row),/99\.9|987654|Future duty|exposure/);
 }
});
test('no code, nonoverlapping code and clear findings create no candidates',async()=>{
 for(const input of [{...finding,title:'steel rule'}, {...finding,title:'HTS 9999.99.9999'}, {...finding,relevance:'clear'}]) await bridge.queueTariffMonitorCandidates('tenant',input);
 assert.equal(state.rows.length,0);
});
test('runCheck completes and records a coverage caveat when candidate persistence throws',async()=>{
 state.fail=true;
 const result=await run.runCheck('tenant',undefined,'United States');
 assert.ok(result.runId);
 assert.ok(state.writes.some(w=>w.table==='findings'));
 assert.ok(state.writes.some(w=>w.table==='check_runs'&&w.value.status==='complete'));
 assert.ok(!state.writes.some(w=>w.table==='check_runs'&&w.value.status==='failed'));
 assert.match(String(state.writes.find(w=>w.table==='alerts')?.value.body),/tariff-change signals could not be matched/);
});

test('candidate endpoint requires authentication and scopes reads to the session tenant', async()=>{
 state.workspace=null;
 assert.equal((await route.GET()).status,401);
 assert.equal(state.reads.length,0);
 state.workspace='tenant';
 const response=await route.GET();
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{candidates:[]});
 assert.ok(state.reads.some(r=>r[0]==='tariff_monitor_candidates'&&r[1]==='customer_id'&&r[2]==='tenant'));
});
