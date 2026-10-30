-- Administrative connection; isolated synthetic identities and all writes roll back.
begin;
select set_config('cante.audit_user',gen_random_uuid()::text,true),set_config('cante.audit_other',gen_random_uuid()::text,true),set_config('cante.audit_reviewer',gen_random_uuid()::text,true),set_config('cante.audit_tenant',gen_random_uuid()::text,true),set_config('cante.audit_foreign',gen_random_uuid()::text,true),set_config('cante.audit_upload',gen_random_uuid()::text,true),set_config('cante.audit_batch',gen_random_uuid()::text,true),set_config('cante.audit_bundle',gen_random_uuid()::text,true);
insert into auth.users(id,email) select current_setting(k)::uuid,'audit-fixture-'||current_setting(k)||'@example.invalid' from unnest(array['cante.audit_user','cante.audit_other','cante.audit_reviewer']) k;
insert into public.customers(id,slug,name) select current_setting(k)::uuid,'audit-fixture-'||current_setting(k),'Isolated audit authorization fixture' from unnest(array['cante.audit_tenant','cante.audit_foreign']) k;
insert into public.customer_users(customer_id,user_id,role) values(current_setting('cante.audit_tenant')::uuid,current_setting('cante.audit_user')::uuid,'owner'),(current_setting('cante.audit_foreign')::uuid,current_setting('cante.audit_other')::uuid,'owner');
insert into public.chat_file_uploads(id,customer_id,actor_id,size_bytes,sha256,filename) values(current_setting('cante.audit_upload')::uuid,current_setting('cante.audit_tenant')::uuid,current_setting('cante.audit_user')::uuid,1,repeat('a',64),'SYNTHETIC.csv');
-- Use actual snapshot RPC so this test also runs against the complete Cante schema.
-- Foundation-only local tests install a matching temporary helper for this call.
select set_config('request.jwt.claim.sub',current_setting('cante.audit_user'),true);
select public.create_tariff_impact_run(current_setting('cante.audit_tenant')::uuid,
 jsonb_build_object('id','audit-input-'||current_setting('cante.audit_batch'),'filename','SYNTHETIC.csv','input_sha256',repeat('a',64),'analysis_kind','historical_entries','source_count',1,'accepted_count',0,'computed_count',0,'unresolved_count',0,'error_count',1,'affected_sku_count',0,'unique_supplier_count',0,'resolved_annual_delta_subtotal_usd',0,'estimated_annual_duty_delta_usd',null,'effective_date_status','not_provided','currency','USD'),
 jsonb_build_array(jsonb_build_object('id','audit-row-'||current_setting('cante.audit_batch'),'row_number',1,'analysis_kind','historical_entries','input_valid',false,'status','error','direction','unknown','raw_input',jsonb_build_object('label','SYNTHETIC SQL authorization fixture'),'error','Missing input; no calculation claimed')));
create function pg_temp.audit_expect_failure(command text,fragment text default '') returns void language plpgsql security invoker as $$
begin
 begin execute command; exception when others then if fragment='' or position(fragment in sqlerrm)>0 then return;else raise;end if;end;
 raise exception 'Expected rejection: %',command;
end;$$;
select set_config('request.jwt.claim.sub',current_setting('cante.audit_user'),true);
set local role authenticated;
insert into public.audit_batches(id,customer_id,filename,upload_id,input_run_id,mapping,options,idempotency_key)
values(current_setting('cante.audit_batch')::uuid,current_setting('cante.audit_tenant')::uuid,'SYNTHETIC.csv',current_setting('cante.audit_upload')::uuid,'audit-input-'||current_setting('cante.audit_batch'),'{}','{}',repeat('b',64));
select pg_temp.audit_expect_failure('update public.audit_batches set status=''completed''','permission denied');
select pg_temp.audit_expect_failure('insert into public.tariff_impact_attestations(run_id) values(gen_random_uuid())','permission denied');
select pg_temp.audit_expect_failure('select public.claim_historical_audit(gen_random_uuid(),gen_random_uuid(),0)','permission denied');
select pg_temp.audit_expect_failure('insert into public.audit_entry_results(audit_id) values(gen_random_uuid())','permission denied');
select pg_temp.audit_expect_failure($q$select public.review_historical_bundle(current_setting('cante.audit_bundle')::uuid,'approved','Forged tenant approval',true)$q$,'reviewer required');
select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"note","row":1,"note":"Synthetic review note retained without a financial conclusion","evidence":[]}'::jsonb);
do $$begin if public.refresh_historical_audit_rules(current_setting('cante.audit_batch')::uuid,'{}'::uuid[]) then raise exception 'Unchanged rules created a revision';end if;end;$$;
select pg_temp.audit_expect_failure($q$select public.refresh_historical_audit_rules(current_setting('cante.audit_batch')::uuid,array[gen_random_uuid()])$q$,'approved historical');
select pg_temp.audit_expect_failure($q$select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"confirm_facts","row":1,"note":"No evidence supplied","evidence":[]}')$q$);
select pg_temp.audit_expect_failure($q$select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"confirm_facts","row":1,"note":"Correction without verification","origin":"VN","evidence":["SYN-DOC"],"validFrom":"2024-01-01","validBefore":"2025-01-01"}')$q$);
select pg_temp.audit_expect_failure($q$select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"confirm_facts","row":1,"note":"A foreign product association must be rejected","productId":"foreign-product-that-does-not-belong","evidence":["SYN-DOC"],"validFrom":"2024-01-01","validBefore":"2025-01-01"}')$q$,'Product association');
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.audit_other'),true);
set local role authenticated;
do $$begin if exists(select 1 from public.audit_batches where id=current_setting('cante.audit_batch')::uuid) then raise exception 'Cross-tenant audit leak';end if;if exists(select 1 from public.audit_review_events where audit_id=current_setting('cante.audit_batch')::uuid) then raise exception 'Cross-tenant review leak';end if;end;$$;
select pg_temp.audit_expect_failure($q$select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"note","row":1,"note":"Foreign tenant review attempt","evidence":[]}')$q$,'write access');
reset role;
-- Database administrator appoints a platform reviewer; no tenant role grants it.
insert into private.platform_tariff_reviewers(user_id,appointment_basis) values(current_setting('cante.audit_reviewer')::uuid,'Transactional audit approval fixture');
select set_config('request.jwt.claim.sub',current_setting('cante.audit_reviewer'),true);
set local role authenticated;
insert into public.tariff_rule_bundles(definition,sources) values('{"synthetic":true,"title":"SYNTHETIC blocked approval"}','[{"id":"SYN"}]');
select pg_temp.audit_expect_failure($q$select public.review_historical_bundle((select id from public.tariff_rule_bundles where definition->>'synthetic'='true' limit 1),'approved','Synthetic must never be legal coverage',true)$q$);
reset role;
-- Worker-only lease, atomic output/proof and immutable results.
set local role service_role;
select public.claim_historical_audit(current_setting('cante.audit_batch')::uuid,current_setting('cante.audit_tenant')::uuid,0);
select pg_temp.audit_expect_failure($q$select public.claim_historical_audit(current_setting('cante.audit_batch')::uuid,current_setting('cante.audit_tenant')::uuid,0)$q$,'already running');
select pg_temp.audit_expect_failure($q$select public.finish_historical_audit(current_setting('cante.audit_batch')::uuid,current_setting('cante.audit_tenant')::uuid,gen_random_uuid(),0,'[]','{}',repeat('a',64),'historical-audit-v1')$q$,'lease');
select public.finish_historical_audit(current_setting('cante.audit_batch')::uuid,current_setting('cante.audit_tenant')::uuid,(select lease_token from public.audit_batches where id=current_setting('cante.audit_batch')::uuid),0,jsonb_build_array('{"entry":{"row":1},"result":{"expected":null}}'::text),'{}',repeat('a',64),'historical-audit-v1');
do $$begin if not exists(select 1 from public.tariff_impact_attestations a where a.audit_id=current_setting('cante.audit_batch')::uuid and a.result_sha256=encode(extensions.digest('{"entry":{"row":1},"result":{"expected":null}}','sha256'),'hex')) then raise exception 'Output proof hash mismatch';end if;end;$$;
select pg_temp.audit_expect_failure('update public.audit_entry_results set result_text=''{}''');
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.audit_user'),true);
set local role authenticated;
select pg_temp.audit_expect_failure($q$select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"resolved","row":1,"note":"Must not resolve unknown calculation","evidence":[]}')$q$,'Missing calculations');
select public.record_audit_review(current_setting('cante.audit_batch')::uuid,'{"kind":"confirm_facts","row":1,"note":"Synthetic dated origin decision; original remains retained","evidence":["SYN-DOC"],"validFrom":"2024-01-01","validBefore":"2025-01-01","origin":"VN","facts":{"origin_verified":true}}');
do $$begin if not exists(select 1 from public.audit_batches where id=current_setting('cante.audit_batch')::uuid and revision=1 and status='ready' and active_run_id is null and progress=0) then raise exception 'New facts failed to invalidate old calculation';end if;if (select count(*) from public.audit_entry_results where audit_id=current_setting('cante.audit_batch')::uuid)<>1 then raise exception 'Earlier result was not retained';end if;end;$$;
reset role;
rollback;
