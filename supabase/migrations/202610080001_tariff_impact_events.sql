-- Durable record of a proactively-recomputed monitored-rule impact, so a
-- customer is notified instead of only seeing a result if they happen to
-- open the dashboard with the right impact run selected. One row is the
-- MonitoredCompanyImpact for one customer + finding, recomputed against
-- that customer's most recent eligible tariff_impact_run.
--
-- This is an append-only event log, not a mutable "latest state" row: a
-- finding that is recomputed again later gets a NEW row only when the
-- result materially changed (enforced by the recalculation job comparing
-- result_hash before inserting, and backstopped here by a uniqueness
-- constraint so a race or a retried pass cannot double-insert the same
-- content). Never invents a dollar figure: the same fail-closed
-- NEEDS REVIEW invariant already enforced in monitor-company-impact.ts is
-- re-asserted here as a check constraint.
begin;

create table public.tariff_impact_events (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  finding_id text not null references public.findings(id) on delete cascade,
  run_id text not null,
  action_name text not null,
  effective_date date,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  affected_product_count integer not null check (affected_product_count >= 0),
  estimated_duty_delta_usd numeric,
  status text not null check (status in ('computed', 'needs_review')),
  review_reason text,
  suppliers jsonb not null default '[]'::jsonb check (jsonb_typeof(suppliers) = 'array'),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
  -- Row-level detail needed to reconstruct the dashboard view: one entry per
  -- CompanyImpactRow (productId, sku, hts, origin, supplier, previousRate,
  -- newRate, impactUsd, status, reviewReason, evidence).
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  -- Content fingerprint of the computed impact (everything above except id/
  -- created_at/notified*), so the recalculation job can detect "nothing
  -- materially changed" and skip re-notifying without re-deriving the hash
  -- logic in SQL.
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  notified boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (run_id, customer_id) references public.tariff_impact_runs(id, customer_id) on delete cascade,
  -- Never a dollar figure alongside NEEDS REVIEW, and never a silent null
  -- delta on a computed result.
  check ((status = 'needs_review') = (estimated_duty_delta_usd is null)),
  check ((status = 'needs_review') = (review_reason is not null)),
  check ((notified_at is not null) = notified),
  -- Backstop for the application-level "materially new or changed" check:
  -- the exact same computed content for the same finding is never stored
  -- twice, even under concurrent/retried recalculation passes.
  unique (customer_id, finding_id, result_hash)
);

create index tariff_impact_events_customer_created
  on public.tariff_impact_events(customer_id, created_at desc);
create index tariff_impact_events_finding_created
  on public.tariff_impact_events(customer_id, finding_id, created_at desc);
create index tariff_impact_events_undelivered
  on public.tariff_impact_events(customer_id, notified)
  where not notified;

alter table public.tariff_impact_events enable row level security;
revoke all on public.tariff_impact_events from anon, authenticated;
grant select, insert, update on public.tariff_impact_events to authenticated;

create policy tenant_read on public.tariff_impact_events for select to authenticated
  using (private.is_customer_member(customer_id));

create policy tenant_insert on public.tariff_impact_events for insert to authenticated
  with check (
    private.has_customer_role(customer_id, array['owner','admin','member'])
    and exists (select 1 from public.findings f where f.id = finding_id and f.customer_id = tariff_impact_events.customer_id)
    and exists (select 1 from public.tariff_impact_runs r where r.id = run_id and r.customer_id = tariff_impact_events.customer_id)
  );

-- Only the delivery bookkeeping (notified/notified_at) may ever change
-- after insert; the computed impact itself is immutable once written
-- (matches tariff_impact_runs/rows: an audit snapshot is never edited, only
-- superseded by a new row). RLS's USING/WITH CHECK both see only the row
-- being evaluated, so immutability of the content columns is enforced by a
-- trigger comparing OLD and NEW, not by the policy itself.
create policy tenant_update on public.tariff_impact_events for update to authenticated
  using (private.has_customer_role(customer_id, array['owner','admin','member']))
  with check (private.has_customer_role(customer_id, array['owner','admin','member']));

create function private.protect_tariff_impact_event_content() returns trigger
language plpgsql security invoker set search_path = '' as $protect_event$
begin
  if new.customer_id is distinct from old.customer_id
    or new.finding_id is distinct from old.finding_id
    or new.run_id is distinct from old.run_id
    or new.action_name is distinct from old.action_name
    or new.effective_date is distinct from old.effective_date
    or new.citations is distinct from old.citations
    or new.affected_product_count is distinct from old.affected_product_count
    or new.estimated_duty_delta_usd is distinct from old.estimated_duty_delta_usd
    or new.status is distinct from old.status
    or new.review_reason is distinct from old.review_reason
    or new.suppliers is distinct from old.suppliers
    or new.products is distinct from old.products
    or new.rows is distinct from old.rows
    or new.result_hash is distinct from old.result_hash
    or new.created_at is distinct from old.created_at then
    raise exception 'tariff_impact_events rows are immutable except notified/notified_at';
  end if;
  return new;
end;
$protect_event$;
revoke all on function private.protect_tariff_impact_event_content() from public;
create trigger tariff_impact_events_immutable_content
  before update on public.tariff_impact_events
  for each row execute function private.protect_tariff_impact_event_content();

commit;
