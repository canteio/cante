/** Offline end-to-end test of the deployed artifact: real source bytes replayed,
 * real parser/engine, isolated Auth/database fixtures. Never touches a real tenant. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, createHmac } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const files=(await readdir('raw/tariff-workflow')).filter(f=>f.endsWith('.json')).sort();
if(!files.length)throw Error('Run npm run verify:workflow first to retain live official evidence.');
const live=JSON.parse(await readFile('raw/tariff-workflow/'+files.at(-1),'utf8')).result;
const blockedIndex=process.argv.includes('--block-index');
const daily=process.argv.includes('--daily');
const lease='12345678-1234-4234-8234-123456789777';
const captures=new Map(live.sources.filter(s=>s.status==='fetched'&&s.body!==null).map(s=>[s.url,s]));
const input=await readFile('public/examples/tariff-workflow-test.csv','utf8');
const checkId='12345678-1234-4234-8234-123456789abc',customerId='12345678-1234-4234-8234-123456789def',userId='12345678-1234-4234-8234-123456789123';
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret='bundle-fixture-secret-0123456789abcdef';
Object.assign(process.env,{VERCEL:'1',CANTE_DEPLOYMENT_ROLE:'trusted-check-worker',CANTE_TRUSTED_CHECK_WORKER:'true',CANTE_CHECK_DISPATCH_SECRET:secret,CANTE_MONITOR_CRON_SECRET:secret,NEXT_PUBLIC_SUPABASE_URL:'https://worker-fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable-key',SUPABASE_SECRET_KEY:'fixture-service-key'});
let terminal=null,proof=null,evidenceCount=0,finishedDaily=false;const databaseOperations=[];
const record={id:checkId,customer_id:customerId,actor_id:userId,input_csv:input,input_sha256:hash(input),confirmations:{},engine:{},filename:'Fictional workflow test.csv',created_at:'2026-10-21T00:00:00Z'};
globalThis.fetch=async(inputArg,init={})=>{
 const url=new URL(typeof inputArg==='string'?inputArg:inputArg instanceof URL?inputArg:inputArg.url);
 const method=(init.method??(inputArg instanceof Request?inputArg.method:'GET')).toUpperCase();
 if(blockedIndex&&url.hostname==='www.usitc.gov'&&url.pathname.includes('/archive/list'))return new Response('fixture blocked archive index',{status:403});
 const captured=captures.get(url.toString());
 if(captured){let bytes=captured.bodyEncoding==='base64'?Buffer.from(captured.body,'base64'):Buffer.from(captured.body);if(captured.compression==='gzip')bytes=gunzipSync(bytes);return new Response(bytes);}
 if(url.hostname!=='worker-fixture.supabase.co')throw Error('Unexpected network request blocked: '+url.hostname+url.pathname);
 const table=url.pathname.split('/').at(-1);databaseOperations.push({method,table});
 if(table==='claim_tariff_daily_monitor')return Response.json({customer_id:customerId,lease_token:lease});
 if(table==='products'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);return Response.json(live.rows.map(r=>({id:r.product.sku,sku:r.product.sku,name:r.product.sku,origin_country:r.product.origin,tariff_inputs:r.product})));}
 if(table==='product_classifications')return Response.json(live.rows.map(r=>({product_id:r.product.sku,code:r.product.hts,status:'confirmed'})));
 if(table==='begin_tariff_daily_check'){const args=JSON.parse(init.body);assert.equal(args.target_customer,customerId);assert.equal(args.token,lease);record.input_csv=args.csv;record.input_sha256=hash(args.csv);return Response.json(checkId);}
 if(table==='finish_tariff_daily_monitor'){const args=JSON.parse(init.body);assert.equal(args.success,true);assert(proof);finishedDaily=true;return Response.json(null);}
 if(table==='tariff_daily_events'){const event=JSON.parse(init.body);assert.equal(event.customer_id,customerId);assert.equal(event.kind,'review');return new Response(null,{status:201});}
 if(table==='user')return Response.json({id:userId,aud:'authenticated',role:'authenticated'});
 if(table==='customer_users')return Response.json({customer_id:customerId,role:'member'});
 if(table==='tariff_check_records')return Response.json(url.searchParams.has('created_at')?[]:record);
 if(table==='tariff_check_events')return Response.json(terminal?[terminal]:[]);
 if(table==='tariff_stacking_flagged_measures'||table==='tariff_stacking_rules')return Response.json([]);
 if(table==='tariff_check_attestations'){
  if(method==='POST'){proof=JSON.parse(init.body);return new Response(null,{status:201});}
  return Response.json(proof);
 }
 if(table==='complete_tariff_check'||table==='complete_tariff_daily_check'){
  assert.equal(method,'POST');const args=JSON.parse(init.body);assert.equal(args.target_check_id,checkId);assert.equal(args.target_customer_id,customerId);
  if(daily)assert.equal(args.token,lease);
  assert.notEqual(args.outcome,'failed','The actual bundled worker failed.');
  for(const s of args.sources)if(s.body!==null){const bytes=s.bodyEncoding==='base64'?Buffer.from(s.body,'base64'):Buffer.from(s.body);assert.equal(hash(bytes),s.sha256);if(s.compression==='gzip')assert.equal(hash(gunzipSync(bytes)),s.originalSha256);evidenceCount++;}
  const payload_text=JSON.stringify({report:JSON.parse(args.report_text),sources:args.sources.map(({body,...source},i)=>({...source,versionId:body===null?null:'fixture-version-'+i}))});
  terminal={id:'fixture-event',kind:'completed',created_at:new Date().toISOString(),actor_id:userId,payload_text,payload_sha256:hash(payload_text)};
  return Response.json('fixture-event');
 }
 throw Error('Unexpected fixture database operation: '+method+' '+table);
};
const {default:worker}=await import(pathToFileURL(resolve('output/check-worker/api/check.mjs')));
const body=JSON.stringify({checkId,customerId}),timestamp=String(Date.now()),authorization='Bearer fixture.user.token';
const signature=createHmac('sha256',secret).update(`${timestamp}\n${body}\n${authorization}`).digest('hex');
const response=await worker.fetch(daily?new Request('https://worker-fixture.test/api/monitor',{headers:{authorization:'Bearer '+secret}}):new Request('https://worker-fixture.test/api/check',{method:'POST',headers:{authorization,'x-cante-dispatched-at':timestamp,'x-cante-dispatch-signature':signature},body}));
assert.equal(response.status,200,await response.clone().text());
let done;
if(daily){const result=await response.json();assert.equal(result.status,'completed');assert(finishedDaily);done={type:'done',verified:!!proof,result:JSON.parse(terminal.payload_text).report};}
else{const events=(await response.text()).trim().split('\n').map(JSON.parse);done=events.at(-1);}
assert.equal(done.type,'done',JSON.stringify(done));assert.equal(done.verified,true);assert(proof);assert.equal(proof.input_sha256,record.input_sha256);assert.equal(proof.event_sha256,terminal.payload_sha256);
assert.deepEqual(done.result.rows.map(r=>r.stack?.totalAmount??null),[4150,5900,4400,1250,null]);assert.equal(done.result.totalDuty,null);if(!daily)assert(done.result.sources.every(s=>s.body===null));
if(blockedIndex){assert.equal(done.result.historicalComparison.status,'compared');assert.equal(done.result.historicalComparison.coverage.legalNotes,true);assert.equal(done.result.historicalComparison.coverage.historicalSchedule,false);assert.equal(done.result.historicalComparison.legalChanges.length,1);}
console.log(JSON.stringify({scheduledDaily:daily,blockedIndexFixture:blockedIndex,artifact:'output/check-worker/api/check.mjs',rows:done.result.rows.length,sourceBodiesVerified:evidenceCount,attestationBoundToOwnOutput:true,actualParserAndEngine:true,authAndDatabase:'isolated fixtures',governmentSources:'replayed retained live evidence',realDatabaseWrites:0},null,2));
