-- Keep unchanged vectors in PostgreSQL; avoid round-tripping and reindexing them.
begin;
create or replace function public.publish_hts_chapter(target_chapter text, target_revision text, leaf_rows jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  set local statement_timeout = '120s';
  if target_chapter !~ '^(0[1-9]|[1-9][0-9])$' or nullif(target_revision, '') is null
    or jsonb_typeof(leaf_rows) <> 'array' then
    raise exception 'Invalid HTS chapter publication';
  end if;
  if jsonb_array_length(leaf_rows) = 0 and target_chapter <> '77' then
    raise exception 'Empty non-reserved HTS chapter';
  end if;
  if exists (select 1 from jsonb_array_elements(leaf_rows) r
    where r->>'chapter' is distinct from target_chapter
       or left(r->>'hts_code', 2) is distinct from target_chapter) then
    raise exception 'Chapter mismatch';
  end if;
  perform pg_advisory_xact_lock(71007, target_chapter::integer);
  if exists (select 1 from jsonb_array_elements(leaf_rows) r
    left join public.hts_schedule_embeddings h on h.hts_code = r->>'hts_code'
    where (h.hts_code is null or h.description_hash is distinct from r->>'description_hash') and nullif(r->>'embedding','') is null) then
    raise exception 'New or changed descriptions require an embedding';
  end if;
  -- Update only rate/revision metadata for identical descriptions.
  update public.hts_schedule_embeddings h set
    general=r->>'general', special=r->>'special', other=r->>'other',
    additional_duties=r->>'additional_duties', units=array(select jsonb_array_elements_text(r->'units')),
    hts_revision=target_revision, updated_at=now()
  from jsonb_array_elements(leaf_rows) r
  where h.hts_code=r->>'hts_code' and h.description_hash=r->>'description_hash';
  insert into public.hts_schedule_embeddings
    (hts_code, chapter, full_description, description_hash, general, special, other,
     additional_duties, units, hts_revision, embedding, updated_at)
  select r->>'hts_code', target_chapter, r->>'full_description', r->>'description_hash',
    r->>'general', r->>'special', r->>'other', r->>'additional_duties',
    array(select jsonb_array_elements_text(r->'units')), target_revision,
    (r->>'embedding')::extensions.vector(384), now()
  from jsonb_array_elements(leaf_rows) r
  left join public.hts_schedule_embeddings h on h.hts_code=r->>'hts_code'
  where h.hts_code is null or h.description_hash is distinct from r->>'description_hash'
  on conflict (hts_code) do update set
    full_description = excluded.full_description, description_hash = excluded.description_hash,
    general = excluded.general, special = excluded.special, other = excluded.other,
    additional_duties = excluded.additional_duties, units = excluded.units,
    hts_revision = excluded.hts_revision, embedding = excluded.embedding, updated_at = excluded.updated_at;
  delete from public.hts_schedule_embeddings h where h.chapter = target_chapter
    and h.hts_code not in (select r->>'hts_code' from jsonb_array_elements(leaf_rows) r);
  insert into public.hts_chapter_publications(chapter, revision, published_at)
  values (target_chapter, target_revision, now())
  on conflict (chapter) do update set revision = excluded.revision, published_at = excluded.published_at;
end;
$$;

commit;
