begin;
alter table public.tariff_source_versions drop constraint tariff_source_versions_url_check;
alter table public.tariff_source_versions add constraint tariff_source_versions_url_check check(length(url)<=2048 and url ~ '^https://(hts[.]usitc[.]gov|www[.]usitc[.]gov|www[.]federalregister[.]gov|www[.]govinfo[.]gov|content[.]govdelivery[.]com)/');
alter table public.tariff_source_versions add column compression text, add column original_sha256 text;
alter table public.tariff_source_versions add constraint tariff_source_lossless_encoding check (coalesce(((compression is null and original_sha256 is null) or (compression='gzip' and encoding='base64' and original_sha256 ~ '^[0-9a-f]{64}$' and original_sha256 is not null)),false));
grant insert(compression,original_sha256) on public.tariff_source_versions to authenticated;
create or replace function public.complete_tariff_check(target_check_id uuid, target_customer_id uuid, report_text text, sources jsonb, outcome text default 'completed')
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
     insert into public.tariff_source_versions(customer_id,url,encoding,body,compression,original_sha256) values(target_customer_id,s->>'url',coalesce(s->>'bodyEncoding','utf8'),s->>'body',s->>'compression',s->>'originalSha256') on conflict(customer_id,url,sha256) do nothing;
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

commit;
