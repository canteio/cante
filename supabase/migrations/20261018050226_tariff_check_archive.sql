begin;
-- Tenant-owned evidence, not a global verified-law database. Captured dates are
-- observations; legal effective dates are never inferred from the fetch time.
create table public.tariff_check_records (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id) on delete restrict,
 created_at timestamptz not null default now(),
 actor_id uuid not null default auth.uid(),
 filename text not null check (length(filename) between 1 and 160),
 input_csv text not null check (octet_length(input_csv) between 1 and 1000000),
 input_sha256 text generated always as (encode(extensions.digest(input_csv,'sha256'),'hex')) stored,
 confirmations jsonb not null check (jsonb_typeof(confirmations)='object' and octet_length(confirmations::text)<2000),
 engine jsonb not null check (jsonb_typeof(engine)='object' and octet_length(engine::text)<65536),
 unique(id,customer_id)
);
create index tariff_check_records_customer_date on public.tariff_check_records(customer_id,created_at desc,id desc);
create table public.tariff_source_versions (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id) on delete restrict,
 captured_at timestamptz not null default now(),
 actor_id uuid not null default auth.uid(),
 url text not null check (length(url)<=2048 and url ~ '^https://(hts[.]usitc[.]gov|www[.]federalregister[.]gov|content[.]govdelivery[.]com)/'),
 encoding text not null check (encoding in ('utf8','base64')),
 body text not null check (octet_length(body)<=12000000),
 sha256 text generated always as (case when encoding='base64' then encode(extensions.digest(decode(body,'base64'),'sha256'),'hex') else encode(extensions.digest(body,'sha256'),'hex') end) stored,
 unique(customer_id,url,sha256), unique(id,customer_id)
);
create index tariff_source_versions_customer_date on public.tariff_source_versions(customer_id,captured_at desc,id desc);
create table public.tariff_check_events (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null,
 check_id uuid not null,
 created_at timestamptz not null default now(),
 actor_id uuid not null default auth.uid(),
 kind text not null check (kind in ('completed','failed','review')),
 payload_text text not null check (octet_length(payload_text)<=24000000 and jsonb_typeof(payload_text::jsonb)='object'),
 payload_sha256 text generated always as (encode(extensions.digest(payload_text,'sha256'),'hex')) stored,
 foreign key (check_id,customer_id) references public.tariff_check_records(id,customer_id) on delete restrict,
 check (kind<>'review' or coalesce(((payload_text::jsonb->>'decision') in ('reviewed','needs_information','broker_review','superseded') and length(btrim(payload_text::jsonb->>'note')) between 1 and 4000),false))
);
create unique index tariff_check_one_terminal on public.tariff_check_events(check_id) where kind in ('completed','failed');
create index tariff_check_events_customer_check on public.tariff_check_events(customer_id,check_id,created_at,id);

create function private.prevent_tariff_archive_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Archive records are append-only. Add a new check or review decision.'; end;
$$;
revoke all on function private.prevent_tariff_archive_mutation() from public,anon,authenticated;
-- Even a privileged application client cannot silently rewrite evidence.
create trigger immutable_check before update or delete on public.tariff_check_records for each row execute function private.prevent_tariff_archive_mutation();
create trigger immutable_source before update or delete on public.tariff_source_versions for each row execute function private.prevent_tariff_archive_mutation();
create trigger immutable_check_event before update or delete on public.tariff_check_events for each row execute function private.prevent_tariff_archive_mutation();

alter table public.tariff_check_records enable row level security;
alter table public.tariff_source_versions enable row level security;
alter table public.tariff_check_events enable row level security;
revoke all on public.tariff_check_records,public.tariff_source_versions,public.tariff_check_events from public,anon,authenticated,service_role;
grant select on public.tariff_check_records,public.tariff_source_versions,public.tariff_check_events to authenticated;
-- Timestamp and actor columns cannot be supplied or backdated by an API caller.
grant insert(id,customer_id,filename,input_csv,confirmations,engine) on public.tariff_check_records to authenticated;
grant insert(customer_id,url,encoding,body) on public.tariff_source_versions to authenticated;
grant insert(customer_id,check_id,kind,payload_text) on public.tariff_check_events to authenticated;
create policy read_archive on public.tariff_check_records for select to authenticated using(private.is_customer_member(customer_id));
create policy insert_archive on public.tariff_check_records for insert to authenticated with check(private.has_customer_role(customer_id,array['owner','admin','member']) and actor_id=auth.uid());
create policy read_versions on public.tariff_source_versions for select to authenticated using(private.is_customer_member(customer_id));
create policy insert_versions on public.tariff_source_versions for insert to authenticated with check(private.has_customer_role(customer_id,array['owner','admin','member']) and actor_id=auth.uid());
create policy read_check_events on public.tariff_check_events for select to authenticated using(private.is_customer_member(customer_id));
create policy insert_check_events on public.tariff_check_events for insert to authenticated with check(private.has_customer_role(customer_id,array['owner','admin','member']) and actor_id=auth.uid() and (kind='review' or exists(select 1 from public.tariff_check_records r where r.id=check_id and r.customer_id=tariff_check_events.customer_id and r.actor_id=auth.uid())));

-- Invoker function: ordinary authenticated/RLS access only; no service key.
-- Atomically archive evidence and the terminal event, or retain neither.
create function public.complete_tariff_check(target_check_id uuid, target_customer_id uuid, report_text text, sources jsonb, outcome text default 'completed')
returns uuid language plpgsql security invoker set search_path='' as $$
declare s jsonb; version_id uuid; actual_hash text; event_id uuid; refs jsonb:='[]'; bytes bigint:=0; final_payload text;
begin
 if outcome not in ('completed','failed') then raise exception 'Invalid check outcome'; end if;
 if auth.uid() is null or not private.has_customer_role(target_customer_id,array['owner','admin','member']) then raise exception 'Write access required'; end if;
 if not exists(select 1 from public.tariff_check_records where id=target_check_id and customer_id=target_customer_id and actor_id=auth.uid()) then raise exception 'Check not found'; end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_check_id::text,0));
 if exists(select 1 from public.tariff_check_events where check_id=target_check_id and kind in ('completed','failed')) then raise exception 'Check already finished'; end if;
 if jsonb_typeof(report_text::jsonb)<>'object' or octet_length(report_text)>12000000 or jsonb_typeof(sources)<>'array' or jsonb_array_length(sources)>500 then raise exception 'Invalid evidence package'; end if;
 for s in select value from jsonb_array_elements(sources) loop
   version_id:=null;
   if s->>'body' is not null then
     bytes:=bytes+octet_length(s->>'body'); if bytes>32000000 then raise exception 'Evidence capture exceeds archive limit'; end if;
     actual_hash:=encode(extensions.digest(case when coalesce(s->>'bodyEncoding','utf8')='base64' then decode(s->>'body','base64') else convert_to(s->>'body','UTF8') end,'sha256'),'hex');
     if actual_hash is distinct from s->>'sha256' then raise exception 'Source hash mismatch'; end if;
     insert into public.tariff_source_versions(customer_id,url,encoding,body) values(target_customer_id,s->>'url',coalesce(s->>'bodyEncoding','utf8'),s->>'body') on conflict(customer_id,url,sha256) do nothing;
     select id into version_id from public.tariff_source_versions where customer_id=target_customer_id and url=s->>'url' and sha256=actual_hash;
     if version_id is null then raise exception 'Source version not retained'; end if;
   end if;
   refs:=refs||jsonb_build_array((s-'body')||jsonb_build_object('versionId',version_id));
 end loop;
 final_payload:=jsonb_build_object('report',report_text::jsonb,'sources',refs)::text;
 insert into public.tariff_check_events(customer_id,check_id,kind,payload_text) values(target_customer_id,target_check_id,outcome,final_payload) returning id into event_id;
 return event_id;
end;
$$;
revoke all on function public.complete_tariff_check(uuid,uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.complete_tariff_check(uuid,uuid,text,jsonb,text) to authenticated;
comment on table public.tariff_source_versions is 'Append-only workspace evidence captured by checks. Not a complete legislative archive or independent verification of law. captured_at is not a legal effective date.';
commit;
