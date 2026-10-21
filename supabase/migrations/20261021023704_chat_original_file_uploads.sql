-- Originals are immutable workspace inputs, uploaded in <=1 MiB chunks so hosted
-- request-body limits never require putting a 15 MiB file in chat JSON.
create table public.chat_file_uploads (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(),
 filename text not null check(length(filename) between 1 and 160),
 size_bytes integer not null check(size_bytes between 1 and 15728640),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 unique(id,customer_id)
);
create table public.chat_file_chunks (
 upload_id uuid not null, customer_id uuid not null, part integer not null check(part between 0 and 14),
 body text not null check(length(body)<=1398104 and body ~ '^[A-Za-z0-9+/]*={0,2}$'),
 primary key(upload_id,part),
 foreign key(upload_id,customer_id) references public.chat_file_uploads(id,customer_id)
);
alter table public.chat_file_uploads enable row level security;
alter table public.chat_file_chunks enable row level security;
revoke all on public.chat_file_uploads,public.chat_file_chunks from public,anon,authenticated,service_role;
grant select on public.chat_file_uploads,public.chat_file_chunks to authenticated;
grant insert(id,customer_id,filename,size_bytes,sha256) on public.chat_file_uploads to authenticated;
grant insert(upload_id,customer_id,part,body) on public.chat_file_chunks to authenticated;
create policy read_chat_uploads on public.chat_file_uploads for select to authenticated using(private.is_customer_member(customer_id));
create policy insert_chat_uploads on public.chat_file_uploads for insert to authenticated with check(actor_id=auth.uid() and private.has_customer_role(customer_id,array['owner','admin','member']));
create policy read_chat_chunks on public.chat_file_chunks for select to authenticated using(private.is_customer_member(customer_id));
create policy insert_chat_chunks on public.chat_file_chunks for insert to authenticated with check(private.has_customer_role(customer_id,array['owner','admin','member']) and exists(select 1 from public.chat_file_uploads u where u.id=upload_id and u.customer_id=chat_file_chunks.customer_id and u.actor_id=auth.uid()));
create function private.validate_chat_file_chunk() returns trigger language plpgsql security invoker set search_path='' as $$
declare bytes integer; total integer; expected integer;
begin
 select size_bytes into total from public.chat_file_uploads where id=new.upload_id and customer_id=new.customer_id;
 if total is null then raise exception 'Upload not found'; end if;
 if octet_length(new.body)>1398104 then raise exception 'Chunk exceeds byte limit'; end if;
 expected:=least(1048576,total-new.part*1048576);
 bytes:=octet_length(decode(new.body,'base64'));
 if expected<=0 or bytes<>expected then raise exception 'Invalid chunk size or index'; end if;
 return new;
end;$$;
revoke all on function private.validate_chat_file_chunk() from public,anon,authenticated,service_role;
create trigger validate_chat_chunk before insert on public.chat_file_chunks for each row execute function private.validate_chat_file_chunk();
create trigger immutable_chat_upload before update or delete on public.chat_file_uploads for each row execute function private.prevent_tariff_archive_mutation();
create trigger immutable_chat_chunk before update or delete on public.chat_file_chunks for each row execute function private.prevent_tariff_archive_mutation();
create or replace function public.acquire_api_request(target_customer_id uuid, operation_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op text:=operation_name; t timestamptz:=now(); spec integer[];
 scope_name text; scope_uuid uuid; period_name text; starts timestamptz; ends timestamptz;
 budget integer; consumed integer; concurrent_limit integer; active integer; lease_id uuid;
begin
 if uid is null or not private.is_customer_member(target_customer_id) then raise exception using errcode='42501', message='Workspace access required'; end if;
 -- user hourly/daily, workspace hourly/daily, concurrent per user AND workspace.
 spec:=case op when 'chat' then array[30,100,120,400,2]
  when 'check' then array[6,20,12,40,1]
  when 'upload_chunk' then array[400,1200,1200,3600,2]
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
create or replace function private.enforce_tariff_archive_budget() returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint; row_count bigint;
begin
 -- Include input, event/report, source bodies and metadata; budget logical bytes,
 -- conservatively charging duplicates only when they actually insert a row.
 n:=octet_length(to_jsonb(new)::text);
 if tg_table_name='chat_file_uploads' then n:=n+4*((new.size_bytes+2)/3); end if;
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

-- Reserve the full declared original (base64 logical bytes) at initiation. Exact
-- chunk sizes prevent undersized declarations from bypassing archive budgets.
create trigger chat_upload_budget after insert on public.chat_file_uploads for each row execute function private.enforce_tariff_archive_budget();
-- Canonical check inputs may exceed the old 1 MB ceiling; row/group limits remain.
alter table public.tariff_check_records drop constraint tariff_check_records_input_csv_check;
alter table public.tariff_check_records add constraint tariff_check_records_input_csv_check check(octet_length(input_csv) between 1 and 15728640);
