-- Qualification is distinct from duty-free entry under USMCA.
create or replace function public.review_tariff_stacking_draft(draft_id uuid, reviewer_id uuid, decision text,
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
