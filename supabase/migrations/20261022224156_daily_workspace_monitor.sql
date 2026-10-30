begin;
alter table public.tariff_source_versions drop constraint tariff_source_versions_url_check;
alter table public.tariff_source_versions add constraint tariff_source_versions_url_check check(length(url)<=2048 and url ~ '^https://(hts[.]usitc[.]gov|www[.]usitc[.]gov|www[.]federalregister[.]gov|www[.]govinfo[.]gov|content[.]govdelivery[.]com|www[.]whitehouse[.]gov)/');

create table public.tariff_daily_monitors (
 customer_id uuid primary key references public.customers(id),
 enabled boolean not null default false, configured_by uuid not null references auth.users(id), configured_at timestamptz not null default now(),
 next_check_at timestamptz not null default now(),last_attempt_at timestamptz,last_success_at timestamptz,
 last_check_id uuid,last_status text not null default 'idle' check(last_status in ('idle','running','completed','failed')),
 last_error text,lease_token uuid,lease_until timestamptz,
 foreign key(last_check_id,customer_id) references public.tariff_check_records(id,customer_id)
);
create index daily_monitor_due on public.tariff_daily_monitors(next_check_at,customer_id) where enabled;
create index daily_monitor_actor on public.tariff_daily_monitors(configured_by);
create index daily_monitor_check on public.tariff_daily_monitors(last_check_id,customer_id);
create index daily_monitor_attempt on public.tariff_daily_monitors(last_attempt_at desc);
create table public.tariff_daily_events (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null,check_id uuid not null,
 created_at timestamptz not null default now(),kind text not null check(kind in ('change','review','failure')),
 title text not null check(length(title) between 1 and 200),detail jsonb not null check(jsonb_typeof(detail)='object' and octet_length(detail::text)<=20000),
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 foreign key(check_id,customer_id) references public.tariff_check_records(id,customer_id),unique(customer_id,digest)
);
create index daily_events_check on public.tariff_daily_events(check_id,customer_id);
create index daily_events_customer_date on public.tariff_daily_events(customer_id,created_at desc,id);
alter table public.tariff_daily_monitors enable row level security;
alter table public.tariff_daily_events enable row level security;
revoke all on public.tariff_daily_monitors,public.tariff_daily_events from public,anon,authenticated,service_role;
grant select(customer_id,enabled,configured_at,next_check_at,last_attempt_at,last_success_at,last_check_id,last_status,last_error) on public.tariff_daily_monitors to authenticated;
grant select on public.tariff_daily_events to authenticated;
grant select on public.tariff_daily_monitors,public.tariff_daily_events to service_role;
grant insert on public.tariff_daily_events to service_role;
-- Background readers remain explicitly tenant-filtered. Their writes use scoped RPCs.
grant select on public.tariff_check_records,public.tariff_check_events,public.tariff_source_versions to service_role;
create policy daily_settings_read on public.tariff_daily_monitors for select to authenticated using(private.is_customer_member(customer_id));
create policy daily_events_read on public.tariff_daily_events for select to authenticated using(private.is_customer_member(customer_id));
create trigger immutable_daily_event before update or delete on public.tariff_daily_events for each row execute function private.prevent_tariff_archive_mutation();

create function public.set_tariff_daily_monitor(target_customer uuid,enable boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if enable is null or not private.has_customer_role(target_customer,array['owner','admin']) then raise exception using errcode='42501',message='Workspace owner/admin required';end if;
 insert into public.tariff_daily_monitors(customer_id,enabled,configured_by) values(target_customer,enable,auth.uid())
 on conflict(customer_id) do update set enabled=excluded.enabled,configured_by=excluded.configured_by,configured_at=now(),next_check_at=case when not tariff_daily_monitors.enabled and excluded.enabled then now() else tariff_daily_monitors.next_check_at end;
end;$$;
revoke all on function public.set_tariff_daily_monitor(uuid,boolean) from public,anon,service_role;
grant execute on function public.set_tariff_daily_monitor(uuid,boolean) to authenticated;

create function public.claim_tariff_daily_monitor()
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.tariff_daily_monitors;
begin
 perform pg_advisory_xact_lock(224126,1);
 -- One background check at a time and at most one admission per five minutes.
 if exists(select 1 from public.tariff_daily_monitors where lease_until>now() or last_attempt_at>now()-interval '5 minutes') then return null;end if;
 select * into m from public.tariff_daily_monitors s where enabled and next_check_at<=now() and (lease_until is null or lease_until<=now())
 and exists(select 1 from public.customer_users u where u.customer_id=s.customer_id and u.user_id=s.configured_by and u.role in ('owner','admin'))
 order by next_check_at,customer_id limit 1 for update skip locked;
 if not found then return null;end if;
 update public.tariff_daily_monitors set lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes',last_attempt_at=now(),last_status='running',last_error=null where customer_id=m.customer_id returning * into m;
 return to_jsonb(m);
end;$$;
revoke all on function public.claim_tariff_daily_monitor() from public,anon,authenticated;
grant execute on function public.claim_tariff_daily_monitor() to service_role;

create function public.begin_tariff_daily_check(target_customer uuid,token uuid,csv text,engine_info jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare m public.tariff_daily_monitors;result uuid;
begin
 select * into m from public.tariff_daily_monitors where customer_id=target_customer and enabled and lease_token=token and lease_until>now() for update;
 if m.customer_id is null then raise exception 'Daily check lease unavailable';end if;
 if jsonb_typeof(engine_info)<>'object' then raise exception 'Invalid engine identity';end if;
 insert into public.tariff_check_records(customer_id,actor_id,filename,input_csv,confirmations,engine)
 values(target_customer,m.configured_by,'Scheduled saved products.csv',csv,'{}',engine_info||jsonb_build_object('workflow','daily-workspace-v1','scheduled',true)) returning id into result;
 update public.tariff_daily_monitors set last_check_id=result where customer_id=target_customer;
 return result;
end;$$;
revoke all on function public.begin_tariff_daily_check(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_tariff_daily_check(uuid,uuid,text,jsonb) to service_role;

-- One payload writer for member checks and leased scheduled checks. Even direct
-- helper calls must prove either record ownership or the private live lease.
create function private.complete_tariff_check_payload(target_check_id uuid,target_customer_id uuid,report_text text,sources jsonb,outcome text,monitor_token uuid)
returns uuid language plpgsql security definer set search_path='' as $function$
declare actor uuid; s jsonb; version_id uuid; actual_hash text; event_id uuid; refs jsonb:='[]'::jsonb; bytes bigint:=0; final_payload text;
begin
 select actor_id into actor from public.tariff_check_records where id=target_check_id and customer_id=target_customer_id;
 if outcome not in ('completed','failed') then raise exception 'Invalid check outcome'; end if;
 if monitor_token is null then
  if auth.uid() is null or not private.has_customer_role(target_customer_id,array['owner','admin','member']) or not exists(select 1 from public.tariff_check_records where id=target_check_id and customer_id=target_customer_id and actor_id=auth.uid()) then raise exception 'Write access required';end if;
 else
  if not exists(select 1 from public.tariff_daily_monitors where customer_id=target_customer_id and enabled and lease_token=monitor_token and lease_until>now() and last_check_id=target_check_id) then raise exception 'Daily check lease unavailable';end if;
 end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_check_id::text,0));
 if exists(select 1 from public.tariff_check_events where check_id=target_check_id and kind in ('completed','failed')) then raise exception 'Check already finished'; end if;
 if jsonb_typeof(report_text::jsonb)<>'object' or octet_length(report_text)>12000000 or jsonb_typeof(sources)<>'array' or jsonb_array_length(sources)>500 then raise exception 'Invalid evidence package'; end if;
 for s in select value from jsonb_array_elements(sources) loop
   version_id:=null;
   if s->>'body' is not null then
     bytes:=bytes+octet_length(s->>'body'); if bytes>32000000 then raise exception 'Evidence capture exceeds archive limit'; end if;
     actual_hash:=encode(extensions.digest(case when coalesce(s->>'bodyEncoding','utf8')='base64' then decode(s->>'body','base64') else convert_to(s->>'body','UTF8') end,'sha256'),'hex');
     if actual_hash is distinct from s->>'sha256' then raise exception 'Source hash mismatch'; end if;
     insert into public.tariff_source_versions(customer_id,actor_id,url,encoding,body,compression,original_sha256) values(target_customer_id,actor,s->>'url',coalesce(s->>'bodyEncoding','utf8'),s->>'body',s->>'compression',s->>'originalSha256') on conflict(customer_id,url,sha256) do nothing;
     select id into version_id from public.tariff_source_versions where customer_id=target_customer_id and url=s->>'url' and sha256=actual_hash;
     if version_id is null then raise exception 'Source version not retained'; end if;
   end if;
   refs:=refs||jsonb_build_array((s-'body')||jsonb_build_object('versionId',version_id));
 end loop;
 final_payload:=jsonb_build_object('report',report_text::jsonb,'sources',refs)::text;
 insert into public.tariff_check_events(customer_id,check_id,actor_id,kind,payload_text) values(target_customer_id,target_check_id,actor,outcome,final_payload) returning id into event_id;
 return event_id;
end;
$function$;

revoke all on function private.complete_tariff_check_payload(uuid,uuid,text,jsonb,text,uuid) from public,anon;
grant execute on function private.complete_tariff_check_payload(uuid,uuid,text,jsonb,text,uuid) to authenticated,service_role;
create or replace function public.complete_tariff_check(target_check_id uuid,target_customer_id uuid,report_text text,sources jsonb,outcome text default 'completed')
returns uuid language sql security invoker set search_path='' as $$
 select private.complete_tariff_check_payload(target_check_id,target_customer_id,report_text,sources,outcome,null);
$$;
create function public.complete_tariff_daily_check(target_check_id uuid,target_customer_id uuid,token uuid,report_text text,sources jsonb,outcome text default 'completed')
returns uuid language sql security invoker set search_path='' as $$
 select private.complete_tariff_check_payload(target_check_id,target_customer_id,report_text,sources,outcome,token);
$$;
revoke all on function public.complete_tariff_daily_check(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.complete_tariff_daily_check(uuid,uuid,uuid,text,jsonb,text) to service_role;
create function public.finish_tariff_daily_monitor(target_customer uuid,token uuid,success boolean,error_detail text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if success and not exists(select 1 from public.tariff_daily_monitors m join public.tariff_check_attestations a on a.check_id=m.last_check_id and a.customer_id=m.customer_id join public.tariff_check_events e on e.id=a.terminal_event_id and e.check_id=a.check_id and e.customer_id=a.customer_id where m.customer_id=target_customer and m.lease_token=token and e.kind='completed') then raise exception 'Protected completed check required';end if;
 update public.tariff_daily_monitors set lease_token=null,lease_until=null,last_status=case when success then 'completed' else 'failed' end,
 last_success_at=case when success then now() else last_success_at end,next_check_at=now()+case when success then interval '24 hours' else interval '1 hour' end,last_error=case when success then null else left(coalesce(error_detail,'Scheduled check failed'),1000) end
 where customer_id=target_customer and lease_token=token;
 if not found then raise exception 'Daily check lease changed';end if;
end;$$;
revoke all on function public.finish_tariff_daily_monitor(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_tariff_daily_monitor(uuid,uuid,boolean,text) to service_role;
commit;
