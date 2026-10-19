-- Run with supabase db query --project-ref <Cante-ref> --file this-file.
-- All fixtures and promotions roll back; no synthetic rule remains live.
begin;
do $verify$
declare reviewer uuid; job uuid; draft uuid; other_draft uuid; first_rule uuid; promoted uuid;
 p jsonb; quote_text text := 'TEST FIXTURE ONLY: Section 301 does not apply when Section 232 matched.';
 citation text := 'https://www.federalregister.gov/mission-one-transaction-fixture';
begin
 if has_function_privilege('authenticated','public.review_tariff_stacking_draft(uuid,uuid,text,jsonb,uuid,text,text)','EXECUTE')
  or has_function_privilege('anon','public.store_tariff_stacking_drafts(uuid,uuid,jsonb,text,jsonb)','EXECUTE') then
  raise exception 'Review/authoring RPC grants permit untrusted callers'; end if;
 if not (select relrowsecurity from pg_class where oid='public.tariff_stacking_rules'::regclass) then raise exception 'Missing rule RLS'; end if;
 select user_id into reviewer from public.customer_users where role in ('owner','admin') limit 1;
 if reviewer is null then raise exception 'No real owner/admin available to verify review gate'; end if;
 insert into public.tariff_stacking_authoring_jobs(source_key,citation,source_text,status)
  values('transaction-fixture-' || gen_random_uuid(),citation,quote_text,'running') returning id into job;
 p := jsonb_build_object('target_measure','9903.99.99','action','exclude','cap_rate_percent',null,'conditions',jsonb_build_object('section_232_matched',true),
  'priority',100,'rule_text','TRANSACTION FIXTURE ONLY, rolls back.','citation',citation,'effective_date','2026-01-01','expires_date',null,
  'precedence_over',null,'precedence_reason',null,'evidence_quote',quote_text);
 begin
  perform public.store_tariff_stacking_drafts(job,null,jsonb_build_array(jsonb_build_object('proposed_rule',p || '{"evidence_quote":"This invented unsupported quote is never in the source."}'::jsonb,'verifier_verdict','confirmed','verifier_reasoning','Fixture')), 'Fixture');
  raise exception 'Unsupported quote accepted';
 exception when raise_exception then
  if SQLERRM='Unsupported quote accepted' then raise; end if;
 end;
 perform public.store_tariff_stacking_drafts(job,null,jsonb_build_array(jsonb_build_object('proposed_rule',p,'verifier_verdict','disputed','verifier_reasoning','Fixture dispute retained')), 'Fixture');
 select id into draft from public.tariff_stacking_rule_drafts where authoring_job_id=job;
 if not exists(select 1 from public.tariff_stacking_flagged_measures where target_measure='9903.99.99') then raise exception 'No registry expansion'; end if;
 if exists(select 1 from public.tariff_stacking_rules where target_measure='9903.99.99') then raise exception 'AI draft affected computation table'; end if;
 begin
  perform public.review_tariff_stacking_draft(draft,gen_random_uuid(),'confirm',null,null,null,'Fixture source reviewed');
  raise exception 'Untrusted reviewer accepted';
 exception when raise_exception then if SQLERRM='Untrusted reviewer accepted' then raise; end if; end;
 first_rule := public.review_tariff_stacking_draft(draft,reviewer,'confirm',null,null,null,'Fixture dispute reviewed against source');
 if not exists(select 1 from public.tariff_stacking_rules where id=first_rule and tier='human' and confirmed_by=reviewer::text) then raise exception 'Promotion trust/identity missing'; end if;
 begin
  perform public.review_tariff_stacking_draft(draft,reviewer,'confirm',null,null,null,'Fixture source reviewed');
  raise exception 'Double promotion accepted';
 exception when raise_exception then if SQLERRM='Double promotion accepted' then raise; end if; end;
 insert into public.tariff_stacking_rule_drafts(proposed_rule,verifier_verdict,verifier_reasoning) values(p || '{"action":"include"}'::jsonb,'confirmed','Fixture') returning id into other_draft;
 begin
  perform public.review_tariff_stacking_draft(other_draft,reviewer,'confirm',null,null,null,'Fixture source reviewed');
  raise exception 'Conflicting promotion accepted without precedence';
 exception when raise_exception then if SQLERRM='Conflicting promotion accepted without precedence' then raise; end if; end;
 begin
  perform public.review_tariff_stacking_draft(other_draft,reviewer,'confirm','{}',first_rule,'Fixture explicit precedence','Fixture source reviewed');
  raise exception 'Broadening accepted';
 exception when raise_exception then if SQLERRM='Broadening accepted' then raise; end if; end;
 promoted := public.review_tariff_stacking_draft(other_draft,reviewer,'confirm',null,first_rule,'Fixture amendment explicitly overrides the first rule','Fixture source reviewed');
 if not exists(select 1 from public.tariff_stacking_rules where id=promoted and precedence_over=first_rule) then raise exception 'Precedence not persisted'; end if;
 insert into public.tariff_stacking_rule_drafts(proposed_rule,verifier_verdict,verifier_reasoning) values(p,'insufficient_evidence','Fixture') returning id into other_draft;
 perform public.review_tariff_stacking_draft(other_draft,reviewer,'reject',null,null,null,'Fixture rejected');
 if not exists(select 1 from public.tariff_stacking_rule_drafts where id=other_draft and status='rejected') then raise exception 'Rejection missing'; end if;
 if private.stacking_conditions_overlap('{"hts_prefix":"2204"}','{"hts_prefix":"8501"}') then raise exception 'Disjoint prefixes overlap'; end if;
 if not private.stacking_conditions_overlap('{"hts_prefix":"2204"}','{"hts_prefix":"220410"}') then raise exception 'Nested prefixes did not overlap'; end if;
end;
$verify$;
rollback;
select 'Verified authoring, promotion, rejection, conflicts, scope narrowing, trust and permissions; all fixtures rolled back.' as result;

-- Retry claims are atomic and require a real owner/admin, even with a
-- service-backed route. These fixtures also roll back.
begin;
do $verify_retry$
declare reviewer uuid; job uuid; claim_count integer;
begin
 select user_id into reviewer from public.customer_users where role in ('owner','admin') limit 1;
 insert into public.tariff_stacking_authoring_jobs(source_key,citation,source_text,status)
  values('retry-transaction-fixture-' || gen_random_uuid(),'https://www.federalregister.gov/transaction-fixture','Transaction-only official-source substitute; rolled back.','failed') returning id into job;
 if has_function_privilege('authenticated','public.claim_tariff_stacking_authoring_retry(uuid,uuid)','EXECUTE') then raise exception 'Retry callable by untrusted role'; end if;
 begin
  perform public.claim_tariff_stacking_authoring_retry(job,gen_random_uuid());
  raise exception 'Untrusted retry accepted';
 exception when raise_exception then if SQLERRM='Untrusted retry accepted' then raise; end if; end;
 select count(*) into claim_count from public.claim_tariff_stacking_authoring_retry(job,reviewer);
 if claim_count<>1 then raise exception 'Retry claim missing'; end if;
 begin
  perform public.claim_tariff_stacking_authoring_retry(job,reviewer);
  raise exception 'Concurrent retry accepted';
 exception when raise_exception then if SQLERRM='Concurrent retry accepted' then raise; end if; end;
end;
$verify_retry$;
rollback;
select 'Verified retry ownership and concurrency; fixtures rolled back.' as result;

begin;
do $verify_flags$
declare job uuid; source_text text := 'TRANSACTION FIXTURE ONLY: a possible exclusion for Section 301 and Section 232 cannot yet be computed.';
begin
 insert into public.tariff_stacking_authoring_jobs(source_key,citation,source_text,status)
  values('unresolved-flags-fixture-' || gen_random_uuid(),'https://www.federalregister.gov/transaction-fixture',source_text,'running') returning id into job;
 perform public.store_tariff_stacking_drafts(job,null,'[]','Insufficient supported facts',jsonb_build_array(jsonb_build_object('target_measure','9903.99.98','evidence_quote',source_text,'reason','Fixture exclusion concern')));
 if not exists(select 1 from public.tariff_stacking_flagged_measures where target_measure='9903.99.98') then raise exception 'Empty rule output silently cleared exclusion concern'; end if;
 if exists(select 1 from public.tariff_stacking_rules where target_measure='9903.99.98') then raise exception 'Concern became a confirmed rule'; end if;
end;
$verify_flags$;
rollback;
select 'Verified unresolved flag expansion with zero drafts; fixtures rolled back.' as result;

begin;
do $verify_queue$
declare reviewer uuid; job uuid; other uuid; rows_claimed integer;
begin
 select user_id into reviewer from public.customer_users where role in ('owner','admin') limit 1;
 insert into public.tariff_stacking_authoring_jobs(source_key,citation,source_text,status)
  values('queue-transaction-fixture-' || gen_random_uuid(),'https://www.federalregister.gov/transaction-fixture','','queued') returning id into job;
 select count(*) into rows_claimed from public.claim_tariff_stacking_authoring_retry(job,reviewer);
 if rows_claimed<>1 then raise exception 'Queued source was lost'; end if;
 insert into public.tariff_stacking_authoring_jobs(source_key,citation,source_text,status)
  values('duplicate-transaction-fixture-' || gen_random_uuid(),'https://www.federalregister.gov/transaction-fixture','','queued') returning id into other;
 begin
  update public.tariff_stacking_authoring_jobs set source_key=(select source_key from public.tariff_stacking_authoring_jobs where id=job) where id=other;
  raise exception 'Duplicate source-content claim accepted';
 exception when unique_violation then null; end;
 update public.tariff_stacking_authoring_jobs set status='complete',duplicate_of=job where id=other;
 begin
  perform public.claim_tariff_stacking_authoring_retry(other,reviewer);
  raise exception 'Duplicate job retried';
 exception when raise_exception then if SQLERRM='Duplicate job retried' then raise; end if; end;
end;
$verify_queue$;
rollback;
select 'Verified queued authoring and global duplicate-source gate; fixtures rolled back.' as result;

begin;
do $verify_duty_free$
declare reviewer uuid; draft uuid; promoted uuid; p jsonb;
begin
 select user_id into reviewer from public.customer_users where role in ('owner','admin') limit 1;
 p := jsonb_build_object('target_measure','9903.99.98','action','exclude','cap_rate_percent',null,
  'conditions','{"country_of_origin":"MX","usmca_duty_free":true}'::jsonb,
  'priority',100,'rule_text','TRANSACTION FIXTURE ONLY: duty-free fact is a boolean, not inferred qualification.',
  'citation','https://www.federalregister.gov/transaction-fixture','effective_date','2026-01-01','expires_date',null,
  'precedence_over',null,'precedence_reason',null,'evidence_quote','TRANSACTION FIXTURE ONLY; never retained.');
 insert into public.tariff_stacking_rule_drafts(proposed_rule,verifier_verdict,verifier_reasoning) values(p,'insufficient_evidence','Fixture') returning id into draft;
 promoted := public.review_tariff_stacking_draft(draft,reviewer,'confirm',null,null,null,'Fixture source review, rolled back');
 if not exists(select 1 from public.tariff_stacking_rules where id=promoted and conditions->'usmca_duty_free'='true'::jsonb) then raise exception 'Duty-free condition was lost'; end if;
 insert into public.tariff_stacking_rule_drafts(proposed_rule,verifier_verdict,verifier_reasoning)
  values(jsonb_set(p,'{conditions,usmca_duty_free}','"true"'::jsonb),'insufficient_evidence','Fixture') returning id into draft;
 begin
  perform public.review_tariff_stacking_draft(draft,reviewer,'confirm',null,null,null,'Fixture source review, rolled back');
  raise exception 'String duty-free fact accepted';
 exception when raise_exception then if SQLERRM='String duty-free fact accepted' then raise; end if; end;
end;
$verify_duty_free$;
rollback;
select 'Verified duty-free condition and strict boolean review; all fixtures rolled back.' as result;

begin;
do $verify_authenticated_review$
declare reviewer uuid; draft uuid; promoted uuid; payload jsonb; p jsonb;
begin
 if has_function_privilege('anon','public.review_tariff_stacking_draft_authenticated(uuid,text,jsonb,uuid,text,text,boolean)','EXECUTE') then raise exception 'Anonymous hosted review allowed'; end if;
 if not has_function_privilege('authenticated','public.read_tariff_stacking_reviews(integer)','EXECUTE') then raise exception 'Hosted read unavailable'; end if;
 select user_id into reviewer from public.customer_users where role in ('owner','admin') limit 1;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.read_tariff_stacking_reviews(0); raise exception 'Non-member hosted read accepted';
 exception when raise_exception then if SQLERRM='Non-member hosted read accepted' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 payload := public.read_tariff_stacking_reviews(0);
 if payload::text like '%source_finding_id%' or payload::text like '%source_text%' then raise exception 'Worker-private fields exposed'; end if;
 p := jsonb_build_object('target_measure','9903.99.97','action','exclude','cap_rate_percent',null,
  'conditions','{"usmca_duty_free":true}'::jsonb,'priority',100,'rule_text','TRANSACTION FIXTURE ONLY, never kept.',
  'citation','https://www.federalregister.gov/transaction-fixture','effective_date','2026-01-01','expires_date',null,
  'precedence_over',null,'precedence_reason',null,'evidence_quote','TRANSACTION FIXTURE ONLY.');
 insert into public.tariff_stacking_rule_drafts(proposed_rule,verifier_verdict,verifier_reasoning) values(p,'insufficient_evidence','Fixture') returning id into draft;
 begin
  perform public.review_tariff_stacking_draft_authenticated(draft,'confirm',null,null,null,'Fixture source review',false);
  raise exception 'Hosted review without source acknowledgement accepted';
 exception when raise_exception then if SQLERRM='Hosted review without source acknowledgement accepted' then raise; end if; end;
 promoted := public.review_tariff_stacking_draft_authenticated(draft,'confirm',null,null,null,'Fixture source review, rolled back',true);
 if not exists(select 1 from public.tariff_stacking_rules where id=promoted and confirmed_by=reviewer::text) then raise exception 'Hosted reviewer identity not from JWT'; end if;
end;
$verify_authenticated_review$;
rollback;
select 'Verified authenticated hosted review, source acknowledgement, private-field omission and JWT reviewer identity; all fixtures rolled back.' as result;
