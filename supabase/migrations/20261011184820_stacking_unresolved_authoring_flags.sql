-- A source can establish an exclusion concern even when no computable rule
-- can be authored. Such a target stays flagged and unresolved, never cleared.
alter table public.tariff_stacking_authoring_jobs add column detected_flags jsonb not null default '[]'::jsonb;
drop function public.store_tariff_stacking_drafts(uuid,uuid,jsonb,text);
create function public.store_tariff_stacking_drafts(job_id uuid, finding_id uuid, drafts jsonb, detail text, flagged_measures jsonb default '[]'::jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare j public.tariff_stacking_authoring_jobs; item jsonb; p jsonb; flag jsonb;
begin
 select * into j from public.tariff_stacking_authoring_jobs where id=job_id for update;
 if j.id is null or j.status <> 'running' then raise exception 'Authoring job is not running'; end if;
 if jsonb_typeof(drafts) <> 'array' or jsonb_array_length(drafts)>6 then raise exception 'Invalid bounded draft batch'; end if;
 if jsonb_typeof(flagged_measures)<>'array' or jsonb_array_length(flagged_measures)>12 then raise exception 'Invalid bounded flags'; end if;
 for flag in select value from jsonb_array_elements(flagged_measures) loop
  if coalesce(flag->>'target_measure','') !~ '^(9903\.[0-9]{2}\.[0-9]{2}|section_301_forced_labor|section_232_live)$'
   or coalesce(length(flag->>'evidence_quote'),0)<20
   or position(regexp_replace(flag->>'evidence_quote','\s+',' ','g') in regexp_replace(j.source_text,'\s+',' ','g'))=0
   then raise exception 'Flag lacks supported measure or verbatim source evidence'; end if;
  insert into public.tariff_stacking_flagged_measures(target_measure,citation) values(flag->>'target_measure',j.citation) on conflict do nothing;
 end loop;
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
 update public.tariff_stacking_authoring_jobs set status='complete',completed_at=now(),detected_flags=flagged_measures,detail=store_tariff_stacking_drafts.detail where id=job_id;
end;
$$;
revoke all on function public.store_tariff_stacking_drafts(uuid,uuid,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.store_tariff_stacking_drafts(uuid,uuid,jsonb,text,jsonb) to service_role;
