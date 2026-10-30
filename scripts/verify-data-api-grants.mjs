/** Isolated local PostgreSQL permission replay, never a remote reset.
 * Replays the four affected table-creation migrations with automatic API grants
 * disabled. pgvector declarations alone are stubbed as text; vector behavior is
 * outside this test. Actual role grants, table constraints and RLS are executed.
 * Requires an installed PostgreSQL bin directory; installs nothing. */
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const bin=process.argv.find(v=>v.startsWith('--postgres-bin='))?.slice('--postgres-bin='.length);
if(!bin?.startsWith('/'))throw Error('Use --postgres-bin=/absolute/installed/postgresql/bin');
const work=mkdtempSync(join(tmpdir(),'cante-explicit-grants-')),data=join(work,'data');
const files=['202608230001_cante_production.sql','202610060001_tariff_impact_runs.sql','202610060002_tariff_monitor_candidates.sql','202610080001_tariff_impact_events.sql'];
const originals=files.map(f=>readFileSync('supabase/migrations/'+f,'utf8'));
const tables=originals.flatMap(s=>[...s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gi)].map(m=>m[1]));assert.equal(new Set(tables).size,37);
function run(name,args){const r=spawnSync(join(bin,name),args,{encoding:'utf8',env:{...process.env,LC_ALL:'C'}});if(r.status!==0)throw Error(name+' failed: '+r.stderr);return r.stdout;}
function sql(text){const file=join(work,'test.sql');writeFileSync(file,text);return run('psql',['-X','-q','-v','ON_ERROR_STOP=1','-h',work,'-p','55451','-U','postgres','-d','postgres','-f',file]);}
const privileges=()=>`do $$declare t text;p text;begin foreach t in array array[${tables.map(t=>"'public."+t+"'").join(',')}] loop foreach p in array array['select','insert','update','delete'] loop if not has_table_privilege('service_role',t,p) then raise exception 'Missing worker % on %',p,t;end if;end loop;end loop;if not has_sequence_privilege('service_role','public.document_chunks_id_seq','usage') then raise exception 'Missing worker sequence';end if;end;$$;`;
let started=false;
try{
 run('initdb',['-D',data,'--auth=trust','--no-locale','-U','postgres']);
 run('pg_ctl',['-D',data,'-l',join(work,'server.log'),'-o',`-k ${work} -p 55451 -c listen_addresses=''`,'-w','start']);started=true;
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;alter default privileges in schema public revoke all on tables from anon,authenticated,service_role;alter default privileges in schema public revoke all on sequences from anon,authenticated,service_role;set check_function_bodies=off;`+originals.join('\n').replace(/create extension if not exists vector with schema extensions;/,'').replace(/extensions\.vector(?:\(384\))?/g,'text').replace(/create index if not exists document_chunks_embedding_hnsw_idx\s+on public\.document_chunks using hnsw \(embedding text_cosine_ops\);/,'')+privileges());
 // Negative control: the previous implicit worker access would be absent.
 sql(`revoke select,insert,update,delete on ${tables.map(t=>'public.'+t).join(',')} from service_role;revoke all on sequence public.document_chunks_id_seq from service_role;do $$declare n integer;begin select count(*) into n from pg_tables where schemaname='public' and not has_table_privilege('service_role',quote_ident(schemaname)||'.'||quote_ident(tablename),'select');if n<>37 then raise exception 'Negative control did not remove worker grants';end if;end;$$;`);
 const corrective=readFileSync('supabase/migrations/20261023165515_explicit_data_api_worker_grants.sql','utf8');
 sql(corrective+privileges()+corrective+privileges());
 sql(`insert into auth.users values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');insert into public.customers(id,slug,name) values('00000000-0000-4000-8000-000000000011','synthetic-a','Synthetic A'),('00000000-0000-4000-8000-000000000012','synthetic-b','Synthetic B');insert into public.customer_users(customer_id,user_id,role) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','owner');insert into public.products(id,customer_id,sku,name) values('SYNTHETIC-A','00000000-0000-4000-8000-000000000011','SYNTHETIC-A','Synthetic A'),('SYNTHETIC-B','00000000-0000-4000-8000-000000000012','SYNTHETIC-B','Synthetic B');set role authenticated;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';do $$declare n integer;begin select count(*) into n from public.products;if n<>1 then raise exception 'Tenant isolation failed';end if;update public.products set name='SYNTHETIC-ILLEGAL' where id='SYNTHETIC-B';get diagnostics n=row_count;if n<>0 then raise exception 'Foreign update succeeded';end if;update public.products set name='SYNTHETIC-OWN' where id='SYNTHETIC-A';get diagnostics n=row_count;if n<>1 then raise exception 'Own update failed';end if;end;$$;reset role;set role anon;do $$begin begin perform id from public.products;raise exception 'Anonymous product access succeeded';exception when insufficient_privilege then null;end;end;$$;reset role;`);
 console.log(JSON.stringify({freshTableMigrations:4,publicTables:37,automaticGrants:false,negativeControlDetectedMissingPermissions:true,correctiveMigrationIdempotent:true,workerDmlAndSequence:true,tenantOwnAccess:true,foreignReadAndUpdateDenied:true,anonymousDenied:true,remoteWrites:0,limitation:'Local PostgreSQL permission/RLS replay; pgvector substituted with text. Not a full Supabase reset.'}));
}finally{if(started)run('pg_ctl',['-D',data,'-m','fast','-w','stop']);rmSync(work,{recursive:true,force:true});}
