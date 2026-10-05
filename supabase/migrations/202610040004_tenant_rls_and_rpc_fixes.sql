-- Fixes 4 real findings from independent red-team review (deleg_acb62826) of
-- 202610040001_operating_transactions.sql, closed here before that migration
-- is applied. Also tightens two RLS policies that were already live, since
-- the gap pre-dated that migration and is a root-cause fix, not scoped only
-- to the new functions.
--
-- Finding 1 — viewer-role DELETE escalation: the 7 "tenant_access for all"
-- policies below (source_results, chat_messages, product_classifications,
-- supplier_documents, document_findings, product_components,
-- component_substances) gate USING on membership only (any role, including
-- 'viewer') and WITH CHECK on role. Postgres applies WITH CHECK only to
-- INSERT and the new row of UPDATE, NEVER to DELETE — so a 'viewer' member
-- could delete rows in these tables. These tables have no separate SELECT
-- policy (unlike tables with a direct customer_id column, which get a
-- dedicated tenant_read policy from the loop above), so simply tightening
-- USING to role-gated would also take away legitimate viewer read access.
-- Fix: split each single "for all" policy into a membership-gated SELECT
-- policy (preserves viewer read access) and a role-gated ALL-minus-select
-- policy covering INSERT/UPDATE/DELETE (closes the viewer-delete gap,
-- matching the existing WITH CHECK intent for every write path including
-- DELETE this time).
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('source_results', $sql$exists (
        select 1 from public.check_runs r
        where r.id = check_run_id and private.is_customer_member(r.customer_id)
      )$sql$, $sql$exists (
        select 1 from public.check_runs r
        where r.id = check_run_id
          and private.has_customer_role(r.customer_id, array['owner','admin','member'])
      )$sql$),
      ('chat_messages', $sql$exists (
        select 1 from public.conversations c
        where c.id = conversation_id and private.is_customer_member(c.customer_id)
      )$sql$, $sql$exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and private.has_customer_role(c.customer_id, array['owner','admin','member'])
      )$sql$),
      ('product_classifications', $sql$exists (
        select 1 from public.products p
        where p.id = product_id and private.is_customer_member(p.customer_id)
      )$sql$, $sql$exists (
        select 1 from public.products p
        where p.id = product_id
          and private.has_customer_role(p.customer_id, array['owner','admin','member'])
      )$sql$),
      ('supplier_documents', $sql$exists (
        select 1 from public.suppliers s
        where s.id = supplier_id and private.is_customer_member(s.customer_id)
      )$sql$, $sql$exists (
        select 1 from public.suppliers s
        where s.id = supplier_id
          and private.has_customer_role(s.customer_id, array['owner','admin','member'])
      )$sql$),
      ('document_findings', $sql$exists (
        select 1 from public.trade_documents d
        where d.id = document_id and private.is_customer_member(d.customer_id)
      )$sql$, $sql$exists (
        select 1 from public.trade_documents d
        where d.id = document_id
          and private.has_customer_role(d.customer_id, array['owner','admin','member'])
      )$sql$),
      ('product_components', $sql$exists (
        select 1 from public.products p
        where p.id = product_id and private.is_customer_member(p.customer_id)
      )$sql$, $sql$exists (
        select 1 from public.products p
        where p.id = product_id
          and private.has_customer_role(p.customer_id, array['owner','admin','member'])
      )$sql$),
      ('component_substances', $sql$exists (
        select 1
        from public.product_components pc
        join public.products p on p.id = pc.product_id
        where pc.id = component_id and private.is_customer_member(p.customer_id)
      )$sql$, $sql$exists (
        select 1
        from public.product_components pc
        join public.products p on p.id = pc.product_id
        where pc.id = component_id
          and private.has_customer_role(p.customer_id, array['owner','admin','member'])
      )$sql$)
    ) as t(table_name, member_check, role_check)
  loop
    execute format('drop policy if exists tenant_access on public.%I', spec.table_name);
    execute format(
      'create policy tenant_read on public.%I for select to authenticated using (%s)',
      spec.table_name, spec.member_check
    );
    execute format(
      'create policy tenant_write on public.%I for insert to authenticated with check (%s)',
      spec.table_name, spec.role_check
    );
    execute format(
      'create policy tenant_update on public.%I for update to authenticated using (%s) with check (%s)',
      spec.table_name, spec.role_check, spec.role_check
    );
    execute format(
      'create policy tenant_delete on public.%I for delete to authenticated using (%s)',
      spec.table_name, spec.role_check
    );
  end loop;
end $$;

-- Finding 2 — load_cante_restriction_list's write protection is accidental:
-- it relies on no migration having granted INSERT on these reference tables
-- to `authenticated`, not on anything the function or a GRANT actually
-- enforces. Make it explicit and durable: revoke any write grant on these
-- shared reference tables from authenticated (idempotent — a no-op today,
-- insurance against a future migration accidentally adding one), and gate
-- the function itself on the caller holding an owner/admin role in AT LEAST
-- ONE customer workspace, since restricted-substance lists are shared
-- reference data with no customer_id of their own to check membership
-- against.
revoke insert, update, delete on public.restricted_substance_lists,
  public.restricted_substance_entries, public.substances from authenticated;

create or replace function private.is_trusted_operator()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.customer_users
    where user_id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_trusted_operator() from public, anon;
grant execute on function private.is_trusted_operator() to authenticated;

create or replace function public.load_cante_restriction_list(list_row jsonb, entries jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  substance_key text;
  list_key text;
begin
  if not private.is_trusted_operator() then
    raise exception 'Only an owner or admin of a workspace may load a restriction list.';
  end if;
  -- Force-generate the id server-side, matching every other function in
  -- this file — the prior version let the caller control this shared
  -- reference table's primary key directly from the JSON payload.
  list_key := gen_random_uuid()::text;
  insert into public.restricted_substance_lists
    select * from jsonb_populate_record(
      null::public.restricted_substance_lists,
      list_row || jsonb_build_object('id', list_key)
    );
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

-- Finding 3 — replace_document_findings / replace_impact_assessments never
-- verified that FK references inside the replacement JSON (product_id,
-- lane_id, or similar) actually belong to the caller's own customer, so a
-- member of workspace A could plant a row in their OWN document/finding
-- that points at workspace B's product/lane id, creating a cross-tenant FK
-- link even though the row itself is correctly scoped. This repo's actual
-- document_findings/impact_assessments columns are checked below — only
-- columns that exist in the real schema are validated.
create or replace function public.replace_document_findings(target_document_id text, replacement jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owning_customer_id uuid;
begin
  select customer_id into owning_customer_id from public.trade_documents where id = target_document_id for update;
  if owning_customer_id is null then raise exception 'Document not found.'; end if;
  if exists (select 1 from jsonb_array_elements(replacement) as item(value)
    where item.value->>'document_id' is distinct from target_document_id) then
    raise exception 'Replacement findings must belong to this document.';
  end if;
  -- document_findings.product_id is a nullable FK to public.products. Only
  -- document_id was validated above; a caller could otherwise plant a row
  -- correctly scoped to their own document while pointing product_id at a
  -- DIFFERENT customer's product — the cross-tenant FK-planting gap finding
  -- 3 (deleg_acb62826, re-confirmed still open by deleg_f2067857) described.
  -- A non-null product_id must belong to the same customer that owns this
  -- document.
  if exists (
    select 1 from jsonb_array_elements(replacement) as item(value)
    where item.value->>'product_id' is not null
      and not exists (
        select 1 from public.products p
        where p.id = item.value->>'product_id' and p.customer_id = owning_customer_id
      )
  ) then
    raise exception 'Replacement finding product_id must belong to this document''s customer.';
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
  -- impact_assessments.product_id/lane_id are nullable FKs to
  -- public.products/public.trade_lanes. Only finding_id/customer_id were
  -- validated above; same cross-tenant FK-planting gap as
  -- replace_document_findings above — a non-null product_id or lane_id
  -- must belong to the SAME target_customer_id, not just exist anywhere.
  if exists (
    select 1 from jsonb_array_elements(replacement) as item(value)
    where item.value->>'product_id' is not null
      and not exists (
        select 1 from public.products p
        where p.id = item.value->>'product_id' and p.customer_id = target_customer_id
      )
  ) then
    raise exception 'Replacement impact product_id must belong to this customer.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(replacement) as item(value)
    where item.value->>'lane_id' is not null
      and not exists (
        select 1 from public.trade_lanes l
        where l.id = item.value->>'lane_id' and l.customer_id = target_customer_id
      )
  ) then
    raise exception 'Replacement impact lane_id must belong to this customer.';
  end if;
  delete from public.impact_assessments where finding_id = target_finding_id and customer_id = target_customer_id;
  insert into public.impact_assessments
    select * from jsonb_populate_recordset(null::public.impact_assessments, replacement);
end;
$$;

-- Finding 4 — record_source_inventory let the caller fully control the
-- source_documents primary key and provenance timestamps via
-- jsonb_populate_record (every sibling function force-generates its id;
-- this one didn't), enabling a PK-collision DoS against another tenant's
-- row id and falsified first/last-seen timestamps. Force-generate the id
-- server-side and ignore any id/customer_id/jurisdiction supplied in the
-- JSON payload (those three are set explicitly from the function's own
-- trusted parameters, same pattern as import_cante_products/_lanes).
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
    next_row.customer_id := target_customer_id;
    next_row.jurisdiction := target_jurisdiction;
    select * into prior from public.source_documents where customer_id = target_customer_id
      and jurisdiction = target_jurisdiction and source_id = next_row.source_id and identity = next_row.identity for update;
    if found then
      if prior.content_hash is distinct from item->>'expected_hash' then
        raise exception 'Source inventory changed concurrently; retry the check.';
      end if;
      update public.source_documents set content_hash = next_row.content_hash,
        last_seen_at = next_row.last_seen_at, last_changed_at = next_row.last_changed_at
        where id = prior.id and customer_id = target_customer_id and jurisdiction = target_jurisdiction;
    else
      if item->>'expected_hash' is not null then raise exception 'Source inventory was removed concurrently; retry the check.'; end if;
      -- Force-generate the id server-side rather than trusting the payload.
      next_row.id := gen_random_uuid()::text;
      insert into public.source_documents select (next_row).*;
    end if;
  end loop;
end;
$$;
