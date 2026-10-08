-- Expose the verified effective date with each live Section 232 rule.
-- The dashboard must not infer version boundaries from prose or a constant.
drop function if exists public.current_section232_rate(text);
create function public.current_section232_rate(target_hts_prefix text)
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
    order by published_at desc
    limit 1
  )
  select r.annex, r.rate_percent, r.uk_rate_percent, r.us_content_rate_percent,
    r.effective_date, r.source_document_number, r.source_title, r.source_pdf_url
  from public.section232_tariff_rows r, latest
  where r.source_document_number = latest.source_document_number
    and r.status in ('approved', 'auto_approved')
    and r.effective_date is not null
    and target_hts_prefix like r.hts_prefix || '%'
  order by length(r.hts_prefix) desc
  limit 1;
$$;
revoke all on function public.current_section232_rate(text) from public;
grant execute on function public.current_section232_rate(text) to anon, authenticated, service_role;
