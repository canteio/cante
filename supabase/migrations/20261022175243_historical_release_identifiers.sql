-- Preserve the publisher's real historical identities (HTSA, Revision4_1,
-- BasicRev1B and correction suffixes), never relabel them as modern HTS ids.
begin;
alter table public.tariff_reference_releases drop constraint tariff_reference_releases_name_check;
alter table public.tariff_reference_releases add constraint tariff_reference_releases_name_check
 check(name ~ '^[0-9]{4}(HTS[A-Za-z0-9_]*|BasicEdition)$' and lower(name) not like '%prelim%');
commit;
