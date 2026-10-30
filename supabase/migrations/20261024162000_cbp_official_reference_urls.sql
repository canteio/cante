-- CBP publishes implementation guidance and charts through its official
-- USDHSCBP GovDelivery account. This adds only those account-specific paths.
-- Existing immutable references, privileges and tenant policies are unchanged.
begin;
set local lock_timeout = '5s';
alter table public.tariff_reference_sources
 drop constraint tariff_reference_sources_url_check;
alter table public.tariff_reference_sources
 add constraint tariff_reference_sources_url_check check (
  url ~ '^https://[^/]+[.]gov/'
  or url ~ '^urn:cante:legacy:'
  or url ~ '^https://content[.]govdelivery[.]com/attachments/USDHSCBP/[0-9]{4}/[0-9]{2}/[0-9]{2}/file_attachments/[0-9]+/[^/]+[.]pdf$'
  or url ~ '^https://content[.]govdelivery[.]com/accounts/USDHSCBP/bulletins/[a-z0-9]+$'
 );
commit;
