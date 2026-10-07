begin;
create table public.tariff_monitor_candidates (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  finding_id text not null references public.findings(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  match_kind text not null check (match_kind in ('exact_code','code_prefix')),
  match_reason text not null,
  created_at timestamptz not null default now(),
  unique (finding_id, product_id)
);
create index tariff_monitor_candidates_customer_created on public.tariff_monitor_candidates(customer_id, created_at desc);
alter table public.tariff_monitor_candidates enable row level security;
revoke all on public.tariff_monitor_candidates from anon, authenticated;
grant select, insert on public.tariff_monitor_candidates to authenticated;
create policy tenant_read on public.tariff_monitor_candidates for select to authenticated
  using (private.is_customer_member(customer_id));
create policy tenant_insert on public.tariff_monitor_candidates for insert to authenticated
  with check (
    private.has_customer_role(customer_id, array['owner','admin','member'])
    and exists (select 1 from public.findings f where f.id = finding_id and f.customer_id = tariff_monitor_candidates.customer_id and f.relevance in ('flagged','noted'))
    and exists (select 1 from public.products p where p.id = product_id and p.customer_id = tariff_monitor_candidates.customer_id)
  );
commit;
