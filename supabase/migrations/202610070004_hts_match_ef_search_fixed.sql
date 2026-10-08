-- The HNSW index's default ef_search under-recalls on this table: confirmed
-- live that HTS 3916.90.30.00 (similarity 0.4396 by exact cosine) was
-- missing from match_hts_schedule's own top-30 results even though its
-- similarity beat several codes the function DID return (down to 0.4347).
-- Increasing ef_search widens the search beam at query time, trading a
-- little latency for correct recall -- the table is only ~20k rows, so this
-- is cheap.
--
-- `SET LOCAL` is not permitted inside a `stable` function (confirmed live:
-- "SET is not allowed in a non-volatile function"), so this drops the
-- `stable` marker. The function has no side effects and always returns the
-- same answer for the same inputs/table state, so volatile only costs the
-- query planner some caching -- irrelevant for a function called directly,
-- not inlined into a larger query.
drop function if exists public.match_hts_schedule(extensions.vector, text, integer);
create function public.match_hts_schedule(
  query_embedding extensions.vector(384), target_revision text, match_count integer default 30
)
returns table (hts_code text, full_description text, general text, units text[], similarity double precision)
language plpgsql security invoker set search_path = '' as $$
begin
  set local hnsw.ef_search = 200;
  return query
    select h.hts_code, h.full_description, h.general, h.units,
      1 - (h.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
    from public.hts_schedule_embeddings h
    where h.hts_revision = target_revision
    order by h.embedding OPERATOR(extensions.<=>) query_embedding
    limit least(greatest(match_count, 1), 30);
end;
$$;
revoke all on function public.match_hts_schedule(extensions.vector, text, integer) from public;
grant execute on function public.match_hts_schedule(extensions.vector, text, integer) to anon, authenticated, service_role;
