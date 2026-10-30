-- One immutable official-reference archive for historical audits and live checks.
-- Search embeddings remain a current search index, not the historical rate store.
begin;
create table public.tariff_reference_releases (
 name text primary key check(name ~ '^[0-9]{4}HTS(Basic|Rev[0-9]+)$'),
 description text not null, published_on date not null,
 available_from date not null, available_until date,
 registry_url text not null default 'https://hts.usitc.gov/reststop/releaseList',
 captured_at timestamptz not null default now(),
 check(available_until is null or available_until>available_from)
);
comment on column public.tariff_reference_releases.available_from is 'Publisher release availability; NEVER a legal effective date.';
create table public.tariff_reference_sources (
 id uuid primary key default gen_random_uuid(),
 release_name text references public.tariff_reference_releases(name),
 kind text not null check(kind in ('hts_json','chapter99_pdf','legal_document','legacy_hts','legacy_section232','legacy_stacking','release_registry')),
 url text not null check(url ~ '^https://[^/]+[.]gov/' or url ~ '^urn:cante:legacy:'),
 title text not null check(length(title) between 1 and 300),
 original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
 stored_sha256 text generated always as(encode(extensions.digest(decode(body,'base64'),'sha256'),'hex')) stored,
 body text not null check(octet_length(body)<=12000000),
 compression text not null check(compression in ('none','gzip')),
 original_bytes integer not null check(original_bytes between 1 and 25000000),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=1000000),
 rate_count integer not null default 0 check(rate_count between 0 and 100000),
 captured_at timestamptz not null default now(),
 unique(url,original_sha256)
);
create index tariff_reference_sources_release on public.tariff_reference_sources(release_name,kind,captured_at desc,id);
create index tariff_reference_sources_kind on public.tariff_reference_sources(kind,captured_at desc,id);
create table public.tariff_reference_rates (
 source_id uuid not null references public.tariff_reference_sources(id),
 hts text not null check(hts ~ '^[0-9]{8}([0-9]{2})?$'),
 description text not null, general text not null, special text not null, column2 text not null,
 additional_duties text not null, units jsonb not null check(jsonb_typeof(units)='array'),
 footnotes jsonb not null check(jsonb_typeof(footnotes)='array'),
 primary key(source_id,hts)
);
create index tariff_reference_rates_hts on public.tariff_reference_rates(hts,source_id);
-- Captured references carry no implicit human/legal approval. Approved bundles
-- pin these immutable source ids and explicitly reviewed scope/effective dates.
comment on table public.tariff_reference_sources is 'Captured official evidence or labelled legacy observations; not automatically approved legal rules.';

alter table public.tariff_reference_releases enable row level security;
alter table public.tariff_reference_sources enable row level security;
alter table public.tariff_reference_rates enable row level security;
revoke all on public.tariff_reference_releases,public.tariff_reference_sources,public.tariff_reference_rates from public,anon,authenticated,service_role;
grant select on public.tariff_reference_releases,public.tariff_reference_sources,public.tariff_reference_rates to authenticated,service_role;
grant insert,update on public.tariff_reference_releases to service_role;
grant insert on public.tariff_reference_sources,public.tariff_reference_rates to service_role;
create policy reference_releases_read on public.tariff_reference_releases for select to authenticated using(true);
create policy reference_sources_read on public.tariff_reference_sources for select to authenticated using(true);
create policy reference_rates_read on public.tariff_reference_rates for select to authenticated using(true);
create trigger immutable_tariff_reference_source before update or delete on public.tariff_reference_sources for each row execute function private.prevent_tariff_archive_mutation();
create trigger immutable_tariff_reference_rate before update or delete on public.tariff_reference_rates for each row execute function private.prevent_tariff_archive_mutation();

-- Metadata-only, latest immutable capture per kind/release (and per amendment URL).
create view public.tariff_reference_catalogue with(security_invoker=true) as
 select distinct on(kind,release_name,case when kind='legal_document' then url else '' end)
 id,release_name,kind,url,title,original_sha256,captured_at,metadata,rate_count
 from public.tariff_reference_sources
 order by kind,release_name,case when kind='legal_document' then url else '' end,captured_at desc,id;
revoke all on public.tariff_reference_catalogue from public,anon;
grant select on public.tariff_reference_catalogue to authenticated,service_role;

-- Publish source plus all parsed rates in one transaction, never partial chapters.
create function public.publish_tariff_reference(source jsonb,rates jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; n integer; expected_hash text; retained bytea; source_kind text;
begin
 if jsonb_typeof(source)<>'object' or jsonb_typeof(rates)<>'array' or octet_length(source::text)>13000000 or octet_length(rates::text)>25000000 then raise exception 'Invalid reference package';end if;
 source_kind:=source->>'kind';n:=jsonb_array_length(rates);
 if n>100000 or (source_kind='hts_json' and (n<10000 or source->>'release_name' is null)) or (source_kind<>'hts_json' and n<>0) then raise exception 'Incomplete reference schedule';end if;
 if exists(select 1 from jsonb_array_elements(rates) r group by r->>'hts' having count(*)>1) then raise exception 'Duplicate reference code';end if;
 retained:=decode(source->>'body','base64');expected_hash:=encode(extensions.digest(retained,'sha256'),'hex');
 if expected_hash is distinct from source->>'stored_sha256' then raise exception 'Reference stored-byte hash mismatch';end if;
 if source->>'compression'='none' and (expected_hash is distinct from source->>'original_sha256' or octet_length(retained)<>(source->>'original_bytes')::integer) then raise exception 'Reference original-byte hash mismatch';end if;
 select id into result from public.tariff_reference_sources where url=source->>'url' and original_sha256=source->>'original_sha256';
 if result is not null then
  if (select rate_count from public.tariff_reference_sources where id=result)<>n then raise exception 'Existing reference projection differs';end if;
  return result;
 end if;
 insert into public.tariff_reference_sources(release_name,kind,url,title,original_sha256,body,compression,original_bytes,metadata,rate_count)
 values(source->>'release_name',source_kind,source->>'url',source->>'title',source->>'original_sha256',source->>'body',source->>'compression',(source->>'original_bytes')::integer,coalesce(source->'metadata','{}'::jsonb),n) returning id into result;
 insert into public.tariff_reference_rates(source_id,hts,description,general,special,column2,additional_duties,units,footnotes)
 select result,r.hts,r.description,r.general,r.special,r.column2,r.additional_duties,r.units,r.footnotes
 from jsonb_to_recordset(rates) as r(hts text,description text,general text,special text,column2 text,additional_duties text,units jsonb,footnotes jsonb);
 return result;
end;$$;
revoke all on function public.publish_tariff_reference(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_tariff_reference(jsonb,jsonb) to service_role;

create function public.lookup_tariff_reference_rates(pairs jsonb)
returns setof public.tariff_reference_rates language plpgsql stable security invoker set search_path='' as $$
begin
 if jsonb_typeof(pairs)<>'array' or jsonb_array_length(pairs)>500 or octet_length(pairs::text)>100000 then raise exception 'Reference lookup limit exceeded';end if;
 return query select distinct r.* from jsonb_to_recordset(pairs) as p(source_id uuid,hts text)
 join public.tariff_reference_rates r on r.source_id=p.source_id and r.hts=p.hts;
end;$$;
revoke all on function public.lookup_tariff_reference_rates(jsonb) from public,anon;
grant execute on function public.lookup_tariff_reference_rates(jsonb) to authenticated,service_role;

alter table public.audit_batches add column reference_ids uuid[] not null default '{}' check(cardinality(reference_ids)<=100);
grant insert(reference_ids) on public.audit_batches to authenticated;
-- Kept as one explicit coverage-refresh operation, compatible with older clients.
drop function public.refresh_historical_audit_rules(uuid,uuid[]);
create function public.refresh_historical_audit_rules(target_audit uuid,selected_ids uuid[],selected_reference_ids uuid[] default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.audit_batches; refs uuid[]; rev integer;
begin
 select * into b from public.audit_batches where id=target_audit for update;
 if b.id is null or not private.has_customer_role(b.customer_id,array['owner','admin','member']) then raise exception using errcode='42501',message='Audit write access required';end if;
 refs:=coalesce(selected_reference_ids,b.reference_ids);
 if selected_ids is null or cardinality(selected_ids)>100 or (select count(distinct x) from unnest(selected_ids) x)<>cardinality(selected_ids) or exists(select 1 from unnest(selected_ids) x where not exists(select 1 from public.tariff_rule_bundles r where r.id=x and r.status='approved')) then raise exception 'Select only approved historical rule versions';end if;
 if cardinality(refs)>100 or (select count(distinct x) from unnest(refs) x)<>cardinality(refs) or exists(select 1 from unnest(refs) x where not exists(select 1 from public.tariff_reference_sources s where s.id=x)) then raise exception 'Select retained historical references';end if;
 if coalesce((select array_agg(x order by x) from unnest(selected_ids) x),'{}'::uuid[])=coalesce((select array_agg(x order by x) from unnest(b.bundle_ids) x),'{}'::uuid[]) and coalesce((select array_agg(x order by x) from unnest(refs) x),'{}'::uuid[])=coalesce((select array_agg(x order by x) from unnest(b.reference_ids) x),'{}'::uuid[]) then return false;end if;
 rev:=b.revision+1;
 insert into public.audit_review_events(audit_id,customer_id,revision,decision) values(b.id,b.customer_id,rev,jsonb_build_object('kind','rules_updated','row',0,'note','Historical rule and source versions explicitly refreshed; earlier calculations retained.','evidence','[]'::jsonb));
 update public.audit_batches set bundle_ids=selected_ids,reference_ids=refs,revision=rev,status='ready',active_run_id=null,lease_token=null,lease_until=null,checkpoint='[]'::jsonb,progress=0,input_hash=null,summary=null,last_error=null where id=b.id;
 return true;
end;$$;
revoke all on function public.refresh_historical_audit_rules(uuid,uuid[],uuid[]) from public,anon,service_role;
grant execute on function public.refresh_historical_audit_rules(uuid,uuid[],uuid[]) to authenticated;
commit;
