-- Fix two correctness gaps in the live Section 232 lookup:
-- 1. callers normalize HTS codes to digits while many ingested prefixes retain
--    dots, so normalize the stored prefix in SQL before comparing;
-- 2. select the latest accepted document effective on the requested date, not
--    simply the latest document ever published. This prevents a future-dated
--    proclamation from affecting calculations before its effective date.
drop function if exists public.current_section232_rate(text);
create function public.current_section232_rate(
  target_hts_prefix text,
  target_effective_date date default current_date
)
returns table (
  annex text, rate_percent numeric, uk_rate_percent numeric,
  us_content_rate_percent numeric, effective_date date,
  source_document_number text, source_title text, source_pdf_url text
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select source_document_number
    from public.section232_tariff_rows
    where status in ('approved', 'auto_approved')
      and effective_date <= target_effective_date
    order by effective_date desc, published_at desc
    limit 1
  )
  select r.annex, r.rate_percent, r.uk_rate_percent, r.us_content_rate_percent,
    r.effective_date, r.source_document_number, r.source_title, r.source_pdf_url
  from public.section232_tariff_rows r, latest
  where r.source_document_number = latest.source_document_number
    and r.status in ('approved', 'auto_approved')
    and r.effective_date is not null
    and regexp_replace(target_hts_prefix, '[^0-9]', '', 'g')
      like regexp_replace(r.hts_prefix, '[^0-9]', '', 'g') || '%'
  order by length(regexp_replace(r.hts_prefix, '[^0-9]', '', 'g')) desc
  limit 1;
$$;
revoke all on function public.current_section232_rate(text, date) from public;
grant execute on function public.current_section232_rate(text, date) to anon, authenticated, service_role;
