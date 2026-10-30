-- Select only rules relevant to this audit; unrelated approvals cannot exhaust
-- the per-run rule budget. The GIN projection avoids scanning source bodies.
begin;
create index historical_bundle_scope on public.tariff_rule_bundles using gin(definition jsonb_path_ops) where status='approved';
create function public.select_historical_rule_bundles(scopes jsonb)
returns table(id uuid) language plpgsql stable security invoker set search_path='' as $$
begin
 if jsonb_typeof(scopes)<>'array' or jsonb_array_length(scopes)>500 or octet_length(scopes::text)>100000 then raise exception 'Historical rule scope limit exceeded';end if;
 return query
 with requested as(select distinct p.hts,p.origin,p.date from jsonb_to_recordset(scopes) p(hts text,origin text,date text))
 select matched.id from (select distinct b.id,b.created_at from requested p join public.tariff_rule_bundles b
 on b.status='approved' and b.definition @> jsonb_build_object('coverage',jsonb_build_array(jsonb_build_object('hts',jsonb_build_array(p.hts),'origins',jsonb_build_array(p.origin))))
 where exists(select 1 from jsonb_array_elements(b.definition->'coverage') c where c->'hts' ? p.hts and c->'origins' ? p.origin and c->>'from'<=p.date and p.date<c->>'before')
 order by b.created_at,b.id limit 101) matched;
end;$$;
revoke all on function public.select_historical_rule_bundles(jsonb) from public,anon;
grant execute on function public.select_historical_rule_bundles(jsonb) to authenticated,service_role;
commit;
