-- Correction from v1 of this table (202610071000): that version had NO
-- approval gate -- an automated extraction wrote directly to what the
-- calculation-facing RPC treated as live data. J corrected this
-- architecture explicitly: AI discovers/interprets, code calculates,
-- official sources prove, but a HUMAN must approve an uncertain new rule
-- before it ever reaches customer-facing duty math. This migration adds
-- that gate without discarding the extraction pipeline itself (fetch,
-- classify, vision-OCR, validate all stay useful) -- it only changes what
-- happens to the output: pending review, not live, until approved.
alter table public.section232_tariff_rows
  add column status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column review_note text;

create index section232_tariff_rows_status_idx on public.section232_tariff_rows(status, source_document_number);

-- current_section232_rate() previously resolved the latest row by
-- published_at alone, with no concept of approval -- any extraction was
-- immediately "live" to this function. It now considers ONLY status =
-- 'approved' rows, and "latest" means the latest fully-APPROVED document,
-- not the latest fetched one. A pending or rejected extraction is
-- invisible to real duty calculation no matter how recent it is.
create or replace function public.current_section232_rate(target_hts_prefix text)
returns table (
  annex text, rate_percent numeric, uk_rate_percent numeric,
  us_content_rate_percent numeric, source_document_number text,
  source_title text, source_pdf_url text
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select source_document_number from public.section232_tariff_rows
    where status = 'approved'
    order by published_at desc limit 1
  )
  select r.annex, r.rate_percent, r.uk_rate_percent, r.us_content_rate_percent,
    r.source_document_number, r.source_title, r.source_pdf_url
  from public.section232_tariff_rows r, latest
  where r.source_document_number = latest.source_document_number
    and r.status = 'approved'
    and target_hts_prefix like r.hts_prefix || '%'
  order by length(r.hts_prefix) desc
  limit 1;
$$;

-- Pending proposals awaiting human review, grouped by document so an
-- admin screen can show "1 new proclamation, N proposed rows" rather than
-- a flat list of thousands of HTS codes.
create or replace function public.pending_section232_proposals()
returns table (
  source_document_number text, source_title text, source_publication_date date,
  source_pdf_url text, row_count bigint, annexes text[], first_published_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select source_document_number, source_title, source_publication_date, source_pdf_url,
    count(*), array_agg(distinct annex order by annex), min(published_at)
  from public.section232_tariff_rows
  where status = 'pending'
  group by source_document_number, source_title, source_publication_date, source_pdf_url;
$$;
revoke all on function public.pending_section232_proposals() from public;
grant execute on function public.pending_section232_proposals() to service_role, authenticated;

-- Approve or reject an entire proposed document's rows in one atomic
-- action -- matches the "approve this proclamation" admin-screen gesture
-- in the diagram, not a per-row click. reviewer and note are required so
-- every approval/rejection is attributable, same posture as human
-- classification adoption elsewhere in this codebase.
create or replace function public.review_section232_proposal(
  target_document_number text, decision text, reviewer text, note text default null
)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  updated_count integer;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected, got %', decision;
  end if;
  if reviewer is null or trim(reviewer) = '' then
    raise exception 'reviewer is required -- an approval must be attributable to a named human';
  end if;

  update public.section232_tariff_rows
  set status = decision, reviewed_by = reviewer, reviewed_at = now(), review_note = note
  where source_document_number = target_document_number and status = 'pending';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'No pending rows found for document %', target_document_number;
  end if;
  return updated_count;
end;
$$;
revoke all on function public.review_section232_proposal(text, text, text, text) from public;
grant execute on function public.review_section232_proposal(text, text, text, text) to service_role, authenticated;
