-- Administrative connection. Originals and all assertions roll back.
begin;
select set_config('cante.file_user',gen_random_uuid()::text,true),set_config('cante.file_other',gen_random_uuid()::text,true),set_config('cante.file_customer',gen_random_uuid()::text,true),set_config('cante.file_other_customer',gen_random_uuid()::text,true),set_config('cante.file_id',gen_random_uuid()::text,true);
insert into auth.users(id,email) select current_setting(k)::uuid,'file-qa-'||current_setting(k)||'@example.invalid' from unnest(array['cante.file_user','cante.file_other']) k;
insert into public.customers(id,slug,name) select current_setting(k)::uuid,'file-qa-'||current_setting(k),'Original-file fixture' from unnest(array['cante.file_customer','cante.file_other_customer']) k;
insert into public.customer_users(customer_id,user_id,role) values(current_setting('cante.file_customer')::uuid,current_setting('cante.file_user')::uuid,'owner'),(current_setting('cante.file_other_customer')::uuid,current_setting('cante.file_other')::uuid,'owner');
create function pg_temp.expect_file_denial(command text) returns void language plpgsql security invoker as $$
begin begin execute command;exception when others then return;end;raise exception 'Expected denial: %',command;end;$$;
select set_config('request.jwt.claim.sub',current_setting('cante.file_user'),true);
set local role authenticated;
insert into public.chat_file_uploads(id,customer_id,filename,size_bytes,sha256) values(current_setting('cante.file_id')::uuid,current_setting('cante.file_customer')::uuid,'fixture.csv',3,encode(extensions.digest('abc','sha256'),'hex'));
insert into public.chat_file_chunks(upload_id,customer_id,part,body) values(current_setting('cante.file_id')::uuid,current_setting('cante.file_customer')::uuid,0,'YWJj');
select pg_temp.expect_file_denial($q$insert into public.chat_file_chunks(upload_id,customer_id,part,body) values(current_setting('cante.file_id')::uuid,current_setting('cante.file_customer')::uuid,1,'YWJj')$q$);
select pg_temp.expect_file_denial($q$update public.chat_file_chunks set body='AAAA' where upload_id=current_setting('cante.file_id')::uuid$q$);
select pg_temp.expect_file_denial($q$delete from public.chat_file_uploads where id=current_setting('cante.file_id')::uuid$q$);
select pg_temp.expect_file_denial($q$insert into public.chat_file_uploads(customer_id,filename,size_bytes,sha256) values(current_setting('cante.file_customer')::uuid,'too-big.csv',15728641,repeat('a',64))$q$);
-- Exercise the exact 15 MiB boundary with all fifteen immutable chunks.
select set_config('cante.file_large',gen_random_uuid()::text,true);
insert into public.chat_file_uploads(id,customer_id,filename,size_bytes,sha256)
values(current_setting('cante.file_large')::uuid,current_setting('cante.file_customer')::uuid,'large-fixture.csv',15728640,encode(extensions.digest(repeat('a',15728640),'sha256'),'hex'));
insert into public.chat_file_chunks(upload_id,customer_id,part,body)
select current_setting('cante.file_large')::uuid,current_setting('cante.file_customer')::uuid,part,translate(encode(convert_to(repeat('a',1048576),'UTF8'),'base64'),E'\n\r','') from generate_series(0,14) part;
do $$begin if (select sum(octet_length(decode(body,'base64'))) from public.chat_file_chunks where upload_id=current_setting('cante.file_large')::uuid)<>15728640 then raise exception '15 MiB original did not persist completely';end if;end;$$;
-- Old archive inserts must remain valid after the shared storage-budget trigger changes.
insert into public.tariff_check_records(customer_id,filename,input_csv,confirmations,engine) values(current_setting('cante.file_customer')::uuid,'canonical.csv',repeat('a',1048577),'{}','{}');
do $$declare permit jsonb;begin permit:=public.acquire_api_request(current_setting('cante.file_customer')::uuid,'upload_chunk');if permit->>'allowed'<>'true' then raise exception 'Chunk budget not installed';end if;perform public.release_api_request((permit->>'leaseId')::uuid);end;$$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.file_other'),true);
set local role authenticated;
do $$begin if exists(select 1 from public.chat_file_uploads where id=current_setting('cante.file_id')::uuid) or exists(select 1 from public.chat_file_chunks where upload_id=current_setting('cante.file_id')::uuid) then raise exception 'Cross-workspace original read';end if;end;$$;
select pg_temp.expect_file_denial($q$insert into public.chat_file_chunks(upload_id,customer_id,part,body) values(current_setting('cante.file_id')::uuid,current_setting('cante.file_customer')::uuid,0,'YWJj')$q$);
reset role;
update public.customer_users set role='viewer' where user_id=current_setting('cante.file_user')::uuid;
select set_config('request.jwt.claim.sub',current_setting('cante.file_user'),true);
set local role authenticated;
select pg_temp.expect_file_denial($q$insert into public.chat_file_uploads(customer_id,filename,size_bytes,sha256) values(current_setting('cante.file_customer')::uuid,'viewer.csv',3,repeat('a',64))$q$);
reset role;
rollback;
