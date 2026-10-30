-- Wider pinned date ranges, still processed in bounded worker chunks.
-- Rule approval authority, tenant checks and historical immutability are unchanged.
begin;
set local lock_timeout='5s';
alter table public.audit_batches drop constraint audit_batches_reference_ids_check;
alter table public.audit_batches add constraint audit_batches_reference_ids_check check(cardinality(reference_ids)<=512);
create or replace function public.refresh_historical_audit_rules(target_audit uuid,selected_ids uuid[],selected_reference_ids uuid[] default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.audit_batches; refs uuid[]; rev integer;
begin
 select * into b from public.audit_batches where id=target_audit for update;
 if b.id is null or not private.has_customer_role(b.customer_id,array['owner','admin','member']) then raise exception using errcode='42501',message='Audit write access required';end if;
 refs:=coalesce(selected_reference_ids,b.reference_ids);
 if selected_ids is null or cardinality(selected_ids)>100 or (select count(distinct x) from unnest(selected_ids) x)<>cardinality(selected_ids) or exists(select 1 from unnest(selected_ids) x where not exists(select 1 from public.tariff_rule_bundles r where r.id=x and r.status='approved')) then raise exception 'Select only approved historical rule versions';end if;
 if cardinality(refs)>512 or (select count(distinct x) from unnest(refs) x)<>cardinality(refs) or exists(select 1 from unnest(refs) x where not exists(select 1 from public.tariff_reference_sources s where s.id=x)) then raise exception 'Select retained historical references';end if;
 if coalesce((select array_agg(x order by x) from unnest(selected_ids) x),'{}'::uuid[])=coalesce((select array_agg(x order by x) from unnest(b.bundle_ids) x),'{}'::uuid[]) and coalesce((select array_agg(x order by x) from unnest(refs) x),'{}'::uuid[])=coalesce((select array_agg(x order by x) from unnest(b.reference_ids) x),'{}'::uuid[]) then return false;end if;
 rev:=b.revision+1;
 insert into public.audit_review_events(audit_id,customer_id,revision,decision) values(b.id,b.customer_id,rev,jsonb_build_object('kind','rules_updated','row',0,'note','Historical rule and source versions explicitly refreshed; earlier calculations retained.','evidence','[]'::jsonb));
 update public.audit_batches set bundle_ids=selected_ids,reference_ids=refs,revision=rev,status='ready',active_run_id=null,lease_token=null,lease_until=null,checkpoint='[]'::jsonb,progress=0,input_hash=null,summary=null,last_error=null where id=b.id;
 return true;
end;$$;
revoke all on function public.refresh_historical_audit_rules(uuid,uuid[],uuid[]) from public,anon,service_role;
grant execute on function public.refresh_historical_audit_rules(uuid,uuid[],uuid[]) to authenticated;
commit;
