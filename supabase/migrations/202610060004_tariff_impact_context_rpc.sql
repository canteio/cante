-- Extend the explicit atomic snapshot insert to persist the new nullable context.
-- Preserve the existing tenant checks, grants, and snapshot validation.
begin;
create or replace function public.create_tariff_impact_run(target_customer_id uuid, run_data jsonb, row_data jsonb)
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
  insert into public.tariff_impact_rows (id, customer_id, run_id, row_number, product_id, supplier_id, input_valid, sku, hts, origin, supplier, annual_import_value_usd, current_duty_rate, evaluation_date, status, direction, current_annual_duty_usd, computed_annual_duty_usd, computed_total_rate, annual_delta_usd, stack_result, raw_input, error, quantity, chapter99_codes, exclusion_id, special_program_claim)
  select x.id, target_customer_id, r.id, x.row_number, x.product_id, x.supplier_id, x.input_valid, x.sku, x.hts, x.origin, x.supplier, x.annual_import_value_usd, x.current_duty_rate, x.evaluation_date, x.status, x.direction, x.current_annual_duty_usd, x.computed_annual_duty_usd, x.computed_total_rate, x.annual_delta_usd, x.stack_result, x.raw_input, x.error, x.quantity, x.chapter99_codes, x.exclusion_id, x.special_program_claim
  from jsonb_populate_recordset(null::public.tariff_impact_rows, row_data) x;
  return r.id;
end;
$create_run$;
revoke all on function public.create_tariff_impact_run(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_tariff_impact_run(uuid,jsonb,jsonb) to authenticated;
commit;
