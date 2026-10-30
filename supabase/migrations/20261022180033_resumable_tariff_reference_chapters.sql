-- Resume immutable reference projections safely, publishing one chapter atomically.
begin;
create table public.tariff_reference_publications (
 source_id uuid not null references public.tariff_reference_sources(id),
 chapter text not null check(chapter ~ '^(0[1-9]|[1-9][0-9])$'),
 rate_count integer not null check(rate_count between 0 and 8000),
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 published_at timestamptz not null default now(), primary key(source_id,chapter)
);
alter table public.tariff_reference_publications enable row level security;
revoke all on public.tariff_reference_publications from public,anon,authenticated,service_role;
grant select on public.tariff_reference_publications to authenticated,service_role;
grant insert on public.tariff_reference_publications to service_role;
create policy reference_publications_read on public.tariff_reference_publications for select to authenticated using(true);
create trigger immutable_tariff_reference_publication before update or delete on public.tariff_reference_publications for each row execute function private.prevent_tariff_archive_mutation();

-- Mark only previously complete, atomically published editions. Partial sources
-- never gain markers through this migration.
insert into public.tariff_reference_publications(source_id,chapter,rate_count,payload_sha256)
select r.source_id,left(r.hts,2),count(*)::integer,
 encode(extensions.digest(jsonb_agg(to_jsonb(r)-'source_id' order by r.hts)::text,'sha256'),'hex')
from public.tariff_reference_rates r
where r.source_id in(select s.id from public.tariff_reference_sources s join public.tariff_reference_rates x on x.source_id=s.id where s.kind='hts_json' group by s.id having count(*)=s.rate_count and count(distinct left(x.hts,2))=98)
group by r.source_id,left(r.hts,2);
insert into public.tariff_reference_publications(source_id,chapter,rate_count,payload_sha256)
select source_id,'77',0,encode(extensions.digest('[]','sha256'),'hex') from public.tariff_reference_publications group by source_id having count(*)=98;

create or replace function public.publish_tariff_reference(source jsonb,rates jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; n integer; expected_hash text; retained bytea; source_kind text;
begin
 if jsonb_typeof(source)<>'object' or jsonb_typeof(rates)<>'array' or octet_length(source::text)>13000000 or jsonb_array_length(rates)<>0 then raise exception 'Invalid reference package: publish rates by chapter';end if;
 source_kind:=source->>'kind';n:=coalesce((source->'metadata'->>'expectedRateCount')::integer,0);
 if (source_kind='hts_json' and (n<10000 or n>100000 or source->>'release_name' is null)) or (source_kind<>'hts_json' and n<>0) then raise exception 'Incomplete reference schedule';end if;
 retained:=decode(source->>'body','base64');expected_hash:=encode(extensions.digest(retained,'sha256'),'hex');
 if expected_hash is distinct from source->>'stored_sha256' then raise exception 'Reference stored-byte hash mismatch';end if;
 if source->>'compression'='none' and (expected_hash is distinct from source->>'original_sha256' or octet_length(retained)<>(source->>'original_bytes')::integer) then raise exception 'Reference original-byte hash mismatch';end if;
 perform pg_advisory_xact_lock(hashtextextended((source->>'url')||(source->>'original_sha256'),0));
 select id into result from public.tariff_reference_sources where url=source->>'url' and original_sha256=source->>'original_sha256';
 if result is not null then
  if (select rate_count from public.tariff_reference_sources where id=result)<>n then raise exception 'Existing reference projection differs';end if;
  return result;
 end if;
 insert into public.tariff_reference_sources(release_name,kind,url,title,original_sha256,body,compression,original_bytes,metadata,rate_count)
 values(source->>'release_name',source_kind,source->>'url',source->>'title',source->>'original_sha256',source->>'body',source->>'compression',(source->>'original_bytes')::integer,coalesce(source->'metadata','{}'::jsonb),n) returning id into result;
 return result;
end;$$;

create function public.publish_tariff_reference_chapter(target_source uuid,target_chapter text,chapter_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; hash text; previous public.tariff_reference_publications; ordered jsonb;
begin
 if target_chapter !~ '^(0[1-9]|[1-9][0-9])$' or jsonb_typeof(chapter_rows)<>'array' or jsonb_array_length(chapter_rows)>8000 or octet_length(chapter_rows::text)>10000000 then raise exception 'Invalid reference chapter';end if;
 n:=jsonb_array_length(chapter_rows);
 if (target_chapter='77' and n<>0) or (target_chapter<>'77' and n=0) then raise exception 'Incomplete reference chapter';end if;
 if not exists(select 1 from public.tariff_reference_sources where id=target_source and kind='hts_json') then raise exception 'Schedule source required';end if;
 if exists(select 1 from jsonb_array_elements(chapter_rows) r where (r->>'hts') is null or left(r->>'hts',2)<>target_chapter) or exists(select 1 from jsonb_array_elements(chapter_rows) r group by r->>'hts' having count(*)>1) then raise exception 'Chapter code mismatch or duplicate';end if;
 select coalesce(jsonb_agg(r order by r->>'hts'),'[]'::jsonb) into ordered from jsonb_array_elements(chapter_rows) r;
 hash:=encode(extensions.digest(ordered::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(target_source::text||target_chapter,0));
 select * into previous from public.tariff_reference_publications where source_id=target_source and chapter=target_chapter;
 if found then
  if previous.rate_count<>n or previous.payload_sha256<>hash then raise exception 'Published chapter projection differs';end if;
  return n;
 end if;
 insert into public.tariff_reference_rates(source_id,hts,description,general,special,column2,additional_duties,units,footnotes)
 select target_source,r.hts,r.description,r.general,r.special,r.column2,r.additional_duties,r.units,r.footnotes
 from jsonb_to_recordset(chapter_rows) as r(hts text,description text,general text,special text,column2 text,additional_duties text,units jsonb,footnotes jsonb);
 insert into public.tariff_reference_publications(source_id,chapter,rate_count,payload_sha256) values(target_source,target_chapter,n,hash);
 return n;
end;$$;
revoke all on function public.publish_tariff_reference_chapter(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_tariff_reference_chapter(uuid,text,jsonb) to service_role;

create or replace function public.lookup_tariff_reference_rates(pairs jsonb)
returns setof public.tariff_reference_rates language plpgsql stable security invoker set search_path='' as $$
begin
 if jsonb_typeof(pairs)<>'array' or jsonb_array_length(pairs)>500 or octet_length(pairs::text)>100000 then raise exception 'Reference lookup limit exceeded';end if;
 return query select distinct r.* from jsonb_to_recordset(pairs) as p(source_id uuid,hts text)
 join public.tariff_reference_rates r on r.source_id=p.source_id and r.hts=p.hts
 join public.tariff_reference_publications c on c.source_id=r.source_id and c.chapter=left(r.hts,2);
end;$$;

create or replace view public.tariff_reference_catalogue with(security_invoker=true) as
 select distinct on(s.kind,s.release_name,case when s.kind='legal_document' then s.url else '' end)
 s.id,s.release_name,s.kind,s.url,s.title,s.original_sha256,s.captured_at,s.metadata,s.rate_count,
 coalesce(p.chapters,0) as published_chapters,coalesce(p.rates,0) as projected_rates,
 (s.kind<>'hts_json' or (p.chapters=99 and p.rates=s.rate_count)) as projection_complete
 from public.tariff_reference_sources s left join lateral
 (select count(*) as chapters,sum(rate_count) as rates from public.tariff_reference_publications where source_id=s.id) p on true
 order by s.kind,s.release_name,case when s.kind='legal_document' then s.url else '' end,s.captured_at desc,s.id;
commit;
