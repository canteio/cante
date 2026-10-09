-- Official tariff reference data remains globally readable. RLS repeats the
-- existing read-only boundary; privileged ingestion uses service_role.
begin;
alter table public.hts_schedule_embeddings enable row level security;
create policy public_reference_read on public.hts_schedule_embeddings
  for select to anon, authenticated using (true);
alter table public.section232_tariff_rows enable row level security;
create policy public_reference_read on public.section232_tariff_rows
  for select to anon, authenticated using (true);
commit;
