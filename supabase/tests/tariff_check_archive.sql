-- Run with an administrative connection. Every fixture and assertion rolls back.
-- Works on the linked database or the isolated PostgreSQL harness.
begin;
select set_config('cante.archive_user',gen_random_uuid()::text,true),set_config('cante.archive_other_user',gen_random_uuid()::text,true),set_config('cante.archive_customer',gen_random_uuid()::text,true),set_config('cante.archive_other_customer',gen_random_uuid()::text,true),set_config('cante.archive_check',gen_random_uuid()::text,true),set_config('cante.archive_check2',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('cante.archive_user')::uuid,'archive-qa-'||current_setting('cante.archive_user')||'@example.invalid'),(current_setting('cante.archive_other_user')::uuid,'archive-qa-'||current_setting('cante.archive_other_user')||'@example.invalid');
insert into public.customers(id,slug,name) values(current_setting('cante.archive_customer')::uuid,'archive-qa-'||current_setting('cante.archive_customer'),'Archive test fixture'),(current_setting('cante.archive_other_customer')::uuid,'archive-qa-'||current_setting('cante.archive_other_customer'),'Other archive test fixture');
insert into public.customer_users(customer_id,user_id,role) values(current_setting('cante.archive_customer')::uuid,current_setting('cante.archive_user')::uuid,'member'),(current_setting('cante.archive_other_customer')::uuid,current_setting('cante.archive_other_user')::uuid,'member');
create function pg_temp.expect_denied(command text) returns void language plpgsql security invoker as $$
begin
 begin execute command; exception when others then return; end;
 raise exception 'Expected denial: %',command;
end;$$;
select set_config('request.jwt.claim.sub',current_setting('cante.archive_user'),true);
set local role authenticated;
insert into public.tariff_check_records(id,customer_id,filename,input_csv,confirmations,engine) values(current_setting('cante.archive_check')::uuid,current_setting('cante.archive_customer')::uuid,'test.csv','original,CSV,✓','{}','{}'),(current_setting('cante.archive_check2')::uuid,current_setting('cante.archive_customer')::uuid,'test2.csv','second CSV','{}','{}');
select pg_temp.expect_denied($q$update public.tariff_check_records set filename='rewritten'$q$);
select pg_temp.expect_denied($q$delete from public.tariff_check_records$q$);
select pg_temp.expect_denied($q$insert into public.tariff_check_records(customer_id,actor_id,filename,input_csv,confirmations,engine) values(current_setting('cante.archive_customer')::uuid,gen_random_uuid(),'fake','x','{}','{}')$q$);
select pg_temp.expect_denied($q$insert into public.tariff_check_records(customer_id,created_at,filename,input_csv,confirmations,engine) values(current_setting('cante.archive_customer')::uuid,'2000-01-01','fake','x','{}','{}')$q$);
select pg_temp.expect_denied($q$insert into public.tariff_check_records(customer_id,filename,input_csv,confirmations,engine) values(current_setting('cante.archive_other_customer')::uuid,'fake','x','{}','{}')$q$);
select public.complete_tariff_check(current_setting('cante.archive_check')::uuid,current_setting('cante.archive_customer')::uuid,'{"products":1,"totalDuty":null}',jsonb_build_array(jsonb_build_object('url','https://hts.usitc.gov/reststop/currentRelease','body','version one','sha256',encode(extensions.digest('version one','sha256'),'hex'),'status','fetched','fetchedAt',now())));
select public.complete_tariff_check(current_setting('cante.archive_check2')::uuid,current_setting('cante.archive_customer')::uuid,'{"products":1,"totalDuty":5}',jsonb_build_array(jsonb_build_object('url','https://hts.usitc.gov/reststop/currentRelease','body','version one','sha256',encode(extensions.digest('version one','sha256'),'hex'),'status','fetched','fetchedAt',now()),jsonb_build_object('url','https://hts.usitc.gov/reststop/currentRelease','body','version two','sha256',encode(extensions.digest('version two','sha256'),'hex'),'status','fetched','fetchedAt',now())));
do $$begin
 if (select count(*) from public.tariff_source_versions)<>2 then raise exception 'Deduplication/version preservation failed'; end if;
 if (select count(*) from public.tariff_check_events where kind='completed')<>2 then raise exception 'Completed events missing'; end if;
 if not exists(select 1 from public.tariff_check_records where input_csv='original,CSV,✓' and input_sha256=encode(extensions.digest('original,CSV,✓','sha256'),'hex') and actor_id=auth.uid()) then raise exception 'Original evidence or attribution changed'; end if;
end;$$;
select pg_temp.expect_denied($q$select public.complete_tariff_check(current_setting('cante.archive_check')::uuid,current_setting('cante.archive_customer')::uuid,'{}','[]')$q$);
insert into public.tariff_check_events(customer_id,check_id,kind,payload_text) values(current_setting('cante.archive_customer')::uuid,current_setting('cante.archive_check')::uuid,'review','{"decision":"reviewed","note":"First review"}'),(current_setting('cante.archive_customer')::uuid,current_setting('cante.archive_check')::uuid,'review','{"decision":"needs_information","note":"Correction; first review retained"}');
select pg_temp.expect_denied($q$insert into public.tariff_check_events(customer_id,check_id,kind,payload_text) values(current_setting('cante.archive_customer')::uuid,current_setting('cante.archive_check')::uuid,'review','{}')$q$);
select pg_temp.expect_denied($q$update public.tariff_check_events set payload_text='{}'$q$);
select pg_temp.expect_denied($q$delete from public.tariff_source_versions$q$);
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.archive_user'),true);
set local role authenticated;
insert into public.tariff_source_versions(customer_id,url,encoding,body,compression,original_sha256) values(current_setting('cante.archive_customer')::uuid,'https://www.usitc.gov/archive-test.json','base64','H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==','gzip',encode(extensions.digest('hello','sha256'),'hex'));
select pg_temp.expect_denied($q$insert into public.tariff_source_versions(customer_id,url,encoding,body,compression) values(current_setting('cante.archive_customer')::uuid,'https://www.usitc.gov/bad.json','base64','aA==','gzip')$q$);
reset role;
-- The trigger rejects even a privileged accidental mutation.
select pg_temp.expect_denied($q$update public.tariff_source_versions set body='rewritten' where customer_id=current_setting('cante.archive_customer')::uuid$q$);
select set_config('request.jwt.claim.sub',current_setting('cante.archive_other_user'),true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.tariff_check_records) or exists(select 1 from public.tariff_check_events) or exists(select 1 from public.tariff_source_versions) then raise exception 'Cross-tenant read leak'; end if;
end;$$;
select pg_temp.expect_denied($q$select public.complete_tariff_check(current_setting('cante.archive_check')::uuid,current_setting('cante.archive_customer')::uuid,'{}','[]')$q$);
reset role;
update public.customer_users set role='viewer' where user_id=current_setting('cante.archive_user')::uuid;
select set_config('request.jwt.claim.sub',current_setting('cante.archive_user'),true);
set local role authenticated;
do $$begin if (select count(*) from public.tariff_check_records)<>2 then raise exception 'Viewer cannot read history'; end if; end;$$;
select pg_temp.expect_denied($q$insert into public.tariff_check_records(customer_id,filename,input_csv,confirmations,engine) values(current_setting('cante.archive_customer')::uuid,'viewer','x','{}','{}')$q$);
select pg_temp.expect_denied($q$insert into public.tariff_check_events(customer_id,check_id,kind,payload_text) values(current_setting('cante.archive_customer')::uuid,current_setting('cante.archive_check')::uuid,'review','{"decision":"reviewed","note":"viewer"}')$q$);
reset role;
set local role anon;
select pg_temp.expect_denied($q$select * from public.tariff_check_records$q$);
select pg_temp.expect_denied($q$select * from public.tariff_source_versions$q$);
select pg_temp.expect_denied($q$select * from public.tariff_check_events$q$);
reset role;
rollback;
