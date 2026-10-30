begin;
-- Bounded evidence packages (32 MiB source text, immutable original and one
-- terminal) can exceed the ordinary 8-second REST limit. Scope the allowance
-- to these two atomic archive writers; do not change general role timeouts.
alter function public.complete_tariff_check(uuid,uuid,text,jsonb,text) set statement_timeout='45s';
alter function public.complete_tariff_daily_check(uuid,uuid,uuid,text,jsonb,text) set statement_timeout='45s';
notify pgrst,'reload schema';
commit;
