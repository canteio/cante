begin;
-- Operator-only publication already bounds package bytes and preserves atomic
-- immutable writes. Keep the general Data API roles' existing timeout intact.
alter function public.publish_tariff_reference(jsonb,jsonb) set statement_timeout='45s';
alter function public.publish_tariff_reference_chapter(uuid,text,jsonb) set statement_timeout='45s';
commit;
