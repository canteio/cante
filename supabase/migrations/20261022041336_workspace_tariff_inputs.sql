-- Explicit calculation inputs live with the tenant's product. Reference prices
-- are not silently promoted to customs values. Existing product RLS applies.
alter table public.products add column if not exists tariff_inputs jsonb;
alter table public.products add constraint products_tariff_inputs_bounded
  check (tariff_inputs is null or (jsonb_typeof(tariff_inputs) = 'object'
    and octet_length(tariff_inputs::text) <= 65536));
comment on column public.products.tariff_inputs is
  'User-supplied tariff facts from retained uploads; not approved rules or verified calculations.';
