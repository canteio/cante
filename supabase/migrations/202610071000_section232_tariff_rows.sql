-- Section 232 tariff rate facts, versioned by the Federal Register
-- Presidential Proclamation document number that published them.
--
-- Separate from lib/tariff/section232.ts's calculation LOGIC on purpose:
-- this table holds only DATA (HTS prefix, rate, annex, citation), written
-- by an automated extraction pipeline (scripts/ingest-section232-proclamation.ts)
-- with NO human approval gate -- see that script's module doc for why this
-- is safe to auto-apply where rewriting calculation code is not. A new
-- proclamation's rows are inserted under its own document_number; the
-- calculation code reads the latest revision at query time. Nothing is
-- ever overwritten in place, so a bad extraction is a row-level issue, not
-- data loss.
create table public.section232_tariff_rows (
  id uuid primary key default gen_random_uuid(),
  source_document_number text not null,
  source_title text not null,
  source_publication_date date not null,
  source_pdf_url text not null,
  annex text not null,
  annex_label text not null,
  hts_prefix text not null,
  description text not null,
  rate_percent numeric(5,2) not null check (rate_percent >= 0 and rate_percent <= 100),
  uk_rate_percent numeric(5,2) check (uk_rate_percent is null or (uk_rate_percent >= 0 and uk_rate_percent <= 100)),
  us_content_rate_percent numeric(5,2) check (us_content_rate_percent is null or (us_content_rate_percent >= 0 and us_content_rate_percent <= 100)),
  content_hash text not null,
  published_at timestamptz not null default now(),
  unique (source_document_number, annex, hts_prefix)
);

create index section232_tariff_rows_prefix_idx on public.section232_tariff_rows(hts_prefix);
create index section232_tariff_rows_document_idx on public.section232_tariff_rows(source_document_number, published_at desc);

-- Global reference data (a real published Presidential Proclamation), not
-- tenant data -- same posture as hts_schedule_embeddings: readable by
-- anyone, writable only by the service role running the ingestion script.
revoke all on public.section232_tariff_rows from public, anon, authenticated;
grant select on public.section232_tariff_rows to anon, authenticated;
grant all on public.section232_tariff_rows to service_role;

-- The latest fully-published revision's rows, resolved without the caller
-- needing to know the current document_number. "Latest" is defined by
-- published_at, matching how the ingestion script orders its own
-- prior-revision sanity check.
create or replace function public.current_section232_rate(target_hts_prefix text)
returns table (
  annex text, rate_percent numeric, uk_rate_percent numeric,
  us_content_rate_percent numeric, source_document_number text,
  source_title text, source_pdf_url text
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select source_document_number from public.section232_tariff_rows
    order by published_at desc limit 1
  )
  select r.annex, r.rate_percent, r.uk_rate_percent, r.us_content_rate_percent,
    r.source_document_number, r.source_title, r.source_pdf_url
  from public.section232_tariff_rows r, latest
  where r.source_document_number = latest.source_document_number
    and target_hts_prefix like r.hts_prefix || '%'
  order by length(r.hts_prefix) desc
  limit 1;
$$;
revoke all on function public.current_section232_rate(text) from public;
grant execute on function public.current_section232_rate(text) to anon, authenticated, service_role;
