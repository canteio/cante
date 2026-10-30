-- Corrected migration: expression index only; no stored-column table rewrite.
-- Preserve the immutable government bytes AND independently version their parsed
-- registry projection. The same source bytes must not silently pin old parser
-- metadata forever or overwrite previous audits' source records.
-- No grants, RLS, security-definer authority, tenant data or schedules change.
begin;
-- Recovery and disk headroom were verified before applying this correction.
-- If the interrupted attempt committed, stop and inspect before using this draft.
do $$ begin
 if exists(select 1 from pg_attribute where attrelid='public.tariff_reference_sources'::regclass and attname='projection_version' and not attisdropped) then
  raise exception 'Inspect the interrupted projection migration before proceeding';
 end if;
end $$;
set local lock_timeout='2s';
set local statement_timeout='15s';
alter table public.tariff_reference_sources
 add constraint tariff_reference_projection_version_check check (
  kind<>'release_registry'
  or coalesce(metadata->>'registryProjectionVersion','original-v1') ~ '^[a-z][a-z0-9_-]{0,63}$'
 );
-- Expression index: deliberately avoid rewriting the large evidence table.
create unique index tariff_reference_source_projection_key
 on public.tariff_reference_sources(url,original_sha256,
 (case when kind='release_registry'
  then coalesce(metadata->>'registryProjectionVersion','original-v1')
  else 'original-v1' end));
alter table public.tariff_reference_sources
 drop constraint tariff_reference_sources_url_original_sha256_key;

create or replace function public.publish_tariff_reference(source jsonb,rates jsonb default '[]'::jsonb)
returns uuid language plpgsql set search_path='' set statement_timeout='45s'
as $function$
declare result uuid; n integer; expected_hash text; retained bytea; source_kind text; projection text;
begin
 if jsonb_typeof(source)<>'object' or jsonb_typeof(rates)<>'array' or octet_length(source::text)>13000000 or jsonb_array_length(rates)<>0 then raise exception 'Invalid reference package: publish rates by chapter';end if;
 source_kind:=source->>'kind';n:=coalesce((source->'metadata'->>'expectedRateCount')::integer,0);
 if (source_kind='hts_json' and (n<10000 or n>100000 or source->>'release_name' is null)) or (source_kind<>'hts_json' and n<>0) then raise exception 'Incomplete reference schedule';end if;
 retained:=decode(source->>'body','base64');expected_hash:=encode(extensions.digest(retained,'sha256'),'hex');
 if expected_hash is distinct from source->>'stored_sha256' then raise exception 'Reference stored-byte hash mismatch';end if;
 if source->>'compression'='none' and (expected_hash is distinct from source->>'original_sha256' or octet_length(retained)<>(source->>'original_bytes')::integer) then raise exception 'Reference original-byte hash mismatch';end if;
 projection:=case when source_kind='release_registry' then coalesce(source->'metadata'->>'registryProjectionVersion','original-v1') else 'original-v1' end;
 if projection !~ '^[a-z][a-z0-9_-]{0,63}$' then raise exception 'Invalid reference projection version';end if;
 perform pg_advisory_xact_lock(hashtextextended((source->>'url')||(source->>'original_sha256'),0));
 select id into result from public.tariff_reference_sources where url=source->>'url' and original_sha256=source->>'original_sha256' and (case when kind='release_registry' then coalesce(metadata->>'registryProjectionVersion','original-v1') else 'original-v1' end)=projection;
 if result is not null then
  if (select rate_count from public.tariff_reference_sources where id=result)<>n then raise exception 'Existing reference projection differs';end if;
  return result;
 end if;
 insert into public.tariff_reference_sources(release_name,kind,url,title,original_sha256,body,compression,original_bytes,metadata,rate_count)
 values(source->>'release_name',source_kind,source->>'url',source->>'title',source->>'original_sha256',source->>'body',source->>'compression',(source->>'original_bytes')::integer,coalesce(source->'metadata','{}'::jsonb),n) returning id into result;
 return result;
end;$function$;
commit;
