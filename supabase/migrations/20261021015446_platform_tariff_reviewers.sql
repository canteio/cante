-- Global legal-rule authority is explicitly appointed, never inherited from a tenant.
-- No accounts are enrolled automatically. Only a database administrator manages this list.
create table private.platform_tariff_reviewers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 appointed_at timestamptz not null default now(),
 appointed_by text not null default current_user,
 appointment_basis text not null check (length(trim(appointment_basis)) >= 10)
);
alter table private.platform_tariff_reviewers enable row level security;
revoke all on private.platform_tariff_reviewers from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select on private.platform_tariff_reviewers to service_role;

-- Safe public capability probe: only the verified caller's own status is exposed.
create function public.is_platform_tariff_reviewer()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from private.platform_tariff_reviewers where user_id=auth.uid()
 );
$$;
revoke all on function public.is_platform_tariff_reviewer() from public, anon, authenticated, service_role;
grant execute on function public.is_platform_tariff_reviewer() to authenticated;

-- Hosted admin review uses the caller's verified JWT. Never put the worker
-- service key in Vercel or let a caller choose a reviewer identity.
create or replace function public.read_tariff_stacking_reviews(review_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pending jsonb; reviewed jsonb; rules jsonb; jobs jsonb; total integer;
begin
 if not public.is_platform_tariff_reviewer() then
  raise exception using errcode='42501', message='Platform tariff reviewer access required'; end if;
 if review_offset<0 or review_offset>1000000 then raise exception 'Invalid review offset'; end if;
 select count(*) into total from public.tariff_stacking_rule_drafts where status='pending';
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into pending from (
  select id,proposed_rule,verifier_verdict,verifier_reasoning,status,created_at,reviewed_at,reviewed_by,review_note,promoted_rule_id
  from public.tariff_stacking_rule_drafts where status='pending' order by created_at,id offset review_offset limit 20) d;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into reviewed from (
  select id,proposed_rule,verifier_verdict,verifier_reasoning,status,created_at,reviewed_at,reviewed_by,review_note,promoted_rule_id
  from public.tariff_stacking_rule_drafts where status<>'pending' order by reviewed_at desc,id limit 20) d;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into rules from (
  select id,target_measure,conditions,action,cap_rate_percent,rule_text,citation,effective_date,expires_date,precedence_over,precedence_reason
  from public.tariff_stacking_rules where tier in ('human','document') and superseded_by is null
  and target_measure in (select item->'proposed_rule'->>'target_measure' from jsonb_array_elements(pending) item)
  order by id) r;
 select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) into jobs from (
  select id,citation,status,detail,detected_flags,created_at,started_at,completed_at
  from public.tariff_stacking_authoring_jobs where duplicate_of is null order by created_at desc,id limit 20) j;
 return jsonb_build_object('drafts',pending||reviewed,'rules',rules,'jobs',jobs,'totalPending',total,'hasMore',review_offset+20<total);
end;
$$;
create or replace function public.review_tariff_stacking_draft_authenticated(
 draft_id uuid, decision text, narrowed_conditions jsonb default null,
 precedence_id uuid default null, precedence_basis text default null,
 reviewer_note text default null, source_read boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_tariff_reviewer() then
  raise exception using errcode='42501', message='Platform tariff reviewer access required'; end if;
 if decision='confirm' and (not coalesce(source_read,false) or coalesce(length(trim(reviewer_note)),0)<10) then
  raise exception 'Read the official source and record your legal basis'; end if;
 return public.review_tariff_stacking_draft(draft_id,auth.uid(),decision,narrowed_conditions,precedence_id,precedence_basis,reviewer_note);
end;
$$;
revoke all on function public.read_tariff_stacking_reviews(integer) from public,anon;
revoke all on function public.review_tariff_stacking_draft_authenticated(uuid,text,jsonb,uuid,text,text,boolean) from public,anon;
grant execute on function public.read_tariff_stacking_reviews(integer) to authenticated;
grant execute on function public.review_tariff_stacking_draft_authenticated(uuid,text,jsonb,uuid,text,text,boolean) to authenticated;

-- Qualification is distinct from duty-free entry under USMCA.
create or replace function public.review_tariff_stacking_draft(draft_id uuid, reviewer_id uuid, decision text,
  narrowed_conditions jsonb default null, precedence_id uuid default null, precedence_basis text default null, reviewer_note text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare d public.tariff_stacking_rule_drafts; p jsonb; c jsonb; existing public.tariff_stacking_rules;
  rule_id uuid; k text; v jsonb; conflict_ids uuid[] := '{}'; start_on date; end_on date;
begin
 -- The trusted worker and authenticated wrapper must both name an appointed reviewer.
 if reviewer_id is null or not exists(select 1 from private.platform_tariff_reviewers where user_id=reviewer_id) then
  raise exception using errcode='42501', message='Platform tariff reviewer access required'; end if;
 perform pg_advisory_xact_lock(61011183153);
 select * into d from public.tariff_stacking_rule_drafts where id=draft_id for update;
 if d.id is null then raise exception 'Draft not found'; end if;
 if d.status <> 'pending' then raise exception 'Draft already reviewed'; end if;
 if decision not in ('confirm','reject') then raise exception 'Invalid review decision'; end if;
 if decision='reject' then
  update public.tariff_stacking_rule_drafts set status='rejected',reviewed_by=reviewer_id::text,reviewed_at=now(),review_note=reviewer_note where id=draft_id;
  return null;
 end if;
 if coalesce(length(trim(reviewer_note)),0)<10 then raise exception 'Record your source review and legal basis'; end if;
 p := d.proposed_rule; c := coalesce(narrowed_conditions,p->'conditions');
 if jsonb_typeof(c)<>'object' or c='{}'::jsonb then raise exception 'Supported conditions required'; end if;
 -- Review may narrow scope, never silently broaden the model's proposal.
 for k,v in select key,value from jsonb_each(p->'conditions') loop
  if not c ? k or (k='hts_prefix' and not (c->>k like (v #>> '{}') || '%'))
   or (k<>'hts_prefix' and c->k <> v) then raise exception 'Conditions may only narrow the proposed scope'; end if;
 end loop;
 for k,v in select key,value from jsonb_each(c) loop
  if k in ('section_232_matched','section_301_matched','section_338_matched','usmca_qualified','usmca_duty_free') then
   if jsonb_typeof(v)<>'boolean' then raise exception 'Boolean condition required'; end if;
  elsif k='country_of_origin' then
   if coalesce(c->>k,'') !~ '^[A-Z]{2}$' then raise exception 'ISO country required'; end if;
  elsif k='hts_prefix' then
   if coalesce(c->>k,'') !~ '^[0-9]{2,10}$' then raise exception 'Digits-only HTS prefix required'; end if;
  elsif k='section232_source_document' then
   if jsonb_typeof(v)<>'string' or length(c->>k) not between 1 and 80 then raise exception 'Source document required'; end if;
  else raise exception 'Unsupported shipment fact %',k;
  end if;
 end loop;
 if coalesce(p->>'target_measure','') !~ '^(9903\.[0-9]{2}\.[0-9]{2}|section_301_forced_labor|section_232_live)$'
  or p->>'action' not in ('include','exclude','cap_at') then raise exception 'Unsupported measure or action'; end if;
 if p->>'target_measure'='section_232_live' and not c ? 'section232_source_document' then raise exception 'Live measure needs source scope'; end if;
 start_on := (p->>'effective_date')::date; end_on := (p->>'expires_date')::date;
 if start_on is not null and end_on is not null and end_on<=start_on then raise exception 'Invalid rule date range'; end if;
 for existing in select * from public.tariff_stacking_rules where target_measure=p->>'target_measure'
  and tier in ('human','document') and superseded_by is null loop
  if coalesce(existing.effective_date,'-infinity'::date)<coalesce(end_on,'infinity'::date)
   and coalesce(start_on,'-infinity'::date)<coalesce(existing.expires_date,'infinity'::date)
   and private.stacking_conditions_overlap(existing.conditions,c) then
    conflict_ids := array_append(conflict_ids,existing.id);
  end if;
 end loop;
 if cardinality(conflict_ids)>1 then raise exception 'Multiple overlapping confirmed rules: narrow conditions before promotion'; end if;
 if cardinality(conflict_ids)=1 and (precedence_id is distinct from conflict_ids[1] or coalesce(length(trim(precedence_basis)),0)<10) then
  raise exception 'Overlapping confirmed rule % requires explicit precedence and a legal basis, or narrower conditions',conflict_ids[1];
 end if;
 if precedence_id is not null and not (precedence_id=any(conflict_ids)) then raise exception 'Precedence must name the overlapping confirmed rule'; end if;
 insert into public.tariff_stacking_rules(target_measure,action,cap_rate_percent,conditions,priority,rule_text,embedding,citation,effective_date,expires_date,tier,confirmed_by,precedence_over,precedence_reason)
 values(p->>'target_measure',p->>'action',(p->>'cap_rate_percent')::numeric,c,(p->>'priority')::integer,p->>'rule_text',d.embedding,p->>'citation',start_on,end_on,'human',reviewer_id::text,precedence_id,precedence_basis) returning id into rule_id;
 update public.tariff_stacking_rule_drafts set status='promoted',reviewed_by=reviewer_id::text,reviewed_at=now(),review_note=reviewer_note,promoted_rule_id=rule_id where id=draft_id;
 return rule_id;
end;
$$;

create or replace function public.claim_tariff_stacking_authoring_retry(job_id uuid,reviewer_id uuid)
returns setof public.tariff_stacking_authoring_jobs language plpgsql security invoker set search_path = '' as $$
begin
 if reviewer_id is null or not exists(select 1 from private.platform_tariff_reviewers where user_id=reviewer_id) then raise exception using errcode='42501', message='Platform tariff reviewer access required'; end if;
 return query update public.tariff_stacking_authoring_jobs set status='running',started_at=now(),completed_at=null,detail='Explicit reviewer retry'
  where id=job_id and duplicate_of is null and (status in ('failed','queued') or (status='running' and started_at<now()-interval '5 minutes')) returning *;
 if not found then raise exception 'Authoring job is complete or already running'; end if;
end;
$$;
revoke all on function public.claim_tariff_stacking_authoring_retry(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_tariff_stacking_authoring_retry(uuid,uuid) to service_role;

-- Keep direct promotion worker-only; customers must use the caller-bound wrapper.
revoke all on function public.review_tariff_stacking_draft(uuid,uuid,text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_tariff_stacking_draft(uuid,uuid,text,jsonb,uuid,text,text) to service_role;
