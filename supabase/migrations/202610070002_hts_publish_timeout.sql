-- Large chapters (e.g. 84, ~1,700 leaves) can exceed the role's default
-- statement_timeout on a single bulk upsert inside publish_hts_chapter;
-- confirmed live: chapter 84 failed with "canceling statement due to
-- statement timeout" during real 01-99 ingestion. Scoped to this function's
-- own transaction only, not a role- or database-wide change.
create or replace function public.publish_hts_chapter(target_chapter text, target_revision text, leaf_rows jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  set local statement_timeout = '120s';
  if target_chapter !~ '^(0[1-9]|[1-9][0-9])$' or nullif(target_revision, '') is null
    or jsonb_typeof(leaf_rows) <> 'array' then
    raise exception 'Invalid HTS chapter publication';
  end if;
  if jsonb_array_length(leaf_rows) = 0 and target_chapter <> '77' and target_chapter <> '99' then
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
