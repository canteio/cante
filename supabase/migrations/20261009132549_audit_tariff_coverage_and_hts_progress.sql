-- A chapter publication and its completion marker commit atomically.
-- Empty reserved chapters need markers too; row presence cannot prove completion.
begin;
-- An accepted amendment is not a complete schedule. A reviewer must attest
-- that the selected document's rows form a consolidated coverage snapshot.
create table public.section232_coverage_reviews (
  source_document_number text primary key,
  effective_date date not null,
  reviewed_through date not null,
  review_basis text not null check (length(btrim(review_basis)) between 20 and 4000),
  reviewed_at timestamptz not null default now(),
  check (reviewed_through >= effective_date)
);
alter table public.section232_coverage_reviews enable row level security;
revoke all on public.section232_coverage_reviews from public, anon, authenticated;
grant select on public.section232_coverage_reviews to authenticated;
create policy authenticated_read on public.section232_coverage_reviews for select to authenticated using (true);
grant select, insert, update, delete on public.section232_coverage_reviews to service_role;
create table public.hts_chapter_publications (
  chapter text primary key check (chapter ~ '^(0[1-9]|[1-9][0-9])$'),
  revision text not null check (length(revision) > 0),
  published_at timestamptz not null default now()
);
alter table public.hts_chapter_publications enable row level security;
revoke all on public.hts_chapter_publications from public, anon, authenticated;
grant select, insert, update on public.hts_chapter_publications to service_role;
create or replace function public.publish_hts_chapter(target_chapter text, target_revision text, leaf_rows jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  set local statement_timeout = '120s';
  if target_chapter !~ '^(0[1-9]|[1-9][0-9])$' or nullif(target_revision, '') is null
    or jsonb_typeof(leaf_rows) <> 'array' then
    raise exception 'Invalid HTS chapter publication';
  end if;
  if jsonb_array_length(leaf_rows) = 0 and target_chapter <> '77' then
    raise exception 'Empty non-reserved HTS chapter';
  end if;
  if exists (select 1 from jsonb_array_elements(leaf_rows) r
    where r->>'chapter' is distinct from target_chapter
       or left(r->>'hts_code', 2) is distinct from target_chapter) then
    raise exception 'Chapter mismatch';
  end if;
  perform pg_advisory_xact_lock(71007, target_chapter::integer);
  insert into public.hts_schedule_embeddings
    (hts_code, chapter, full_description, description_hash, general, special, other,
     additional_duties, units, hts_revision, embedding, updated_at)
  select r->>'hts_code', target_chapter, r->>'full_description', r->>'description_hash',
    r->>'general', r->>'special', r->>'other', r->>'additional_duties',
    array(select jsonb_array_elements_text(r->'units')), target_revision,
    (r->>'embedding')::extensions.vector(384), now()
  from jsonb_array_elements(leaf_rows) r
  on conflict (hts_code) do update set
    full_description = excluded.full_description, description_hash = excluded.description_hash,
    general = excluded.general, special = excluded.special, other = excluded.other,
    additional_duties = excluded.additional_duties, units = excluded.units,
    hts_revision = excluded.hts_revision, embedding = excluded.embedding, updated_at = excluded.updated_at;
  delete from public.hts_schedule_embeddings h where h.chapter = target_chapter
    and not exists (select 1 from jsonb_array_elements(leaf_rows) r where r->>'hts_code' = h.hts_code);
  insert into public.hts_chapter_publications(chapter, revision, published_at)
  values (target_chapter, target_revision, now())
  on conflict (chapter) do update set revision = excluded.revision, published_at = excluded.published_at;
end;
$$;

alter table public.tariff_impact_rows add column unit text check (unit is null or length(unit) <= 32), add column review_reason text;
alter table public.tariff_impact_runs
  add column analysis_kind text not null default 'annual_portfolio' check (analysis_kind in ('annual_portfolio','historical_entries')),
  add column idempotency_key text;
create unique index tariff_impact_run_idempotency on public.tariff_impact_runs(customer_id,idempotency_key) where idempotency_key is not null;
alter table public.tariff_impact_rows
  add column analysis_kind text not null default 'annual_portfolio' check (analysis_kind in ('annual_portfolio','historical_entries')),
  add column qualification_verified boolean not null default false,
  add column qualification_basis text check (length(qualification_basis) <= 2000),
  add column entry_id text check (length(entry_id) <= 64),
  add column line_number text check (length(line_number) <= 64),
  add column customs_value_usd numeric check (customs_value_usd >= 0),
  add column paid_duty_usd numeric check (paid_duty_usd >= 0);
alter table public.tariff_impact_rows drop constraint tariff_impact_rows_current_duty_rate_check;
alter table public.tariff_impact_rows add constraint tariff_impact_rows_current_duty_rate_check check (current_duty_rate >= 0);
alter table public.tariff_impact_rows add constraint historical_entry_evidence check (
  analysis_kind <> 'historical_entries' or status = 'error' or (
    nullif(btrim(entry_id), '') is not null and nullif(btrim(line_number), '') is not null
    and evaluation_date is not null and hts is not null and regexp_replace(hts, '[.]', '', 'g') ~ '^[0-9]{10}$'
    and customs_value_usd is not null and paid_duty_usd is not null
    and annual_import_value_usd is not null and current_annual_duty_usd is not null
    and annual_import_value_usd = customs_value_usd and current_annual_duty_usd = paid_duty_usd
    and (status <> 'computed' or (qualification_verified and nullif(btrim(qualification_basis), '') is not null and product_id is not null))
  )
);
create function private.validate_tariff_analysis_kind() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.analysis_kind is distinct from (select analysis_kind from public.tariff_impact_runs where id = new.run_id and customer_id = new.customer_id) then
    raise exception 'Snapshot analysis kind mismatch';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_tariff_analysis_kind() from public;
create trigger tariff_analysis_kind before insert on public.tariff_impact_rows for each row execute function private.validate_tariff_analysis_kind();
create unique index tariff_impact_entry_identity on public.tariff_impact_rows(run_id,entry_id,line_number) where analysis_kind = 'historical_entries' and status <> 'error';
create or replace function public.create_tariff_impact_run(target_customer_id uuid, run_data jsonb, row_data jsonb)
returns text language plpgsql security invoker set search_path = '' as $create_run$
declare
  r public.tariff_impact_runs;
  n integer; computed integer; unresolved integer; errors integer; accepted integer; affected integer; suppliers integer;
  subtotal numeric; existing_id text;
begin
  if not private.has_customer_role(target_customer_id, array['owner','admin','member']) then
    raise exception 'Workspace write access required';
  end if;
  if row_data is null or jsonb_typeof(row_data) <> 'array' or jsonb_array_length(row_data) not between 1 and 500 then
    raise exception 'Invalid snapshot rows';
  end if;
  r := jsonb_populate_record(null::public.tariff_impact_runs, run_data);
  if r.analysis_kind is null then r.analysis_kind := 'annual_portfolio'; end if;
  if r.idempotency_key is not null then
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_customer_id::text || r.idempotency_key, 0));
    select id into existing_id from public.tariff_impact_runs where customer_id = target_customer_id and idempotency_key = r.idempotency_key;
    if existing_id is not null then return existing_id; end if;
  end if;
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
  if exists (select 1 from jsonb_populate_recordset(null::public.tariff_impact_rows, row_data) x
    where coalesce(x.analysis_kind, 'annual_portfolio') is distinct from r.analysis_kind
       or (r.analysis_kind = 'historical_entries' and x.status <> 'error' and (
         nullif(btrim(x.entry_id), '') is null or nullif(btrim(x.line_number), '') is null
         or x.evaluation_date is null or regexp_replace(x.hts, '[.]', '', 'g') !~ '^[0-9]{10}$'
         or x.customs_value_usd is null or x.paid_duty_usd is null
         or x.annual_import_value_usd is distinct from x.customs_value_usd
         or x.current_annual_duty_usd is distinct from x.paid_duty_usd
         or (x.status = 'computed' and (not coalesce(x.qualification_verified, false)
           or nullif(btrim(x.qualification_basis), '') is null or x.product_id is null))))) then
    raise exception 'Historical snapshot evidence or analysis kind mismatch';
  end if;
  insert into public.tariff_impact_runs (id, customer_id, filename, input_sha256, analysis_kind, idempotency_key, source_count, accepted_count, computed_count, unresolved_count, error_count, affected_sku_count, unique_supplier_count, resolved_annual_delta_subtotal_usd, estimated_annual_duty_delta_usd, effective_date, effective_date_status, currency)
  values (r.id, target_customer_id, r.filename, r.input_sha256, r.analysis_kind, r.idempotency_key, r.source_count, r.accepted_count, r.computed_count, r.unresolved_count, r.error_count, r.affected_sku_count, r.unique_supplier_count, r.resolved_annual_delta_subtotal_usd, r.estimated_annual_duty_delta_usd, r.effective_date, r.effective_date_status, r.currency);
  insert into public.tariff_impact_rows (id, customer_id, run_id, row_number, product_id, supplier_id, input_valid, analysis_kind, qualification_verified, qualification_basis, entry_id, line_number, customs_value_usd, paid_duty_usd, sku, hts, origin, supplier, annual_import_value_usd, current_duty_rate, evaluation_date, status, direction, current_annual_duty_usd, computed_annual_duty_usd, computed_total_rate, annual_delta_usd, stack_result, raw_input, error, review_reason, quantity, unit, chapter99_codes, exclusion_id, special_program_claim)
  select x.id, target_customer_id, r.id, x.row_number, x.product_id, x.supplier_id, x.input_valid, coalesce(x.analysis_kind, 'annual_portfolio'), coalesce(x.qualification_verified, false), x.qualification_basis, x.entry_id, x.line_number, x.customs_value_usd, x.paid_duty_usd, x.sku, x.hts, x.origin, x.supplier, x.annual_import_value_usd, x.current_duty_rate, x.evaluation_date, x.status, x.direction, x.current_annual_duty_usd, x.computed_annual_duty_usd, x.computed_total_rate, x.annual_delta_usd, x.stack_result, x.raw_input, x.error, x.review_reason, x.quantity, x.unit, x.chapter99_codes, x.exclusion_id, x.special_program_claim
  from jsonb_populate_recordset(null::public.tariff_impact_rows, row_data) x;
  return r.id;
end;
$create_run$;
revoke all on function public.create_tariff_impact_run(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_tariff_impact_run(uuid,jsonb,jsonb) to authenticated;

commit;
