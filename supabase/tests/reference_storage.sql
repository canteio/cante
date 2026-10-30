begin;
-- Metadata-only government-reference fixture; rolled back, no customer data.
insert into storage.objects(bucket_id,name,metadata)
values('official-tariff-references','SYNTHETIC-ROLLBACK-STORAGE-TEST.bin','{"label":"SYNTHETIC"}');
set local role authenticated;
do $$declare n integer;begin
 select count(*) into n from storage.objects where bucket_id='official-tariff-references' and name='SYNTHETIC-ROLLBACK-STORAGE-TEST.bin';
 if n<>1 then raise exception 'Authenticated official-evidence read failed';end if;
 begin
  insert into storage.objects(bucket_id,name) values('official-tariff-references','SYNTHETIC-ILLEGAL-WRITE.bin');
  raise exception 'Member published a shared original';
 exception when insufficient_privilege then null;end;
 update storage.objects set metadata='{}' where bucket_id='official-tariff-references' and name='SYNTHETIC-ROLLBACK-STORAGE-TEST.bin';
 get diagnostics n=row_count;if n<>0 then raise exception 'Member changed a shared original';end if;
 begin
  delete from storage.objects where bucket_id='official-tariff-references' and name='SYNTHETIC-ROLLBACK-STORAGE-TEST.bin';
  get diagnostics n=row_count;if n<>0 then raise exception 'Member deleted a shared original';end if;
 exception when insufficient_privilege then null;end;
end;$$;
reset role;
set local role anon;
do $$declare n integer;begin
 select count(*) into n from storage.objects where bucket_id='official-tariff-references' and name='SYNTHETIC-ROLLBACK-STORAGE-TEST.bin';
 if n<>0 then raise exception 'Anonymous official-evidence read unexpectedly allowed';end if;
end;$$;
reset role;
select 'PASS: authenticated read, member mutation denial, anonymous denial; fixture rolled back' as result;
rollback;
