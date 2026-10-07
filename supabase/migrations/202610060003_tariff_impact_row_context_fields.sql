-- Nullable customer context; existing snapshots and constraints remain unchanged.
alter table public.tariff_impact_rows
  add column quantity numeric,
  add column chapter99_codes text,
  add column exclusion_id text,
  add column special_program_claim text;
