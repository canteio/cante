-- Mission One steps 4–6. Drafts never enter the computation table without a
-- named owner/admin reviewer. All promotion/conflict checks are transactional.
alter table public.tariff_stacking_rules enable row level security;
create policy stacking_rules_read on public.tariff_stacking_rules for select to anon, authenticated using (true);
alter table public.tariff_stacking_rule_drafts enable row level security;
alter table public.tariff_stacking_rule_drafts add column authoring_job_id uuid;
alter table public.tariff_stacking_rule_drafts add column promoted_rule_id uuid references public.tariff_stacking_rules(id);
alter table public.tariff_stacking_rule_drafts add column review_note text;
alter table public.tariff_stacking_rule_drafts add column embedding extensions.vector(384);

create table public.tariff_stacking_authoring_jobs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  citation text not null,
  source_text text not null check (octet_length(source_text) <= 200000),
  status text not null check (status in ('running','complete','failed')),
  detail text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.tariff_stacking_authoring_jobs enable row level security;
revoke all on public.tariff_stacking_authoring_jobs from public, anon, authenticated;
grant all on public.tariff_stacking_authoring_jobs to service_role;
alter table public.tariff_stacking_rule_drafts add foreign key (authoring_job_id) references public.tariff_stacking_authoring_jobs(id);


create table public.tariff_stacking_flagged_measures (
  target_measure text primary key,
  citation text not null,
  flagged_at timestamptz not null default now()
);
alter table public.tariff_stacking_flagged_measures enable row level security;
revoke all on public.tariff_stacking_flagged_measures from public, anon, authenticated;
grant select on public.tariff_stacking_flagged_measures to anon, authenticated;
grant all on public.tariff_stacking_flagged_measures to service_role;
create policy stacking_flags_read on public.tariff_stacking_flagged_measures for select to anon, authenticated using (true);
insert into public.tariff_stacking_flagged_measures (target_measure,citation)
  select distinct on (target_measure) target_measure,citation from public.tariff_stacking_rules;
-- Known unresolved measure, NOT a new rate or confirmed exclusion.
insert into public.tariff_stacking_flagged_measures values
 ('section_301_forced_labor','https://www.federalregister.gov/documents/2026/07/20/2026-15181',now()) on conflict do nothing;

create function public.match_tariff_stacking_rules(query_embedding extensions.vector(384), match_count integer default 8)
returns setof public.tariff_stacking_rules language sql stable security invoker set search_path = '' as $$
 select * from public.tariff_stacking_rules where superseded_by is null
 order by embedding operator(extensions.<=>) query_embedding nulls last limit least(greatest(match_count,1),20);
$$;
revoke all on function public.match_tariff_stacking_rules(extensions.vector,integer) from public, anon, authenticated;
grant execute on function public.match_tariff_stacking_rules(extensions.vector,integer) to service_role;

create function public.store_tariff_stacking_drafts(job_id uuid, finding_id uuid, drafts jsonb, detail text)
returns void language plpgsql security invoker set search_path = '' as $$
declare j public.tariff_stacking_authoring_jobs; item jsonb; p jsonb;
begin
 select * into j from public.tariff_stacking_authoring_jobs where id=job_id for update;
 if j.id is null or j.status <> 'running' then raise exception 'Authoring job is not running'; end if;
 if jsonb_typeof(drafts) <> 'array' or jsonb_array_length(drafts)>6 then raise exception 'Invalid bounded draft batch'; end if;
 for item in select value from jsonb_array_elements(drafts) loop
  p := item->'proposed_rule';
  if p->>'citation' is distinct from j.citation or length(p->>'evidence_quote')<20
   or position(regexp_replace(p->>'evidence_quote','\s+',' ','g') in regexp_replace(j.source_text,'\s+',' ','g'))=0
   then raise exception 'Draft evidence does not match fetched source'; end if;
  insert into public.tariff_stacking_rule_drafts(source_finding_id,authoring_job_id,proposed_rule,verifier_verdict,verifier_reasoning,embedding)
   values(finding_id,job_id,p,item->>'verifier_verdict',item->>'verifier_reasoning',(item->>'embedding')::extensions.vector);
  insert into public.tariff_stacking_flagged_measures(target_measure,citation)
   values(p->>'target_measure',j.citation) on conflict do nothing;
 end loop;
 update public.tariff_stacking_authoring_jobs set status='complete',completed_at=now(),detail=store_tariff_stacking_drafts.detail where id=job_id;
end;
$$;
revoke all on function public.store_tariff_stacking_drafts(uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.store_tariff_stacking_drafts(uuid,uuid,jsonb,text) to service_role;

-- Boolean conjunctions plus exact origin/document and an HTS prefix. Two
-- conjunctions overlap unless some shared condition is mutually exclusive.
create function private.stacking_conditions_overlap(a jsonb,b jsonb)
returns boolean language sql immutable set search_path = '' as $$
 select not exists(select 1 from jsonb_each(a) x join jsonb_each(b) y on x.key=y.key
  where case when x.key='hts_prefix' then
    not (x.value #>> '{}' like (y.value #>> '{}') || '%' or y.value #>> '{}' like (x.value #>> '{}') || '%')
   else x.value <> y.value end);
$$;
revoke all on function private.stacking_conditions_overlap(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.stacking_conditions_overlap(jsonb,jsonb) to service_role;

create function public.review_tariff_stacking_draft(draft_id uuid, reviewer_id uuid, decision text,
  narrowed_conditions jsonb default null, precedence_id uuid default null, precedence_basis text default null, reviewer_note text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare d public.tariff_stacking_rule_drafts; p jsonb; c jsonb; existing public.tariff_stacking_rules;
  rule_id uuid; k text; v jsonb; conflict_ids uuid[] := '{}'; start_on date; end_on date;
begin
 -- Called only by the service-backed route after session verification; check
 -- membership again here and never accept the reviewer's name from JSON.
 if not exists(select 1 from public.customer_users where user_id=reviewer_id and role in ('owner','admin')) then
  raise exception 'Owner or admin review required'; end if;
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
  if k in ('section_232_matched','section_301_matched','section_338_matched','usmca_qualified') then
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
revoke all on function public.review_tariff_stacking_draft(uuid,uuid,text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_tariff_stacking_draft(uuid,uuid,text,jsonb,uuid,text,text) to service_role;
