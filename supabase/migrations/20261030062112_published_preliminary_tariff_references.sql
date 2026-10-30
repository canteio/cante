-- These observed USITC preliminary publications are dated reference evidence,
-- never approved legal rules. Unknown preliminary names remain excluded.
-- No grants, RLS, reviewer authority, tenant data or schedules are changed.
begin;
alter table public.tariff_reference_releases
 drop constraint tariff_reference_releases_name_check;
alter table public.tariff_reference_releases
 add constraint tariff_reference_releases_name_check check (
  name ~ '^[0-9]{4}(HTS[A-Za-z0-9_]*|BasicEdition)$'
  and (lower(name) not like '%prelim%' or name in (
   '2021HTSAPreliminary', '2021HTSAPrelimRev1', '2021HTSAPrelimRev2',
   '2021HTSAPrelimRev3', '2022HTSAPrelimC'
  ))
 );
alter table public.tariff_reference_releases
 add constraint tariff_preliminary_reference_year_check check (
  lower(name) not like '%prelim%'
  or available_from >= (substring(name from 1 for 4) || '-01-01')::date
 );
comment on constraint tariff_preliminary_reference_year_check
 on public.tariff_reference_releases is
 'Conservative comparison window only. Preserve actual publisher dates in original registry/source metadata; this does not establish legal effective dates.';
commit;
