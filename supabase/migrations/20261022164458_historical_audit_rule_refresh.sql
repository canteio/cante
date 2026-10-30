-- Re-pin approved coverage explicitly, preserving every prior calculation.
begin;
create function public.refresh_historical_audit_rules(target_audit uuid,selected_ids uuid[]) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.audit_batches;
begin
 select * into b from public.audit_batches where id=target_audit for update;
 if b.id is null or not private.has_customer_role(b.customer_id,array['owner','admin','member']) then raise exception using errcode='42501',message='Audit write access required'; end if;
 if selected_ids is null or cardinality(selected_ids)>100 or (select count(distinct x) from unnest(selected_ids) x)<>cardinality(selected_ids) or exists(select 1 from unnest(selected_ids) x where not exists(select 1 from public.tariff_rule_bundles r where r.id=x and r.status='approved')) then raise exception 'Select approved historical snapshots only'; end if;
 if b.bundle_ids=selected_ids then return false; end if;
 update public.audit_batches set bundle_ids=selected_ids,revision=revision+1,status='ready',active_run_id=null,lease_token=null,lease_until=null,checkpoint='[]',progress=0,input_hash=null,summary=null,last_error=null where id=b.id;
 insert into public.audit_review_events(audit_id,customer_id,revision,decision) values(b.id,b.customer_id,b.revision+1,jsonb_build_object('row',0,'kind','rules_updated','note','Audit-wide historical coverage updated explicitly. Exact snapshots remain pinned in every calculation proof.','evidence','[]'::jsonb));
 return true;
end;$$;
revoke all on function public.refresh_historical_audit_rules(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.refresh_historical_audit_rules(uuid,uuid[]) to authenticated;
commit;
