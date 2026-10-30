/** Explicit operational setup. Vault stores the scheduler secret; only the
 * separate worker receives it. No workspace is enabled by this command. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);const target=args.find(a=>a.startsWith('--worker='))?.slice(9);const write=args.includes('--write');
if(!target)throw Error('Specify --worker=https://<trusted-worker>/api/monitor');const url=new URL(target);if(url.protocol!=='https:'||!url.hostname.endsWith('.vercel.app')||url.pathname!=='/api/monitor'||url.search||url.hash||url.username||url.password)throw Error('Use the deployed trusted-worker monitor URL.');
if(!write){console.log(JSON.stringify({dryRun:true,worker:target,schedule:'every five minutes; one due opted-in workspace; each workspace daily',delivery:'in-app only',enablesWorkspaces:false}));process.exit(0);}
const env=readFileSync('.env.check-worker.local','utf8');const secret=env.match(/^CANTE_MONITOR_CRON_SECRET=(.*)$/m)?.[1].replace(/^"|"$/g,'');if(!secret||!/^[a-f0-9]{64}$/.test(secret))throw Error('Configure a 32-byte scheduler secret on the worker first.');
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const sql=`begin;
do $$declare existing uuid;begin
 select id into existing from vault.secrets where name='cante_monitor_worker_url';if existing is null then perform vault.create_secret(${literal(target)},'cante_monitor_worker_url');else perform vault.update_secret(existing,${literal(target)});end if;
 select id into existing from vault.secrets where name='cante_monitor_worker_secret';if existing is null then perform vault.create_secret(${literal(secret)},'cante_monitor_worker_secret');else perform vault.update_secret(existing,${literal(secret)});end if;
end;$$;
select cron.schedule('cante-workspace-daily-monitor','*/5 * * * *',$job$
 select net.http_get(url:=(select decrypted_secret from vault.decrypted_secrets where name='cante_monitor_worker_url'),headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cante_monitor_worker_secret')),timeout_milliseconds:=300000)
 where exists(select 1 from public.tariff_daily_monitors where enabled and next_check_at<=now());
$job$);
commit;
select jobname,schedule,active from cron.job where jobname='cante-workspace-daily-monitor';`;
const dir=mkdtempSync(join(tmpdir(),'cante-monitor-setup-'));const file=join(dir,'setup.sql');writeFileSync(file,sql,{mode:0o600});try{const result=spawnSync('npx',['supabase','db','query','--linked','--project-ref','nvdsjqzbzsczvmvjxhro','--file',file],{encoding:'utf8'});if(result.status)throw Error('Daily scheduler configuration failed; inspect Supabase before retrying.');console.log(result.stdout);}finally{rmSync(dir,{recursive:true,force:true});}
