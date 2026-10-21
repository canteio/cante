-- Synthetic accounts and counters only; every assertion rolls back.
begin;
select set_config('cante.quota_user',gen_random_uuid()::text,true),set_config('cante.quota_other',gen_random_uuid()::text,true),set_config('cante.quota_tenant',gen_random_uuid()::text,true),set_config('cante.quota_other_tenant',gen_random_uuid()::text,true),set_config('cante.quota_check',gen_random_uuid()::text,true);
insert into auth.users(id,email) select current_setting(k)::uuid,'quota-qa-'||current_setting(k)||'@example.invalid' from unnest(array['cante.quota_user','cante.quota_other']) k;
insert into public.customers(id,slug,name) select current_setting(k)::uuid,'quota-qa-'||current_setting(k),'Quota permission fixture' from unnest(array['cante.quota_tenant','cante.quota_other_tenant']) k;
insert into public.customer_users(customer_id,user_id,role) values(current_setting('cante.quota_tenant')::uuid,current_setting('cante.quota_user')::uuid,'owner'),(current_setting('cante.quota_other_tenant')::uuid,current_setting('cante.quota_other')::uuid,'admin');
create function pg_temp.expect_quota_denial(command text, expected_state text default '42501') returns void language plpgsql security invoker as $$
begin
 begin execute command; exception when others then if sqlstate=expected_state then return; else raise; end if; end;
 raise exception 'Expected % denial: %',expected_state,command;
end;$$;
select set_config('request.jwt.claim.sub',current_setting('cante.quota_user'),true);
set local role authenticated;
do $$declare a jsonb; b jsonb; begin
 a:=public.acquire_api_request(current_setting('cante.quota_tenant')::uuid,'check');
 b:=public.acquire_api_request(current_setting('cante.quota_tenant')::uuid,'check');
 if a->>'allowed'<>'true' or b->>'allowed'<>'false' then raise exception 'Concurrent checks were not capped'; end if;
 if (b->>'retryAfter')::integer<1 then raise exception 'Missing retry delay'; end if;
 perform public.release_api_request((a->>'leaseId')::uuid);
 for i in 1..5 loop
  a:=public.acquire_api_request(current_setting('cante.quota_tenant')::uuid,'check');
  if a->>'allowed'<>'true' then raise exception 'Expected remaining hourly check budget'; end if;
  perform public.release_api_request((a->>'leaseId')::uuid);
 end loop;
 a:=public.acquire_api_request(current_setting('cante.quota_tenant')::uuid,'check');
 if a->>'allowed'<>'false' then raise exception 'Hourly budget bypassed by releasing lease'; end if;
end;$$;
select pg_temp.expect_quota_denial($q$select public.acquire_api_request(current_setting('cante.quota_other_tenant')::uuid,'chat')$q$);
select pg_temp.expect_quota_denial('delete from private.api_usage_counters');
select pg_temp.expect_quota_denial('select * from private.api_request_leases');
select pg_temp.expect_quota_denial($q$insert into public.tariff_check_attestations(check_id,customer_id,terminal_event_id,input_sha256,event_sha256,verifier_version) values(gen_random_uuid(),current_setting('cante.quota_tenant')::uuid,gen_random_uuid(),repeat('a',64),repeat('b',64),'forged')$q$);
insert into public.tariff_check_records(id,customer_id,filename,input_csv,confirmations,engine) values(current_setting('cante.quota_check')::uuid,current_setting('cante.quota_tenant')::uuid,'quota.csv','sku,hts','{}','{}');
reset role;
-- Daily caps cannot be reset by changing HTTP routes or opening a new instance.
-- Trusted-worker proof is readable only in its workspace and cannot be forged
-- or changed by a customer. These synthetic terminal/proof rows roll back too.
insert into public.tariff_check_events(customer_id,check_id,actor_id,kind,payload_text) values(current_setting('cante.quota_tenant')::uuid,current_setting('cante.quota_check')::uuid,current_setting('cante.quota_user')::uuid,'completed','{"report":{"totalDuty":1},"sources":[]}');
insert into public.tariff_check_attestations(check_id,customer_id,terminal_event_id,input_sha256,event_sha256,verifier_version)
select r.id,r.customer_id,e.id,r.input_sha256,e.payload_sha256,'Transactional worker fixture'
from public.tariff_check_records r join public.tariff_check_events e on e.check_id=r.id where r.id=current_setting('cante.quota_check')::uuid;
set local role authenticated;
do $$begin if (select count(*) from public.tariff_check_attestations where check_id=current_setting('cante.quota_check')::uuid)<>1 then raise exception 'Member cannot read scoped attestation'; end if; end;$$;
select pg_temp.expect_quota_denial($q$update public.tariff_check_attestations set verifier_version='forged'$q$);
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.quota_other'),true);
set local role authenticated;
do $$begin if exists(select 1 from public.tariff_check_attestations where check_id=current_setting('cante.quota_check')::uuid) then raise exception 'Cross-tenant attestation leak'; end if; end;$$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.quota_user'),true);
insert into private.api_usage_counters(scope,scope_id,operation,window_start,period,used) values('user',current_setting('cante.quota_user')::uuid,'chat',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC','day',100);
set local role authenticated;
do $$begin if public.acquire_api_request(current_setting('cante.quota_tenant')::uuid,'chat')->>'allowed'<>'false' then raise exception 'Daily cap bypassed'; end if; end;$$;
reset role;
-- Direct Data API writes hit the same storage cap, even without any HTTP request permit.
insert into private.tariff_archive_storage(customer_id,storage_day,bytes,rows) values(current_setting('cante.quota_tenant')::uuid,(now() at time zone 'UTC')::date,256*1024*1024,1)
on conflict(customer_id,storage_day) do update set bytes=excluded.bytes;
set local role authenticated;
select pg_temp.expect_quota_denial($q$insert into public.tariff_check_events(customer_id,check_id,kind,payload_text) values(current_setting('cante.quota_tenant')::uuid,current_setting('cante.quota_check')::uuid,'review','{"decision":"reviewed","note":"fixture"}')$q$,'54000');
reset role;
set local role anon;
select pg_temp.expect_quota_denial($q$select public.acquire_api_request(current_setting('cante.quota_tenant')::uuid,'chat')$q$);
reset role;
rollback;
