-- Administrative connection only. Synthetic identities, rules and appointments roll back.
begin;
select set_config('cante.qa_owner',gen_random_uuid()::text,true),set_config('cante.qa_admin',gen_random_uuid()::text,true),set_config('cante.qa_reviewer',gen_random_uuid()::text,true),set_config('cante.qa_tenant1',gen_random_uuid()::text,true),set_config('cante.qa_tenant2',gen_random_uuid()::text,true),set_config('cante.qa_draft',gen_random_uuid()::text,true),set_config('cante.qa_reject',gen_random_uuid()::text,true);
insert into auth.users(id,email) select current_setting(k)::uuid,'review-qa-'||current_setting(k)||'@example.invalid' from unnest(array['cante.qa_owner','cante.qa_admin','cante.qa_reviewer']) k;
insert into public.customers(id,slug,name) select current_setting(k)::uuid,'review-qa-'||current_setting(k),'Reviewer permission fixture' from unnest(array['cante.qa_tenant1','cante.qa_tenant2']) k;
insert into public.customer_users(customer_id,user_id,role) values(current_setting('cante.qa_tenant1')::uuid,current_setting('cante.qa_owner')::uuid,'owner'),(current_setting('cante.qa_tenant2')::uuid,current_setting('cante.qa_admin')::uuid,'admin'),(current_setting('cante.qa_tenant2')::uuid,current_setting('cante.qa_reviewer')::uuid,'member');
insert into public.tariff_stacking_rule_drafts(id,proposed_rule,verifier_verdict) select current_setting(k)::uuid,'{"target_measure":"9903.99.99","action":"include","conditions":{"country_of_origin":"ZZ","hts_prefix":"9999999999"},"priority":100,"rule_text":"Permission fixture only","citation":"https://example.invalid/permission-fixture","effective_date":"2099-01-01"}'::jsonb,'confirmed' from unnest(array['cante.qa_draft','cante.qa_reject']) k;
create function pg_temp.expect_permission_denied(command text) returns void language plpgsql security invoker as $$
begin
 begin execute command; exception when insufficient_privilege then return; end;
 raise exception 'Expected permission denial: %',command;
end;$$;
-- Both tenants' administrators are denied even with forged user/app metadata.
select set_config('request.jwt.claim.sub',current_setting('cante.qa_owner'),true),set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('cante.qa_owner'),'role','authenticated','user_metadata',jsonb_build_object('platform_reviewer',true),'app_metadata',jsonb_build_object('platform_reviewer',true))::text,true);
set local role authenticated;
do $$begin if public.is_platform_tariff_reviewer() then raise exception 'Tenant owner became reviewer'; end if; end;$$;
select pg_temp.expect_permission_denied('select public.read_tariff_stacking_reviews()');
select pg_temp.expect_permission_denied($q$select public.review_tariff_stacking_draft_authenticated(current_setting('cante.qa_draft')::uuid,'confirm',reviewer_note=>'Permission fixture legal basis',source_read=>true)$q$);
select pg_temp.expect_permission_denied($q$select public.review_tariff_stacking_draft_authenticated(current_setting('cante.qa_draft')::uuid,'reject')$q$);
select pg_temp.expect_permission_denied($q$insert into private.platform_tariff_reviewers(user_id,appointment_basis) values(auth.uid(),'Self appointed fixture')$q$);
select pg_temp.expect_permission_denied($q$select public.review_tariff_stacking_draft(current_setting('cante.qa_draft')::uuid,current_setting('cante.qa_owner')::uuid,'reject')$q$);
select pg_temp.expect_permission_denied($q$select public.claim_tariff_stacking_authoring_retry(gen_random_uuid(),auth.uid())$q$);
reset role;
select set_config('request.jwt.claim.sub',current_setting('cante.qa_admin'),true);
set local role authenticated;
do $$begin if public.is_platform_tariff_reviewer() then raise exception 'Other tenant admin became reviewer'; end if; end;$$;
select pg_temp.expect_permission_denied('select public.read_tariff_stacking_reviews()');
select pg_temp.expect_permission_denied($q$select public.review_tariff_stacking_draft_authenticated(current_setting('cante.qa_draft')::uuid,'reject')$q$);
reset role;
-- Trusted worker entry points must also reject an unappointed reviewer identity.
set local role service_role;
select pg_temp.expect_permission_denied($q$select public.review_tariff_stacking_draft(current_setting('cante.qa_draft')::uuid,current_setting('cante.qa_owner')::uuid,'reject')$q$);
select pg_temp.expect_permission_denied($q$select public.claim_tariff_stacking_authoring_retry(gen_random_uuid(),current_setting('cante.qa_owner')::uuid)$q$);
select pg_temp.expect_permission_denied($q$insert into private.platform_tariff_reviewers(user_id,appointment_basis) values(current_setting('cante.qa_owner')::uuid,'Worker self appointment')$q$);
reset role;
-- Only the database administrator appoints a reviewer. No tenant-admin role required.
insert into private.platform_tariff_reviewers(user_id,appointment_basis) values(current_setting('cante.qa_reviewer')::uuid,'Transactional authorization fixture');
select set_config('request.jwt.claim.sub',current_setting('cante.qa_reviewer'),true);
set local role authenticated;
do $$begin
 if not public.is_platform_tariff_reviewer() then raise exception 'Appointed reviewer denied'; end if;
 perform public.read_tariff_stacking_reviews();
 perform public.review_tariff_stacking_draft_authenticated(current_setting('cante.qa_draft')::uuid,'confirm',reviewer_note=>'Permission fixture legal basis',source_read=>true);
 perform public.review_tariff_stacking_draft_authenticated(current_setting('cante.qa_reject')::uuid,'reject');
end;$$;
select pg_temp.expect_permission_denied('delete from private.platform_tariff_reviewers');
reset role;
do $$begin
 if not exists(select 1 from public.tariff_stacking_rule_drafts where id=current_setting('cante.qa_draft')::uuid and status='promoted' and reviewed_by=current_setting('cante.qa_reviewer')) then raise exception 'Promotion attribution failed'; end if;
 if not exists(select 1 from public.tariff_stacking_rule_drafts where id=current_setting('cante.qa_reject')::uuid and status='rejected') then raise exception 'Rejection failed'; end if;
end;$$;
delete from private.platform_tariff_reviewers where user_id=current_setting('cante.qa_reviewer')::uuid;
set local role authenticated;
do $$begin if public.is_platform_tariff_reviewer() then raise exception 'Revoked reviewer still allowed'; end if; end;$$;
select pg_temp.expect_permission_denied('select public.read_tariff_stacking_reviews()');
select pg_temp.expect_permission_denied($q$select public.review_tariff_stacking_draft_authenticated(current_setting('cante.qa_reject')::uuid,'reject')$q$);
reset role;
set local role anon;
select pg_temp.expect_permission_denied('select public.is_platform_tariff_reviewer()');
select pg_temp.expect_permission_denied('select public.read_tariff_stacking_reviews()');
reset role;
rollback;
