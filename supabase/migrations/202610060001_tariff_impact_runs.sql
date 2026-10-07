-- Immutable tariff business-impact audit snapshots. No catalogue writes.
begin;
create table public.tariff_impact_runs (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  filename text not null check (length(filename) <= 160),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  source_count integer not null check (source_count between 0 and 500),
  accepted_count integer not null check (accepted_count between 0 and 500),
  computed_count integer not null check (computed_count between 0 and 500),
  unresolved_count integer not null check (unresolved_count between 0 and 500),
  error_count integer not null check (error_count between 0 and 500),
  affected_sku_count integer not null check (affected_sku_count between 0 and 500),
  unique_supplier_count integer not null check (unique_supplier_count between 0 and 500),
  resolved_annual_delta_subtotal_usd numeric not null,
  estimated_annual_duty_delta_usd numeric,
  effective_date date,
  effective_date_status text not null check (effective_date_status in ('single','mixed','not_provided')),
  currency text not null default 'USD' check (currency = 'USD'),
  created_at timestamptz not null default now(),
  unique (id, customer_id),
  check (source_count between 1 and 500 and source_count = computed_count + unresolved_count + error_count),
  check (accepted_count between computed_count + unresolved_count and source_count),
  check (affected_sku_count <= computed_count and unique_supplier_count <= source_count),
  check ((effective_date_status = 'single') = (effective_date is not null)),
  check ((error_count + unresolved_count = 0 and estimated_annual_duty_delta_usd is not null and estimated_annual_duty_delta_usd = resolved_annual_delta_subtotal_usd)
    or (error_count + unresolved_count > 0 and estimated_annual_duty_delta_usd is null))
);
create table public.tariff_impact_rows (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  run_id text not null,
  row_number integer not null check (row_number between 1 and 500),
  product_id text references public.products(id) on delete no action deferrable initially deferred,
  supplier_id text references public.suppliers(id) on delete no action deferrable initially deferred,
  input_valid boolean not null,
  sku text,
  hts text,
  origin text,
  supplier text,
  annual_import_value_usd numeric check (annual_import_value_usd >= 0),
  current_duty_rate numeric check (current_duty_rate between 0 and 1),
  evaluation_date date,
  status text not null check (status in ('computed','unresolved','error')),
  direction text not null check (direction in ('increase','decrease','no_change','unknown')),
  current_annual_duty_usd numeric,
  computed_annual_duty_usd numeric,
  computed_total_rate numeric,
  annual_delta_usd numeric,
  stack_result jsonb,
  raw_input jsonb not null check (jsonb_typeof(raw_input) = 'object'),
  error text,
  created_at timestamptz not null default now(),
  foreign key (run_id, customer_id) references public.tariff_impact_runs(id, customer_id) on delete cascade,
  unique (run_id, row_number),
  check (status = 'error' or input_valid),
  check ((status = 'error') = (error is not null)),
  check ((case when status = 'computed' then
    input_valid and annual_import_value_usd is not null and current_duty_rate is not null
    and abs(current_annual_duty_usd - annual_import_value_usd * current_duty_rate) <= 0.000001
    and computed_annual_duty_usd is not null and computed_total_rate is not null and annual_delta_usd is not null
    and abs(annual_delta_usd - (computed_annual_duty_usd - current_annual_duty_usd)) <= 0.000001
    and stack_result is not null and jsonb_typeof(stack_result) = 'object'
    and (stack_result->>'totalAmount')::numeric = computed_annual_duty_usd
    and (stack_result->>'totalRatePercent')::numeric = computed_total_rate
    and stack_result->'unresolvedMeasures' = '[]'::jsonb
    and direction = case when annual_delta_usd > 0 then 'increase' when annual_delta_usd < 0 then 'decrease' else 'no_change' end
  else annual_delta_usd is null and computed_annual_duty_usd is null and computed_total_rate is null and direction = 'unknown' end) is true)
);
create index tariff_impact_runs_customer_created on public.tariff_impact_runs(customer_id, created_at desc);
create index tariff_impact_rows_customer_run on public.tariff_impact_rows(customer_id, run_id);
alter table public.tariff_impact_runs enable row level security;
revoke all on public.tariff_impact_runs from anon, authenticated;
grant select, insert, delete on public.tariff_impact_runs to authenticated;
create policy tenant_read on public.tariff_impact_runs for select to authenticated using (private.is_customer_member(customer_id));
create policy tenant_insert on public.tariff_impact_runs for insert to authenticated with check (private.has_customer_role(customer_id, array['owner','admin','member']));
create policy tenant_delete on public.tariff_impact_runs for delete to authenticated using (private.has_customer_role(customer_id, array['owner','admin']));
alter table public.tariff_impact_rows enable row level security;
revoke all on public.tariff_impact_rows from anon, authenticated;
grant select, insert on public.tariff_impact_rows to authenticated;
create policy tenant_read on public.tariff_impact_rows for select to authenticated using (private.is_customer_member(customer_id));
create policy tenant_insert on public.tariff_impact_rows for insert to authenticated with check (private.has_customer_role(customer_id, array['owner','admin','member']) and exists (select 1 from public.tariff_impact_runs r where r.id = run_id and r.customer_id = tariff_impact_rows.customer_id and r.xmin = (pg_current_xact_id()::text)::xid) and (product_id is null or exists (select 1 from public.products p where p.id = product_id and p.customer_id = tariff_impact_rows.customer_id)) and (supplier_id is null or exists (select 1 from public.suppliers s where s.id = supplier_id and s.customer_id = tariff_impact_rows.customer_id)));
create function public.create_tariff_impact_run(target_customer_id uuid, run_data jsonb, row_data jsonb)
returns text language plpgsql security invoker set search_path = '' as $create_run$
declare
  r public.tariff_impact_runs;
  n integer; computed integer; unresolved integer; errors integer; accepted integer; affected integer; suppliers integer;
  subtotal numeric;
begin
  if not private.has_customer_role(target_customer_id, array['owner','admin','member']) then
    raise exception 'Workspace write access required';
  end if;
  if row_data is null or jsonb_typeof(row_data) <> 'array' or jsonb_array_length(row_data) not between 1 and 500 then
    raise exception 'Invalid snapshot rows';
  end if;
  r := jsonb_populate_record(null::public.tariff_impact_runs, run_data);
  select count(*), count(*) filter (where x.status = 'computed'), count(*) filter (where x.status = 'unresolved'),
    count(*) filter (where x.status = 'error'), count(*) filter (where x.input_valid),
    count(distinct x.sku) filter (where x.status = 'computed' and x.annual_delta_usd <> 0),
    count(distinct x.supplier), coalesce(sum(x.annual_delta_usd) filter (where x.status = 'computed'), 0)
    into n, computed, unresolved, errors, accepted, affected, suppliers, subtotal
    from jsonb_populate_recordset(null::public.tariff_impact_rows, row_data) x;
  if r.source_count is distinct from n or r.accepted_count is distinct from accepted
    or r.computed_count is distinct from computed or r.unresolved_count is distinct from unresolved
    or r.error_count is distinct from errors or r.affected_sku_count is distinct from affected
    or r.unique_supplier_count is distinct from suppliers
    or abs(r.resolved_annual_delta_subtotal_usd - subtotal) > 0.000001 then
    raise exception 'Snapshot counts or subtotal mismatch';
  end if;
  if exists (select 1 from jsonb_populate_recordset(null::public.tariff_impact_rows, row_data) x
    where (x.product_id is not null and not exists (select 1 from public.products p where p.id = x.product_id and p.customer_id = target_customer_id))
       or (x.supplier_id is not null and not exists (select 1 from public.suppliers s where s.id = x.supplier_id and s.customer_id = target_customer_id))) then
    raise exception 'Snapshot reference outside workspace';
  end if;
  insert into public.tariff_impact_runs (id, customer_id, filename, input_sha256, source_count, accepted_count, computed_count, unresolved_count, error_count, affected_sku_count, unique_supplier_count, resolved_annual_delta_subtotal_usd, estimated_annual_duty_delta_usd, effective_date, effective_date_status, currency)
  values (r.id, target_customer_id, r.filename, r.input_sha256, r.source_count, r.accepted_count, r.computed_count, r.unresolved_count, r.error_count, r.affected_sku_count, r.unique_supplier_count, r.resolved_annual_delta_subtotal_usd, r.estimated_annual_duty_delta_usd, r.effective_date, r.effective_date_status, r.currency);
  insert into public.tariff_impact_rows (id, customer_id, run_id, row_number, product_id, supplier_id, input_valid, sku, hts, origin, supplier, annual_import_value_usd, current_duty_rate, evaluation_date, status, direction, current_annual_duty_usd, computed_annual_duty_usd, computed_total_rate, annual_delta_usd, stack_result, raw_input, error)
  select x.id, target_customer_id, r.id, x.row_number, x.product_id, x.supplier_id, x.input_valid, x.sku, x.hts, x.origin, x.supplier, x.annual_import_value_usd, x.current_duty_rate, x.evaluation_date, x.status, x.direction, x.current_annual_duty_usd, x.computed_annual_duty_usd, x.computed_total_rate, x.annual_delta_usd, x.stack_result, x.raw_input, x.error
  from jsonb_populate_recordset(null::public.tariff_impact_rows, row_data) x;
  return r.id;
end;
$create_run$;
revoke all on function public.create_tariff_impact_run(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_tariff_impact_run(uuid,jsonb,jsonb) to authenticated;
-- A deferred check also protects direct REST inserts: a run cannot commit
-- without its complete row snapshot. Rows cannot be appended in later transactions.
create function private.validate_tariff_impact_snapshot() returns trigger
language plpgsql security invoker set search_path = '' as $validate_snapshot$
declare
  n integer; c integer; u integer; e integer; a integer; skus integer; suppliers integer;
  first_row integer; last_row integer; subtotal numeric; date_count integer; dated integer; one_date date;
begin
  select count(*), count(*) filter (where status = 'computed'), count(*) filter (where status = 'unresolved'),
    count(*) filter (where status = 'error'), count(*) filter (where input_valid),
    count(distinct sku) filter (where status = 'computed' and annual_delta_usd <> 0), count(distinct supplier),
    min(row_number), max(row_number), coalesce(sum(annual_delta_usd), 0),
    count(distinct evaluation_date), count(evaluation_date), min(evaluation_date)
  into n,c,u,e,a,skus,suppliers,first_row,last_row,subtotal,date_count,dated,one_date
  from public.tariff_impact_rows where run_id = new.id and customer_id = new.customer_id;
  if n <> new.source_count or c <> new.computed_count or u <> new.unresolved_count or e <> new.error_count
    or a <> new.accepted_count or skus <> new.affected_sku_count or suppliers <> new.unique_supplier_count
    or first_row <> 1 or last_row <> n or abs(subtotal - new.resolved_annual_delta_subtotal_usd) > 0.000001
    or new.effective_date_status <> (case when dated = 0 then 'not_provided' when dated = n and date_count = 1 then 'single' else 'mixed' end)
    or (new.effective_date_status = 'single' and new.effective_date is distinct from one_date) then
    raise exception 'Incomplete or inconsistent tariff snapshot';
  end if;
  return null;
end;
$validate_snapshot$;
revoke all on function private.validate_tariff_impact_snapshot() from public;
create constraint trigger tariff_impact_snapshot_complete after insert on public.tariff_impact_runs
  deferrable initially deferred for each row execute function private.validate_tariff_impact_snapshot();
commit;
