-- Fixed UTC-hour/day budgets and concurrent leases shared by every application instance.
create table private.api_usage_counters (
 scope text not null, scope_id uuid not null, operation text not null,
 window_start timestamptz not null, period text not null, used integer not null,
 primary key(scope,scope_id,operation,window_start,period)
);
create table private.api_request_leases (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 customer_id uuid not null, operation text not null,
 expires_at timestamptz not null default now()+interval '10 minutes', released_at timestamptz
);
create index api_active_leases on private.api_request_leases(customer_id,operation,expires_at) where released_at is null;
create index api_user_active_leases on private.api_request_leases(user_id,operation,expires_at) where released_at is null;
alter table private.api_usage_counters enable row level security;
alter table private.api_request_leases enable row level security;
revoke all on private.api_usage_counters,private.api_request_leases from public,anon,authenticated,service_role;
create function public.acquire_api_request(target_customer_id uuid, operation_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text:=operation_name; t timestamptz:=now(); spec integer[];
 scope_name text; scope_uuid uuid; period_name text; starts timestamptz; ends timestamptz;
 budget integer; consumed integer; concurrent_limit integer; active integer; lease_id uuid;
begin
 if uid is null or not private.is_customer_member(target_customer_id) then raise exception using errcode='42501', message='Workspace access required'; end if;
 -- user hourly/daily, workspace hourly/daily, concurrent per user AND workspace.
 spec:=case op when 'chat' then array[30,100,120,400,2]
  when 'check' then array[6,20,12,40,1]
  when 'upload' then array[20,60,60,180,2]
  when 'calculate' then array[60,200,240,800,4] end;
 if spec is null then raise exception 'Unsupported operation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cante-api-user:'||uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('cante-api-workspace:'||target_customer_id::text,0));
 concurrent_limit:=spec[5];
 foreach scope_name in array array['user','workspace'] loop
  scope_uuid:=case when scope_name='user' then uid else target_customer_id end;
  select count(*) into active from private.api_request_leases l where l.operation=op and l.released_at is null and l.expires_at>t
   and (case when scope_name='user' then l.user_id=uid else l.customer_id=target_customer_id end);
  if active>=concurrent_limit then return jsonb_build_object('allowed',false,'retryAfter',600,'reason','Too many operations are already running.'); end if;
  foreach period_name in array array['hour','day'] loop
   starts:=date_trunc(period_name,t at time zone 'UTC') at time zone 'UTC';
   ends:=starts+case when period_name='hour' then interval '1 hour' else interval '1 day' end;
   budget:=spec[case when scope_name='user' then 0 else 2 end + case when period_name='hour' then 1 else 2 end];
   select c.used into consumed from private.api_usage_counters c where c.scope=scope_name and c.scope_id=scope_uuid and c.operation=op and c.window_start=starts and c.period=period_name;
   if coalesce(consumed,0)>=budget then return jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from ends-t))),'reason','The request budget for this account or workspace has been reached.'); end if;
  end loop;
 end loop;
 foreach scope_name in array array['user','workspace'] loop
  scope_uuid:=case when scope_name='user' then uid else target_customer_id end;
  foreach period_name in array array['hour','day'] loop
   starts:=date_trunc(period_name,t at time zone 'UTC') at time zone 'UTC';
   insert into private.api_usage_counters(scope,scope_id,operation,window_start,period,used) values(scope_name,scope_uuid,op,starts,period_name,1)
    on conflict(scope,scope_id,operation,window_start,period) do update set used=private.api_usage_counters.used+1;
  end loop;
 end loop;
 insert into private.api_request_leases(user_id,customer_id,operation) values(uid,target_customer_id,op) returning id into lease_id;
 -- Only bounded recent counters/leases are retained. No customer evidence is deleted.
 delete from private.api_request_leases where expires_at<t-interval '1 day';
 delete from private.api_usage_counters where window_start<t-interval '2 days';
 return jsonb_build_object('allowed',true,'leaseId',lease_id);
end;$$;
create function public.release_api_request(lease_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
 update private.api_request_leases set released_at=now() where id=lease_id and user_id=auth.uid() and released_at is null;
end;$$;
revoke all on function public.acquire_api_request(uuid,text),public.release_api_request(uuid) from public,anon,authenticated,service_role;
grant execute on function public.acquire_api_request(uuid,text),public.release_api_request(uuid) to authenticated;

-- Bound direct archive writes too: Data API clients must not bypass HTTP quotas.
create table private.tariff_archive_storage (
 customer_id uuid not null, storage_day date not null,
 bytes bigint not null default 0, rows integer not null default 0,
 primary key(customer_id,storage_day)
);
alter table private.tariff_archive_storage enable row level security;
revoke all on private.tariff_archive_storage from public,anon,authenticated,service_role;
create function private.enforce_tariff_archive_budget() returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint; row_count bigint;
begin
 -- Include input, event/report, source bodies and metadata; budget logical bytes,
 -- conservatively charging duplicates only when they actually insert a row.
 n:=octet_length(to_jsonb(new)::text);
 insert into private.tariff_archive_storage(customer_id,storage_day,bytes,rows)
 values(new.customer_id,date '0001-01-01',n,1)
 on conflict(customer_id,storage_day) do update set bytes=private.tariff_archive_storage.bytes+n,rows=private.tariff_archive_storage.rows+1
 returning bytes into row_count;
 if row_count>1024*1024*1024 then raise exception using errcode='54000',message='Workspace archive storage budget reached'; end if;
 insert into private.tariff_archive_storage(customer_id,storage_day,bytes,rows)
 values(new.customer_id,(now() at time zone 'UTC')::date,n,1)
 on conflict(customer_id,storage_day) do update set bytes=private.tariff_archive_storage.bytes+n,rows=private.tariff_archive_storage.rows+1
 returning bytes,rows into n,row_count;
 if n>256*1024*1024 or row_count>5000 then raise exception using errcode='54000',message='Workspace daily archive storage budget reached'; end if;
 return new;
end;$$;
revoke all on function private.enforce_tariff_archive_budget() from public,anon,authenticated,service_role;
create trigger archive_input_budget after insert on public.tariff_check_records for each row execute function private.enforce_tariff_archive_budget();
create trigger archive_event_budget after insert on public.tariff_check_events for each row execute function private.enforce_tariff_archive_budget();
create trigger archive_source_budget after insert on public.tariff_source_versions for each row execute function private.enforce_tariff_archive_budget();

insert into private.tariff_archive_storage(customer_id,storage_day,bytes,rows)
select customer_id,date '0001-01-01',sum(n),count(*) from (
 select customer_id,octet_length(to_jsonb(r)::text) n from public.tariff_check_records r
 union all select customer_id,octet_length(to_jsonb(r)::text) from public.tariff_check_events r
 union all select customer_id,octet_length(to_jsonb(r)::text) from public.tariff_source_versions r
) archived group by customer_id;
