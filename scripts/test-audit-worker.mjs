/** Actual bundled worker, isolated Auth/REST fixtures. No real account, model,
 * government fetch or database write. Numerical synthetic tests are separate. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const engineVersion=/export const AUDIT_VERSION = "(historical-audit-v[0-9]+)"/.exec(await readFile('app/api/audits/model.ts','utf8'))?.[1];assert(engineVersion);
const csv=await readFile('scripts/test-fixtures/historical-audits/entries.csv','utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const auditId='12345678-1234-4234-8234-123456789abc',customerId='12345678-1234-4234-8234-123456789def',userId='12345678-1234-4234-8234-123456789123';
const uploadId='12345678-1234-4234-8234-123456789444',runId='12345678-1234-4234-8234-123456789555',lease='12345678-1234-4234-8234-123456789666';
const mapping={entry:'entry_number',line:'line_number',date:'entry_date',sku:'sku',description:'description',hts:'hts_code',origin:'country_of_origin',supplier:'supplier',value:'customs_value_usd',basePaid:null,additionalPaid:null,paid:'total_duties_paid',currency:'currency',chapter99:null,quantity:'quantity',unit:'unit',documents:'documents',evidenceOrigin:'evidence_origin',evidenceHts:'evidence_hts',exclusion:'exclusion_claim'};
const batch={id:auditId,customer_id:customerId,upload_id:uploadId,input_run_id:'SYNTHETIC-input',mapping,options:{dateFormat:'iso',currencyUsd:true,dutiesOnly:true,ordinaryConsumption:true,componentsComplete:false},bundle_ids:[],revision:0,checkpoint:[],active_run_id:runId,lease_token:lease};
const secret='synthetic-worker-secret-0123456789abcdef';
Object.assign(process.env,{VERCEL:'1',CANTE_DEPLOYMENT_ROLE:'trusted-check-worker',CANTE_TRUSTED_CHECK_WORKER:'true',CANTE_CHECK_DISPATCH_SECRET:secret,NEXT_PUBLIC_SUPABASE_URL:'https://audit-fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public-key',SUPABASE_SECRET_KEY:'fixture-worker-key'});
let activeCsv=csv,checkpointLengths=[],proof=null,lines=[],calls=[],rejectClaim=false,interruptOnce=false,transientCheckpointOnce=false;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input:input.url),method=init.method??'GET',table=url.pathname.split('/').at(-1);calls.push({table,method});
 assert.equal(url.hostname,'audit-fixture.supabase.co','No government/model/current-rate network access allowed');
 if(table==='user')return Response.json({id:userId,aud:'authenticated',role:'authenticated'});
 if(table==='customer_users'){assert.equal(url.searchParams.get('user_id'),'eq.'+userId);return Response.json({customer_id:customerId,role:'member'});}
 if(table==='claim_historical_audit'){const body=JSON.parse(init.body);assert.equal(body.target_customer,customerId);return rejectClaim?Response.json({message:'already running'},{status:409}):Response.json(batch);}
 if(table==='audit_batches'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);if(method==='PATCH'){assert.equal(url.searchParams.get('lease_token'),'eq.'+lease);const update=JSON.parse(init.body);if(update.checkpoint){checkpointLengths.push(update.checkpoint.length);batch.checkpoint=update.checkpoint;batch.input_hash=update.input_hash;if(transientCheckpointOnce&&update.checkpoint.length===25){transientCheckpointOnce=false;return Response.json({code:'',message:'SYNTHETIC lost successful checkpoint response'},{status:503});}if(interruptOnce&&update.checkpoint.length===25){interruptOnce=false;return Response.json({message:'Synthetic interruption after checkpoint commit'},{status:400});}}return Response.json({id:auditId});}return Response.json({id:auditId});}
 if(table==='chat_file_uploads'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);return Response.json({id:uploadId,customer_id:customerId,filename:'SYNTHETIC.csv',size_bytes:Buffer.byteLength(activeCsv),sha256:hash(activeCsv)});}
 if(table==='chat_file_chunks'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);return Response.json({body:Buffer.from(activeCsv).toString('base64')});}
 if(table==='audit_review_events'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);return Response.json([]);}
 if(table==='products'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);assert.equal(new Headers(init.headers).get('apikey'),'fixture-public-key');return Response.json(Array.from({length:12},(_,i)=>({id:'synthetic-product-'+i,sku:'SYN-PART-'+(i+1),origin_country:'CN'})));}
 if(table==='finish_historical_audit'){const body=JSON.parse(init.body);assert.equal(body.target_customer,customerId);assert.equal(body.token,lease);assert.equal(body.engine,engineVersion);lines=body.result_lines;assert.equal(lines.length,120);assert.equal(body.summary_data.calculated,0);assert.equal(body.summary_data.unresolved,120);assert.equal(body.summary_data.overpayment,'0.00');proof={input_sha256:body.input_fingerprint,result_sha256:hash(lines.join('\n'))};return Response.json(runId);}
 if(table==='tariff_impact_attestations'){assert.equal(url.searchParams.get('customer_id'),'eq.'+customerId);return Response.json(proof);}
 throw Error('Unexpected database operation '+method+' '+table);
};
const {default:worker}=await import(pathToFileURL(resolve('output/check-worker/api/check.mjs')));
function request(signatureValid=true){const body=JSON.stringify({task:'historical_audit',auditId,customerId,revision:0}),timestamp=String(Date.now()),authorization='Bearer fixture.user.token';const signature=createHmac('sha256',secret).update(`${timestamp}\n${body}\n${authorization}`).digest('hex');return new Request('https://audit-fixture.test/api/check',{method:'POST',headers:{authorization,'x-cante-task':'historical-audit','x-cante-dispatched-at':timestamp,'x-cante-dispatch-signature':signatureValid?signature:'0'.repeat(64)},body});}
const bad=await worker.fetch(request(false));assert.equal(bad.status,401);assert.equal(calls.length,0);
const response=await worker.fetch(request());assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'done',JSON.stringify(events.at(-1)));assert.equal(events.at(-1).verified,true);assert(proof);assert(lines.every(s=>JSON.parse(s).result.expected===null));assert(calls.some(c=>c.table==='finish_historical_audit'));assert(!calls.some(c=>c.table==='tariff_stacking_rules'));
proof=null;lines=[];batch.checkpoint=[];delete batch.input_hash;interruptOnce=true;const interrupted=await worker.fetch(request());const failedEvents=(await interrupted.text()).trim().split('\n').map(JSON.parse);assert.equal(failedEvents.at(-1).type,'error');assert.equal(proof,null);assert.equal(batch.checkpoint.length,25);const resumed=await worker.fetch(request());const resumedEvents=(await resumed.text()).trim().split('\n').map(JSON.parse);assert.equal(resumedEvents.at(-1).type,'done');assert.equal(lines.length,120);
proof=null;lines=[];batch.checkpoint=[];delete batch.input_hash;calls=[];transientCheckpointOnce=true;const recovered=await worker.fetch(request());const recoveredEvents=(await recovered.text()).trim().split('\n').map(JSON.parse);assert.equal(recoveredEvents.at(-1).type,'done');assert.equal(recoveredEvents.filter(e=>e.message==='Retrying the saved progress write…').length,1);assert.equal(calls.filter(c=>c.table==='finish_historical_audit').length,1);assert.equal(lines.length,120);
// Alternating years force one-line reference groups. The checkpoint cadence
// still remains bounded without 120 growing database writes or changed results.
// Use an explicit alternating replacement so adjacent records always differ.
let yearIndex=0;activeCsv=csv.replace(/20\d{2}-\d{2}-\d{2}/g,()=>++yearIndex%2?'2000-06-15':'2014-06-15');
proof=null;lines=[];batch.checkpoint=[];delete batch.input_hash;checkpointLengths=[];calls=[];
const mixed=await worker.fetch(request()),mixedEvents=(await mixed.text()).trim().split('\n').map(JSON.parse);assert.equal(mixedEvents.at(-1).type,'done');assert.equal(lines.length,120);assert.deepEqual(checkpointLengths,[25,50,75,100,120]);assert.equal(mixedEvents.filter(e=>e.message?.startsWith('Reading dated sources')).length,120);assert.equal(calls.filter(c=>c.table==='finish_historical_audit').length,1);assert(lines.every((s,i)=>JSON.parse(s).entry.date===(i%2?'2014-06-15':'2000-06-15')));
rejectClaim=true;assert.equal((await worker.fetch(request())).status,409);
console.log(JSON.stringify({artifact:'output/check-worker/api/check.mjs',actualParserAndEngine:true,originalEntriesRetained:lines.length,missingHistoricalCoverage:'all 120 unresolved; no current-rate substitute',signedDispatchAndTenantScope:true,executionProofMatchesWorkerOutput:true,checkpointResume:true,checkpointTransportRecovery:true,mixedYearCheckpointWrites:checkpointLengths.length,database:'isolated REST fixtures',realDatabaseWrites:0,modelCalls:0}));
