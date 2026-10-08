-- Some annex pages print a bare grid of HTS codes grouped only under a
-- sub-heading (e.g. "(iv) Derivative steel articles:") with NO per-code
-- description at all -- confirmed live on Proclamation 11021's Annex IV.
-- The ingestion script synthesizes a placeholder description in that case
-- (so `description` stays NOT NULL, simplest for downstream readers) and
-- separately records the real sub-heading text here so a reviewer isn't
-- looking at a fabricated-looking description with no indication of why.
alter table public.section232_tariff_rows add column subheading text;
