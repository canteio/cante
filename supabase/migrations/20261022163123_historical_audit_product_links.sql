-- Explicit product associations remain tenant-scoped, including direct RPC calls.
begin;
create or replace function public.record_audit_review(target_audit uuid,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare b public.audit_batches; row_id integer; rev integer;
begin
 select * into b from public.audit_batches where id=target_audit for update;
 if b.id is null or not private.has_customer_role(b.customer_id,array['owner','admin','member']) then raise exception using errcode='42501',message='Audit write access required'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>12000 or payload->>'kind' is null or payload->>'kind' not in ('note','reviewed','resolved','confirm_facts') or coalesce(length(btrim(payload->>'note')),0) not between 10 and 2000 then raise exception 'Record a review note'; end if;
 row_id:=(payload->>'row')::integer;
 if payload ? 'productId' and not exists(select 1 from public.products p where p.id=payload->>'productId' and p.customer_id=b.customer_id) then raise exception 'Product association must belong to this workspace'; end if;
 if row_id is null or row_id not between 1 and (select source_count from public.tariff_impact_runs where id=b.input_run_id and customer_id=b.customer_id) then raise exception 'Invalid entry row'; end if;
 if (payload ? 'origin' and ((payload->>'origin') !~ '^[A-Z]{2}$' or payload->'facts'->>'origin_verified' is distinct from 'true')) or (payload ? 'hts' and ((payload->>'hts') !~ '^[0-9]{10}$' or payload->'facts'->>'classification_verified' is distinct from 'true')) then raise exception 'A correction requires an explicit reviewed fact decision'; end if;
 if payload->>'kind'='confirm_facts' and (jsonb_typeof(payload->'evidence') is distinct from 'array' or jsonb_array_length(payload->'evidence')<1 or (payload->>'validFrom')::date is null or (payload->>'validBefore')::date is null or (payload->>'validBefore')::date<=(payload->>'validFrom')::date) then raise exception 'Evidence and a valid date interval are required'; end if;
 if payload->>'kind' in ('reviewed','resolved') and not exists(select 1 from public.tariff_impact_attestations a where a.audit_id=b.id and a.customer_id=b.customer_id and a.run_id=b.active_run_id and a.revision=b.revision) then raise exception 'Run this revision before reviewing its results'; end if;
 if payload->>'kind'='resolved' and not exists(select 1 from public.audit_entry_results r where r.audit_id=b.id and r.run_id=b.active_run_id and r.row_number=row_id and r.result_text::jsonb->'result'->>'expected' is not null) then raise exception 'Missing calculations cannot be marked resolved'; end if;
 rev:=b.revision+case when payload->>'kind'='confirm_facts' then 1 else 0 end;
 insert into public.audit_review_events(audit_id,customer_id,revision,decision) values(b.id,b.customer_id,rev,payload);
 if payload->>'kind'='confirm_facts' then update public.audit_batches set revision=rev,status='ready',active_run_id=null,lease_token=null,lease_until=null,checkpoint='[]',progress=0,input_hash=null,summary=null,last_error=null where id=b.id; end if;
end;$$;
commit;
