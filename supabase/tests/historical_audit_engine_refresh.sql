-- Run against the complete schema. All identities, null SQL results and writes
-- roll back. These simulated records test access/version transitions only.
begin;
select set_config('cante.refresh_user',gen_random_uuid()::text,true),set_config('cante.refresh_other',gen_random_uuid()::text,true),set_config('cante.refresh_viewer',gen_random_uuid()::text,true),set_config('cante.refresh_tenant',gen_random_uuid()::text,true),set_config('cante.refresh_foreign',gen_random_uuid()::text,true),set_config('cante.refresh_upload',gen_random_uuid()::text,true),set_config('cante.refresh_batch',gen_random_uuid()::text,true);
insert into auth.users(id,email) select current_setting(k)::uuid,'audit-fixture-'||current_setting(k)||'@example.invalid' from unnest(array['cante.refresh_user','cante.refresh_other','cante.refresh_viewer']) k;
insert into public.customers(id,slug,name) select current_setting(k)::uuid,'audit-fixture-'||current_setting(k),'Isolated engine refresh fixture' from unnest(array['cante.refresh_tenant','cante.refresh_foreign']) k;
insert into public.customer_users(customer_id,user_id,role) values(current_setting('cante.refresh_tenant')::uuid,current_setting('cante.refresh_user')::uuid,'owner'),(current_setting('cante.refresh_foreign')::uuid,current_setting('cante.refresh_other')::uuid,'owner'),(current_setting('cante.refresh_tenant')::uuid,current_setting('cante.refresh_viewer')::uuid,'viewer');
insert into public.chat_file_uploads(id,customer_id,actor_id,size_bytes,sha256,filename) values(current_setting('cante.refresh_upload')::uuid,current_setting('cante.refresh_tenant')::uuid,current_setting('cante.refresh_user')::uuid,1,repeat('a',64),'SYNTHETIC.csv');
select set_config('request.jwt.claim.sub',current_setting('cante.refresh_user'),true);
select public.create_tariff_impact_run(current_setting('cante.refresh_tenant')::uuid,
 jsonb_build_object('id','audit-input-'||current_setting('cante.refresh_batch'),'filename','SYNTHETIC.csv','input_sha256',repeat('a',64),'analysis_kind','historical_entries','source_count',1,'accepted_count',0,'computed_count',0,'unresolved_count',0,'error_count',1,'affected_sku_count',0,'unique_supplier_count',0,'resolved_annual_delta_subtotal_usd',0,'estimated_annual_duty_delta_usd',null,'effective_date_status','not_provided','currency','USD'),
 jsonb_build_array(jsonb_build_object('id','audit-row-'||current_setting('cante.refresh_batch'),'row_number',1,'analysis_kind','historical_entries','input_valid',false,'status','error','direction','unknown','raw_input',jsonb_build_object('label','SYNTHETIC SQL fixture'),'error','Missing input; no calculation claimed')));
create function pg_temp.refresh_expect_failure(command text,fragment text default '') returns void language plpgsql security invoker as $$
begin
 begin execute command; exception when others then if fragment='' or position(fragment in sqlerrm)>0 then return;else raise;end if;end;
 raise exception 'Expected rejection: %',command;
end;$$;
set local role authenticated;
insert into public.audit_batches(id,customer_id,filename,upload_id,input_run_id,mapping,options,idempotency_key)
values(current_setting('cante.refresh_batch')::uuid,current_setting('cante.refresh_tenant')::uuid,'SYNTHETIC.csv',current_setting('cante.refresh_upload')::uuid,'audit-input-'||current_setting('cante.refresh_batch'),'{}','{}',repeat('b',64));
do $$begin if public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v20') then raise exception 'Empty audit unnecessarily refreshed';end if;end;$$;
select pg_temp.refresh_expect_failure($q$select public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','bad-version')$q$,'valid calculation');
select pg_temp.refresh_expect_failure($q$select public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,array[gen_random_uuid()],'{}','historical-audit-v20')$q$,'approved historical');
select pg_temp.refresh_expect_failure($q$select public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}',array[gen_random_uuid()],'historical-audit-v20')$q$,'retained historical');
reset role;
-- A deliberately null fixture is not a real engine/source execution.
set local role service_role;
select public.claim_historical_audit(current_setting('cante.refresh_batch')::uuid,current_setting('cante.refresh_tenant')::uuid,0);
select public.finish_historical_audit(current_setting('cante.refresh_batch')::uuid,current_setting('cante.refresh_tenant')::uuid,(select lease_token from public.audit_batches where id=current_setting('cante.refresh_batch')::uuid),0,jsonb_build_array('{"entry":{"row":1},"result":{"expected":null}}'::text),'{}',repeat('a',64),'historical-audit-v19');
reset role;
set local role authenticated;
do $$begin
 if not public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v20') then raise exception 'Old execution failed to refresh';end if;
 if public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v20') then raise exception 'Pending refresh duplicated';end if;
 if not exists(select 1 from public.audit_batches where id=current_setting('cante.refresh_batch')::uuid and revision=1 and status='ready' and active_run_id is null) then raise exception 'Revision invalidation failed';end if;
 if (select count(*) from public.audit_review_events where audit_id=current_setting('cante.refresh_batch')::uuid and requested_engine_version='historical-audit-v20')<>1 then raise exception 'Request metadata missing or duplicated';end if;
 if (select count(*) from public.audit_entry_results where audit_id=current_setting('cante.refresh_batch')::uuid)<>1 then raise exception 'Original result lost';end if;
 if not exists(select 1 from public.tariff_impact_attestations where audit_id=current_setting('cante.refresh_batch')::uuid and engine_version='historical-audit-v19') then raise exception 'Original proof lost';end if;
end;$$;
select pg_temp.refresh_expect_failure($q$select public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v19')$q$,'newer calculation');
select pg_temp.refresh_expect_failure($q$update public.audit_review_events set requested_engine_version='historical-audit-v999'$q$,'permission denied');
reset role;
-- An actual execution version wins over the requested version at that revision.
set local role service_role;
select public.claim_historical_audit(current_setting('cante.refresh_batch')::uuid,current_setting('cante.refresh_tenant')::uuid,1);
select public.finish_historical_audit(current_setting('cante.refresh_batch')::uuid,current_setting('cante.refresh_tenant')::uuid,(select lease_token from public.audit_batches where id=current_setting('cante.refresh_batch')::uuid),1,jsonb_build_array('{"entry":{"row":1},"result":{"expected":null}}'::text),'{}',repeat('a',64),'historical-audit-v19');
reset role;
set local role authenticated;
do $$begin if not public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v20') then raise exception 'Request incorrectly overrode execution';end if;end;$$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.refresh_other'),true);
set local role authenticated;
select pg_temp.refresh_expect_failure($q$select public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v20')$q$,'write access');
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.refresh_viewer'),true);
set local role authenticated;
select pg_temp.refresh_expect_failure($q$select public.refresh_historical_audit_support(current_setting('cante.refresh_batch')::uuid,'{}','{}','historical-audit-v20')$q$,'write access');
reset role;
do $$begin
 if has_function_privilege('anon','public.refresh_historical_audit_support(uuid,uuid[],uuid[],text)','EXECUTE') or has_function_privilege('service_role','public.refresh_historical_audit_support(uuid,uuid[],uuid[],text)','EXECUTE') then raise exception 'Unexpected refresh privilege';end if;
 if not has_function_privilege('authenticated','public.refresh_historical_audit_support(uuid,uuid[],uuid[],text)','EXECUTE') then raise exception 'Missing refresh privilege';end if;
 if exists(select 1 from private.platform_tariff_reviewers where user_id in (current_setting('cante.refresh_user')::uuid,current_setting('cante.refresh_viewer')::uuid)) then raise exception 'Test acquired legal approval authority';end if;
end;$$;
select 'PASS: refresh, idempotency, execution precedence, originals, source validation, tenant/viewer isolation' as result;
rollback;
