-- Public reference data, deliberately global and without tenant RLS.
create table public.hts_schedule_embeddings (
  hts_code text primary key,
  chapter text not null check (chapter ~ '^(0[1-9]|[1-9][0-9])$'),
  full_description text not null,
  description_hash text not null,
  general text not null,
  special text not null,
  other text not null,
  additional_duties text not null,
  units text[] not null default '{}',
  hts_revision text not null,
  embedding extensions.vector(384) not null,
  updated_at timestamptz not null default now()
);
create index hts_schedule_embeddings_hnsw_idx on public.hts_schedule_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);
create index hts_schedule_embeddings_chapter_idx on public.hts_schedule_embeddings(chapter);
revoke all on public.hts_schedule_embeddings from public, anon, authenticated;
grant select on public.hts_schedule_embeddings to anon, authenticated;
grant all on public.hts_schedule_embeddings to service_role;

create function public.match_hts_schedule(
  query_embedding extensions.vector(384), target_revision text, match_count integer default 30
)
returns table (hts_code text, full_description text, general text, units text[], similarity double precision)
language sql stable security invoker set search_path = '' as $$
  select h.hts_code, h.full_description, h.general, h.units,
    1 - (h.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.hts_schedule_embeddings h
  where h.hts_revision = target_revision
  order by h.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 30);
$$;
revoke all on function public.match_hts_schedule(extensions.vector, text, integer) from public;
grant execute on function public.match_hts_schedule(extensions.vector, text, integer) to anon, authenticated, service_role;

-- Publish a complete chapter atomically; failed chapters retain their previous
-- snapshot. Search filters by currentRelease, excluding those stale snapshots.
create function public.publish_hts_chapter(target_chapter text, target_revision text, leaf_rows jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
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
  insert into public.hts_schedule_embeddings
    (hts_code, chapter, full_description, description_hash, general, special, other,
     additional_duties, units, hts_revision, embedding, updated_at)
  select r->>'hts_code', target_chapter, r->>'full_description', r->>'description_hash',
    r->>'general', r->>'special', r->>'other', r->>'additional_duties',
    array(select jsonb_array_elements_text(r->'units')), target_revision,
    (r->>'embedding')::extensions.vector(384), now()
  from jsonb_array_elements(leaf_rows) r
  on conflict (hts_code) do update set
    full_description = excluded.full_description, description_hash = excluded.description_hash,
    general = excluded.general, special = excluded.special, other = excluded.other,
    additional_duties = excluded.additional_duties, units = excluded.units,
    hts_revision = excluded.hts_revision, embedding = excluded.embedding, updated_at = excluded.updated_at;
  delete from public.hts_schedule_embeddings h where h.chapter = target_chapter
    and not exists (select 1 from jsonb_array_elements(leaf_rows) r where r->>'hts_code' = h.hts_code);
end;
$$;
revoke all on function public.publish_hts_chapter(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_hts_chapter(text, text, jsonb) to service_role;
