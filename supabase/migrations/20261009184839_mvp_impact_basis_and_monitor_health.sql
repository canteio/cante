begin;
-- Preserve the interpretation of every saved impact alongside its dollar amount.
alter table public.tariff_impact_events add column basis jsonb
  check (basis is null or jsonb_typeof(basis) = 'object');
create function private.protect_tariff_impact_basis() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.basis is distinct from old.basis then raise exception 'Impact basis is immutable'; end if;
  return new;
end; $$;
revoke all on function private.protect_tariff_impact_basis() from public;
create trigger tariff_impact_basis_immutable before update on public.tariff_impact_events
for each row execute function private.protect_tariff_impact_basis();

-- Global reference health contains no tenant data, keys or raw error messages.
create table public.tariff_sync_status (
  source text primary key check (source = 'usitc_hts'),
  revision text not null,
  status text not null check (status in ('running','complete','incomplete','failed')),
  checked_at timestamptz not null default now(),
  last_success_at timestamptz,
  completed_chapters integer not null check (completed_chapters between 0 and 99),
  detail text not null check (length(detail) <= 1000)
);
alter table public.tariff_sync_status enable row level security;
grant select on public.tariff_sync_status to authenticated;
grant all on public.tariff_sync_status to service_role;
create policy reference_read on public.tariff_sync_status for select to authenticated using (true);
revoke all on public.tariff_sync_status from anon;

-- Published schedule changes are source evidence, never automatically activated legal rules.
create table public.hts_rate_changes (
  id text primary key,
  hts_code text not null,
  from_revision text not null,
  to_revision text not null,
  before_rates jsonb not null,
  after_rates jsonb not null,
  detected_at timestamptz not null default now()
);
create index hts_rate_changes_code_date on public.hts_rate_changes(hts_code, detected_at desc);
alter table public.hts_rate_changes enable row level security;
grant select on public.hts_rate_changes to authenticated;
grant all on public.hts_rate_changes to service_role;
revoke all on public.hts_rate_changes from anon;
create policy reference_read on public.hts_rate_changes for select to authenticated using (true);
create function private.record_hts_rate_change() returns trigger language plpgsql security invoker set search_path = '' as $$
declare before_value jsonb; after_value jsonb;
begin
  before_value := jsonb_build_object('general',old.general,'special',old.special,'column2',old.other,'additional_duties',old.additional_duties,'units',old.units);
  after_value := jsonb_build_object('general',new.general,'special',new.special,'column2',new.other,'additional_duties',new.additional_duties,'units',new.units);
  if before_value is distinct from after_value then
    insert into public.hts_rate_changes(id,hts_code,from_revision,to_revision,before_rates,after_rates)
    values (md5(new.hts_code || old.hts_revision || new.hts_revision || before_value::text || after_value::text),new.hts_code,old.hts_revision,new.hts_revision,before_value,after_value)
    on conflict (id) do nothing;
  end if;
  return new;
end; $$;
revoke all on function private.record_hts_rate_change() from public;
create trigger hts_published_rate_change after update on public.hts_schedule_embeddings
for each row execute function private.record_hts_rate_change();
commit;
