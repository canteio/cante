begin;
-- Public government evidence only. Customer uploads remain in their existing
-- tenant store. Large originals should not inflate database rows/base64 payloads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('official-tariff-references','official-tariff-references',false,25000000,array['application/octet-stream'])
on conflict(id) do nothing;
create policy official_tariff_reference_read on storage.objects for select to authenticated
using(bucket_id='official-tariff-references');
-- Restrictive policies also protect this bucket if another broad write policy
-- is introduced later. Only the trusted operator/service can publish originals.
create policy official_tariff_reference_no_member_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'official-tariff-references');
create policy official_tariff_reference_no_member_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'official-tariff-references') with check(bucket_id<>'official-tariff-references');
create policy official_tariff_reference_no_member_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'official-tariff-references');
commit;
