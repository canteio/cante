-- Confidence-gated auto-activation (J's correction of the blanket-human-
-- approval design): most new trade-remedy documents should activate
-- automatically when Cante can independently establish every piece that
-- actually determines the dollar amount -- HTS scope, country scope, rate,
-- effective date, and (for Section 232) the Chapter 99 heading. Only the
-- genuinely ambiguous ~5-10% -- conflicting with an existing rule,
-- unclear exceptions, an extraction the verification pass can't confirm --
-- should wait for a human. "Human review" stays available for that
-- minority, it is no longer the default path for every document.
alter table public.section232_tariff_rows
  drop constraint section232_tariff_rows_status_check,
  add constraint section232_tariff_rows_status_check
    check (status in ('pending', 'auto_approved', 'approved', 'rejected'));

alter table public.section232_tariff_rows
  add column effective_date date,
  add column verification_pass boolean,
  add column verification_notes text;

comment on column public.section232_tariff_rows.verification_pass is
  'Result of an INDEPENDENT second extraction pass over the same source text, run without seeing the first pass''s output, whose only job is to find contradictions or unsupported fields -- never shown the first pass''s structured result up front. true = the second pass corroborates the first pass''s rate/annex/effective-date facts with no contradiction. null = verification not yet run.';

-- current_section232_rate() must treat 'auto_approved' exactly like
-- 'approved' -- both are live, customer-facing data. 'pending' (awaiting a
-- human) and 'rejected' are not.
create or replace function public.current_section232_rate(target_hts_prefix text)
returns table (
  annex text, rate_percent numeric, uk_rate_percent numeric,
  us_content_rate_percent numeric, source_document_number text,
  source_title text, source_pdf_url text
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select source_document_number from public.section232_tariff_rows
    where status in ('approved', 'auto_approved')
    order by published_at desc limit 1
  )
  select r.annex, r.rate_percent, r.uk_rate_percent, r.us_content_rate_percent,
    r.source_document_number, r.source_title, r.source_pdf_url
  from public.section232_tariff_rows r, latest
  where r.source_document_number = latest.source_document_number
    and r.status in ('approved', 'auto_approved')
    and target_hts_prefix like r.hts_prefix || '%'
  order by length(r.hts_prefix) desc
  limit 1;
$$;

-- Atomically flip an entire document's rows to 'auto_approved' -- called
-- ONLY by the verification pipeline, never by the extraction script
-- itself, and only after verification_pass = true for every row.
create or replace function public.auto_approve_section232_proposal(
  target_document_number text, note text
)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  updated_count integer;
  unverified_count integer;
begin
  select count(*) into unverified_count
  from public.section232_tariff_rows
  where source_document_number = target_document_number
    and status = 'pending'
    and (verification_pass is distinct from true);

  if unverified_count > 0 then
    raise exception '% row(s) for document % are not verified (verification_pass is not true) -- cannot auto-approve', unverified_count, target_document_number;
  end if;

  update public.section232_tariff_rows
  set status = 'auto_approved', reviewed_by = 'auto-verification-pipeline', reviewed_at = now(), review_note = note
  where source_document_number = target_document_number and status = 'pending';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'No pending verified rows found for document %', target_document_number;
  end if;
  return updated_count;
end;
$$;
revoke all on function public.auto_approve_section232_proposal(text, text) from public;
grant execute on function public.auto_approve_section232_proposal(text, text) to service_role;

-- Pending proposals now distinguish "ready, just needs a confidence check"
-- from "verification already ran and found a real issue" so an admin
-- screen can prioritize the latter. Return type changed from the original
-- definition, so the function must be dropped first -- Postgres rejects
-- `create or replace` across an OUT-parameter signature change.
drop function if exists public.pending_section232_proposals();
create function public.pending_section232_proposals()
returns table (
  source_document_number text, source_title text, source_publication_date date,
  source_pdf_url text, row_count bigint, annexes text[], first_published_at timestamptz,
  verification_pass boolean, verification_notes text
)
language sql stable security invoker set search_path = '' as $$
  select source_document_number, source_title, source_publication_date, source_pdf_url,
    count(*), array_agg(distinct annex order by annex), min(published_at),
    bool_and(coalesce(verification_pass, false)), string_agg(distinct verification_notes, ' | ')
  from public.section232_tariff_rows
  where status = 'pending'
  group by source_document_number, source_title, source_publication_date, source_pdf_url;
$$;
revoke all on function public.pending_section232_proposals() from public;
grant execute on function public.pending_section232_proposals() to service_role, authenticated;
