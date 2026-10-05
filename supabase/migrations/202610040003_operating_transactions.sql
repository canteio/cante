-- REST statements are individually atomic. These invoker functions preserve the
-- multi-row transactions used by catalogue imports, approvals and evidence.
-- They use the caller's privileges and RLS; none bypasses tenant membership.
create or replace function public.approve_product_classification(target_id text, approver text, reason text)
returns public.product_classifications
language plpgsql security invoker set search_path = '' as $$
declare
  chosen public.product_classifications;
  product_key text;
begin
  select product_id into product_key from public.product_classifications where id = target_id;
  if not found then raise exception 'Classification not found.'; end if;
  -- Serialize approvals for the product before reading the current history.
  perform 1 from public.products where id = product_key for update;
  select * into chosen from public.product_classifications where id = target_id for update;
  if not found then raise exception 'Classification not found.'; end if;
  if chosen.superseded_at is not null then raise exception 'That classification is superseded.'; end if;
  if coalesce(btrim(approver), '') = '' then raise exception 'Approval requires a named approver.'; end if;
  if coalesce(btrim(reason), '') = '' then raise exception 'Approval requires a written rationale.'; end if;
  if chosen.tier not in ('document', 'human') then
    raise exception 'A %-tier code cannot be approved. Establish it from a document or confirm it as a person first.', chosen.tier;
  end if;
  update public.product_classifications
    set status = 'superseded', superseded_at = now(), superseded_by = chosen.id
    where product_id = chosen.product_id and system = chosen.system
      and jurisdiction is not distinct from chosen.jurisdiction
      and status = 'approved' and superseded_at is null and id <> chosen.id;
  update public.product_classifications
    set status = 'approved', approved_by = approver, approved_at = now(), rationale = reason
    where id = chosen.id returning * into chosen;
  if not found then raise exception 'Classification approval was not permitted.'; end if;
  return chosen;
end;
$$;

create or replace function public.import_cante_products(target_customer_id uuid, entries jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  code_row jsonb;
  prior public.products;
  next_row public.products;
  classification public.product_classifications;
  outcome text;
  results jsonb := '[]'::jsonb;
begin
  -- Also serializes concurrent imports of the same tenant's catalogue.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_customer_id::text || ':catalogue', 0));
  for item in select value from jsonb_array_elements(entries) loop
    select * into prior from public.products
      where customer_id = target_customer_id and sku = item->'product'->>'sku' for update;
    if not found then
      next_row := jsonb_populate_record(null::public.products, item->'product');
      next_row.id := gen_random_uuid()::text;
      next_row.customer_id := target_customer_id;
      next_row.active := true;
      next_row.created_at := now(); next_row.updated_at := now();
      insert into public.products select (next_row).*;
      outcome := 'created';
    elsif to_jsonb(prior) @> (item->'product') then
      next_row := prior;
      outcome := 'unchanged';
    else
      next_row := jsonb_populate_record(prior, item->'product');
      update public.products set
        name = next_row.name, description = next_row.description, materials = next_row.materials,
        origin_country = next_row.origin_country, unit_of_measure = next_row.unit_of_measure,
        unit_value = next_row.unit_value, currency = next_row.currency,
        product_class = next_row.product_class, notes = next_row.notes, updated_at = now()
        where id = prior.id and customer_id = target_customer_id returning * into next_row;
      if not found then raise exception 'Product update was not permitted.'; end if;
      outcome := 'updated';
    end if;
    for code_row in select value from jsonb_array_elements(item->'codes') loop
      select * into classification from public.product_classifications
        where product_id = next_row.id and system = code_row->>'system'
          and code = regexp_replace(code_row->>'code', '\s+', '', 'g')
          and jurisdiction is null and superseded_at is null limit 1;
      if not found then
        insert into public.product_classifications (id, product_id, system, code, tier, basis)
        values (gen_random_uuid()::text, next_row.id, code_row->>'system',
          regexp_replace(code_row->>'code', '\s+', '', 'g'), 'lead', code_row->>'basis');
      elsif classification.tier not in ('lead', 'human', 'document') then
        update public.product_classifications set tier = 'lead', basis = code_row->>'basis'
          where id = classification.id;
      end if;
    end loop;
    results := results || jsonb_build_array(jsonb_build_object('line', item->'line', 'sku', next_row.sku, 'outcome', outcome));
  end loop;
  return results;
end;
$$;

create or replace function public.import_cante_lanes(target_customer_id uuid, entries jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  lane public.trade_lanes;
  supplier_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_customer_id::text || ':lanes', 0));
  for item in select value from jsonb_array_elements(entries) loop
    lane := jsonb_populate_record(null::public.trade_lanes, item->'lane');
    lane.id := gen_random_uuid()::text; lane.customer_id := target_customer_id;
    lane.active := true; lane.created_at := now(); lane.updated_at := now();
    if lane.product_id is not null and not exists (
      select 1 from public.products where id = lane.product_id and customer_id = target_customer_id
    ) then raise exception 'Lane product is not in this customer catalogue.'; end if;
    supplier_key := null;
    if coalesce(btrim(item->>'supplier_name'), '') <> '' then
      select id into supplier_key from public.suppliers
        where customer_id = target_customer_id and name = btrim(item->>'supplier_name') limit 1;
      if supplier_key is null then
        supplier_key := gen_random_uuid()::text;
        insert into public.suppliers (id, customer_id, name)
          values (supplier_key, target_customer_id, btrim(item->>'supplier_name'));
      end if;
      -- Matching an existing supplier by name must not touch any of its
      -- other fields. The original version nulled country/address/
      -- contact_email/notes on every re-import, silently destroying
      -- previously entered data (flagged by independent review
      -- deleg_acb62826) — a lane import only needs the supplier to exist
      -- and be linked, never to overwrite it.
    end if;
    lane.supplier_id := supplier_key;
    insert into public.trade_lanes select (lane).*;
  end loop;
end;
$$;

create or replace function public.replace_document_findings(target_document_id text, replacement jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.trade_documents where id = target_document_id for update;
  if not found then raise exception 'Document not found.'; end if;
  if exists (select 1 from jsonb_array_elements(replacement) as item(value)
    where item.value->>'document_id' is distinct from target_document_id) then
    raise exception 'Replacement findings must belong to this document.';
  end if;
  delete from public.document_findings where document_id = target_document_id;
  insert into public.document_findings
    select * from jsonb_populate_recordset(null::public.document_findings, replacement);
end;
$$;

create or replace function public.replace_impact_assessments(target_customer_id uuid, target_finding_id text, replacement jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.findings where id = target_finding_id and customer_id = target_customer_id for update;
  if not found then raise exception 'Finding not found for this customer.'; end if;
  if exists (select 1 from jsonb_array_elements(replacement) as item(value)
    where item.value->>'finding_id' is distinct from target_finding_id
      or item.value->>'customer_id' is distinct from target_customer_id::text) then
    raise exception 'Replacement impacts must belong to this finding and customer.';
  end if;
  delete from public.impact_assessments where finding_id = target_finding_id and customer_id = target_customer_id;
  insert into public.impact_assessments
    select * from jsonb_populate_recordset(null::public.impact_assessments, replacement);
end;
$$;

create or replace function public.record_source_inventory(target_customer_id uuid, target_jurisdiction text, entries jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  prior public.source_documents;
  next_row public.source_documents;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_customer_id::text || ':inventory:' || target_jurisdiction, 0));
  for item in select value from jsonb_array_elements(entries) loop
    next_row := jsonb_populate_record(null::public.source_documents, item);
    if next_row.customer_id is distinct from target_customer_id or next_row.jurisdiction is distinct from target_jurisdiction then
      raise exception 'Source inventory belongs to a different workspace.';
    end if;
    select * into prior from public.source_documents where customer_id = target_customer_id
      and jurisdiction = target_jurisdiction and source_id = next_row.source_id and identity = next_row.identity for update;
    if found then
      if prior.content_hash is distinct from item->>'expected_hash' then
        raise exception 'Source inventory changed concurrently; retry the check.';
      end if;
      update public.source_documents set content_hash = next_row.content_hash,
        last_seen_at = next_row.last_seen_at, last_changed_at = next_row.last_changed_at where id = prior.id;
    else
      if item->>'expected_hash' is not null then raise exception 'Source inventory was removed concurrently; retry the check.'; end if;
      insert into public.source_documents select (next_row).*;
    end if;
  end loop;
end;
$$;

-- Reference tables remain writable only by the trusted role. SECURITY INVOKER
-- intentionally preserves that rule, including for calls from authenticated UI.
create or replace function public.load_cante_restriction_list(list_row jsonb, entries jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  substance_key text;
  list_key text := list_row->>'id';
begin
  insert into public.restricted_substance_lists
    select * from jsonb_populate_record(null::public.restricted_substance_lists, list_row);
  for item in select value from jsonb_array_elements(entries) loop
    substance_key := null;
    if item->>'cas_number' is not null then
      select id into substance_key from public.substances where cas_number = item->>'cas_number';
    end if;
    if substance_key is null then
      substance_key := gen_random_uuid()::text;
      insert into public.substances (id, name, cas_number)
        values (substance_key, btrim(item->>'name'), item->>'cas_number');
    end if;
    insert into public.restricted_substance_entries
      (id, list_id, substance_id, threshold_ppm, restriction, effective_on, citation)
      values (gen_random_uuid()::text, list_key, substance_key, (item->>'threshold_ppm')::double precision,
        coalesce(item->>'restriction', 'restricted'), (item->>'effective_on')::date, item->>'citation');
  end loop;
end;
$$;

revoke all on function public.approve_product_classification(text, text, text) from public;
revoke all on function public.import_cante_products(uuid, jsonb) from public;
revoke all on function public.import_cante_lanes(uuid, jsonb) from public;
revoke all on function public.replace_document_findings(text, jsonb) from public;
revoke all on function public.replace_impact_assessments(uuid, text, jsonb) from public;
revoke all on function public.record_source_inventory(uuid, text, jsonb) from public;
revoke all on function public.load_cante_restriction_list(jsonb, jsonb) from public;
grant execute on function public.approve_product_classification(text, text, text) to authenticated, service_role;
grant execute on function public.import_cante_products(uuid, jsonb) to authenticated, service_role;
grant execute on function public.import_cante_lanes(uuid, jsonb) to authenticated, service_role;
grant execute on function public.replace_document_findings(text, jsonb) to authenticated, service_role;
grant execute on function public.replace_impact_assessments(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.record_source_inventory(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.load_cante_restriction_list(jsonb, jsonb) to authenticated, service_role;
