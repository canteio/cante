-- Software support can advance without a newly published rule/source. Keep the
-- request as tenant-owned event metadata, separate from legal evidence and the
-- protected worker's actual execution version. Legacy refresh clients keep working.
begin;
set local lock_timeout='5s';
alter table public.audit_review_events add column requested_engine_version text
 check(requested_engine_version is null or requested_engine_version ~ '^historical-audit-v[1-9][0-9]{0,5}$');
comment on column public.audit_review_events.requested_engine_version is
 'Requested calculation support, not legal approval or proof that this engine executed. Actual versions come only from protected attestations.';

create function public.refresh_historical_audit_support(
 target_audit uuid,selected_ids uuid[],selected_reference_ids uuid[],target_engine_version text
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.audit_batches; known_version text; sources_changed boolean; next_revision integer;
begin
 -- Authenticate the tenant/role before locking its row. JWT user metadata never
 -- grants membership, global rule approval or worker execution authority.
 select * into b from public.audit_batches
 where id=target_audit and private.has_customer_role(customer_id,array['owner','admin','member']) for update;
 if b.id is null then raise exception using errcode='42501',message='Audit write access required';end if;
 if target_engine_version is null or target_engine_version !~ '^historical-audit-v[1-9][0-9]{0,5}$' then raise exception 'A valid calculation version is required';end if;
 select v.version into known_version from (
  select a.engine_version as version,a.revision,1 as authority,a.verified_at as recorded_at
   from public.tariff_impact_attestations a where a.audit_id=b.id and a.customer_id=b.customer_id
  union all
  select e.requested_engine_version,e.revision,0,e.created_at from public.audit_review_events e
   where e.audit_id=b.id and e.customer_id=b.customer_id and e.requested_engine_version is not null
 ) v order by v.revision desc,v.authority desc,v.recorded_at desc limit 1;
 if known_version ~ '^historical-audit-v[1-9][0-9]{0,5}$' and
  regexp_replace(target_engine_version,'^historical-audit-v','')::integer < regexp_replace(known_version,'^historical-audit-v','')::integer
 then raise exception 'This audit uses newer calculation support; update Cante before refreshing';end if;
 -- Reuse the existing approved-rule, source-integrity, duplicate and size checks.
 sources_changed:=public.refresh_historical_audit_rules(target_audit,selected_ids,selected_reference_ids);
 if not sources_changed and (known_version is null or known_version=target_engine_version) then return false;end if;
 next_revision:=b.revision+1;
 if not sources_changed then
  update public.audit_batches set revision=next_revision,status='ready',active_run_id=null,lease_token=null,lease_until=null,
   checkpoint='[]'::jsonb,progress=0,input_hash=null,summary=null,last_error=null where id=b.id;
 end if;
 insert into public.audit_review_events(audit_id,customer_id,revision,requested_engine_version,decision)
 values(b.id,b.customer_id,next_revision,target_engine_version,jsonb_build_object('kind','rules_updated','row',0,
  'note','Historical calculation support requested: '||target_engine_version||'. Earlier inputs and results remain retained. This does not assert a new law or a completed calculation.','evidence','[]'::jsonb));
 return true;
end;$$;
revoke all on function public.refresh_historical_audit_support(uuid,uuid[],uuid[],text) from public,anon,authenticated,service_role;
grant execute on function public.refresh_historical_audit_support(uuid,uuid[],uuid[],text) to authenticated;
notify pgrst,'reload schema';
commit;
