-- The local worker publishes one bounded snapshot atomically. Reads use the
-- user's session; only the trusted worker may write discoveries or provenance.
create table if not exists public.import_monitor_state (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  revision integer not null check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
alter table public.import_monitor_state enable row level security;
revoke all on public.import_monitor_state from anon, authenticated;
grant select on public.import_monitor_state to authenticated;
grant all on public.import_monitor_state to service_role;
create policy tenant_read on public.import_monitor_state for select to authenticated
  using (private.is_customer_member(customer_id));
