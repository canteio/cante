-- Explicit owner/admin retries; no automatic repeated model spend.
alter table public.tariff_stacking_authoring_jobs add column started_at timestamptz not null default now();
alter table public.tariff_stacking_authoring_jobs add column source_finding_id uuid;
create function public.claim_tariff_stacking_authoring_retry(job_id uuid,reviewer_id uuid)
returns setof public.tariff_stacking_authoring_jobs language plpgsql security invoker set search_path = '' as $$
begin
 if not exists(select 1 from public.customer_users where user_id=reviewer_id and role in ('owner','admin')) then raise exception 'Owner or admin required'; end if;
 return query update public.tariff_stacking_authoring_jobs set status='running',started_at=now(),completed_at=null,detail='Explicit reviewer retry'
  where id=job_id and (status='failed' or (status='running' and started_at<now()-interval '5 minutes')) returning *;
 if not found then raise exception 'Authoring job is complete or already running'; end if;
end;
$$;
revoke all on function public.claim_tariff_stacking_authoring_retry(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_tariff_stacking_authoring_retry(uuid,uuid) to service_role;
