import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const previous={...process.env};
Object.assign(process.env,{CANTE_DEPLOYMENT_ROLE:'trusted-check-worker',CANTE_TRUSTED_CHECK_WORKER:'true',CANTE_MONITOR_CRON_SECRET:'SYNTHETIC-monitor-secret-0123456789abcdef',NEXT_PUBLIC_SUPABASE_URL:'https://daily-fixture.supabase.co',SUPABASE_SECRET_KEY:'SYNTHETIC-service-key'});
let requests=0;const original=fetch;
globalThis.fetch=async(input,init)=>{requests++;assert.equal(String(input),'https://daily-fixture.supabase.co/rest/v1/rpc/claim_tariff_daily_monitor');assert.equal(new Headers(init.headers).get('apikey'),'SYNTHETIC-service-key');return Response.json(null);};
const {default:worker}=await import(pathToFileURL(resolve('output/check-worker/api/check.mjs')));
try{
 assert.equal((await worker.fetch(new Request('https://worker.invalid/api/monitor'))).status,401);assert.equal(requests,0);
 const response=await worker.fetch(new Request('https://worker.invalid/api/monitor',{headers:{authorization:'Bearer '+process.env.CANTE_MONITOR_CRON_SECRET}}));assert.equal(response.status,200);assert.equal((await response.json()).status,'idle');assert.equal(requests,1);
 console.log(JSON.stringify({schedulerAuthentication:true,serviceAdmission:true,idleSkipsAllGovernmentFetches:true,realDatabaseWrites:0}));
}finally{globalThis.fetch=original;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
