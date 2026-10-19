-- Every detected source is retained; no schedule added. One queued source
-- is interpreted per check, globally deduplicated by fetched content.
alter table public.tariff_stacking_authoring_jobs drop constraint tariff_stacking_authoring_jobs_status_check;
alter table public.tariff_stacking_authoring_jobs add constraint tariff_stacking_authoring_jobs_status_check check (status in ('queued','running','complete','failed'));
alter table public.tariff_stacking_authoring_jobs add column source_text_url text;
alter table public.tariff_stacking_authoring_jobs add column duplicate_of uuid references public.tariff_stacking_authoring_jobs(id);
create unique index stacking_authoring_finding_unique on public.tariff_stacking_authoring_jobs(source_finding_id) where source_finding_id is not null;
create or replace function public.claim_tariff_stacking_authoring_retry(job_id uuid,reviewer_id uuid)
returns setof public.tariff_stacking_authoring_jobs language plpgsql security invoker set search_path = '' as $$
begin
 if not exists(select 1 from public.customer_users where user_id=reviewer_id and role in ('owner','admin')) then raise exception 'Owner or admin required'; end if;
 return query update public.tariff_stacking_authoring_jobs set status='running',started_at=now(),completed_at=null,detail='Explicit reviewer retry'
  where id=job_id and duplicate_of is null and (status in ('failed','queued') or (status='running' and started_at<now()-interval '5 minutes')) returning *;
 if not found then raise exception 'Authoring job is complete or already running'; end if;
end;
$$;
revoke all on function public.claim_tariff_stacking_authoring_retry(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_tariff_stacking_authoring_retry(uuid,uuid) to service_role;
