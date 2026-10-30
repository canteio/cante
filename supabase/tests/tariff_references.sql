-- Run after historical_audits.sql's fixture setup, inside a rollback transaction.
reset role;
select set_config('cante.reference_id',gen_random_uuid()::text,true);
insert into public.tariff_reference_releases(name,description,published_on,available_from,available_until) values('2099HTSRev1','SYNTHETIC TRANSACTION FIXTURE','2099-01-01','2099-01-02','2099-02-01');
set local role service_role;
select set_config('cante.reference_id',public.publish_tariff_reference(jsonb_build_object('release_name','2099HTSRev1','kind','legal_document','url','https://www.usitc.gov/SYNTHETIC-ROLLBACK-ONLY','title','SYNTHETIC rollback test','body','YWJj','compression','none','stored_sha256','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','original_sha256','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','original_bytes',3))::text,true);
select pg_temp.audit_expect_failure($q$select public.publish_tariff_reference('{"kind":"hts_json","body":"YWJj"}','[]')$q$,'Incomplete');
select pg_temp.audit_expect_failure($q$update public.tariff_reference_sources set title='Tampered fixture' where id=current_setting('cante.reference_id')::uuid$q$);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('cante.audit_user'),true);
do $$begin if not exists(select 1 from public.tariff_reference_catalogue where id=current_setting('cante.reference_id')::uuid) then raise exception 'Authenticated reference read failed';end if;end;$$;
select pg_temp.audit_expect_failure($q$insert into public.tariff_reference_sources(kind,url,title,original_sha256,body,compression,original_bytes) values('legal_document','https://www.usitc.gov/forged','Forged',repeat('a',64),'YWJj','none',3)$q$,'permission denied');
select pg_temp.audit_expect_failure($q$select public.publish_tariff_reference('{}','[]')$q$,'permission denied');
select pg_temp.audit_expect_failure($q$select public.lookup_tariff_reference_rates('null')$q$,'limit');
select public.refresh_historical_audit_rules(current_setting('cante.audit_batch')::uuid,'{}'::uuid[],array[current_setting('cante.reference_id')::uuid]);
set local role anon;
select pg_temp.audit_expect_failure($q$select * from public.tariff_reference_sources$q$,'permission denied');
select pg_temp.audit_expect_failure($q$select * from public.tariff_reference_catalogue$q$,'permission denied');
reset role;
-- Incomplete editions are visible as incomplete; only committed chapters resolve.
set local role service_role;
select set_config('cante.schedule_id',public.publish_tariff_reference(jsonb_build_object('release_name','2099HTSRev1','kind','hts_json','url','https://www.usitc.gov/SYNTHETIC-SCHEDULE-ROLLBACK-ONLY','title','SYNTHETIC chapter fixture','body','YWJj','compression','none','stored_sha256','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','original_sha256','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad','original_bytes',3,'metadata','{"expectedRateCount":10000}'::jsonb))::text,true);
select set_config('cante.chapter_rows','[{"hts":"0101210010","description":"SYNTHETIC","general":"5%","special":"","column2":"20%","additional_duties":"","units":[],"footnotes":[]}]',true);
select public.publish_tariff_reference_chapter(current_setting('cante.schedule_id')::uuid,'01',current_setting('cante.chapter_rows')::jsonb);
select public.publish_tariff_reference_chapter(current_setting('cante.schedule_id')::uuid,'01',current_setting('cante.chapter_rows')::jsonb);
select pg_temp.audit_expect_failure($q$select public.publish_tariff_reference_chapter(current_setting('cante.schedule_id')::uuid,'01',replace(current_setting('cante.chapter_rows'),'5%','6%')::jsonb)$q$,'differs');
select pg_temp.audit_expect_failure($q$select public.publish_tariff_reference_chapter(current_setting('cante.schedule_id')::uuid,'02','[{"hts":"0201210010","description":"SYNTHETIC","general":"5%","special":"","column2":"20%","additional_duties":"","units":[],"footnotes":[]},{"hts":"0201210020"}]')$q$);
do $$begin
 if exists(select 1 from public.tariff_reference_rates where source_id=current_setting('cante.schedule_id')::uuid and hts like '02%') then raise exception 'Partial chapter published';end if;
 if (select projection_complete from public.tariff_reference_catalogue where id=current_setting('cante.schedule_id')::uuid) is distinct from false then raise exception 'Incomplete edition marked complete';end if;
 if (select count(*) from public.tariff_reference_publications where source_id=current_setting('cante.schedule_id')::uuid)<>1 then raise exception 'Resume duplicated chapter';end if;
end;$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('cante.audit_user'),true);
do $$begin if (select count(*) from public.lookup_tariff_reference_rates(jsonb_build_array(jsonb_build_object('source_id',current_setting('cante.schedule_id'),'hts','0101210010'))))<>1 then raise exception 'Committed exact-code lookup failed';end if;end;$$;
select pg_temp.audit_expect_failure($q$select public.publish_tariff_reference_chapter(current_setting('cante.schedule_id')::uuid,'77','[]')$q$,'permission denied');
reset role;
-- Approved rule selection is scoped to exact code/origin/date and stays RLS-bound.
insert into public.tariff_rule_bundles(definition,sources,actor_id,status,approved_by,approved_at,review_note)
values('{"synthetic":false,"title":"SYNTHETIC SQL scope fixture only","coverage":[{"hts":["8501314000"],"origins":["CN"],"from":"2024-01-01","before":"2024-06-01"}]}','[{"id":"ROLLBACK-ONLY"}]',current_setting('cante.audit_reviewer')::uuid,'approved',current_setting('cante.audit_reviewer')::uuid,now(),'SYNTHETIC rollback test, not legal approval');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('cante.audit_user'),true);
do $$begin
 if (select count(*) from public.select_historical_rule_bundles('[{"hts":"8501314000","origin":"CN","date":"2024-05-31"},{"hts":"8501314000","origin":"CN","date":"2024-05-15"}]'))<>1 then raise exception 'Historical scope selection failed';end if;
 if exists(select 1 from public.select_historical_rule_bundles('[{"hts":"8501314000","origin":"VN","date":"2024-05-31"},{"hts":"8501314000","origin":"CN","date":"2024-06-01"}]')) then raise exception 'Unrelated rule scope selected';end if;
end;$$;
set local role anon;
select pg_temp.audit_expect_failure($q$select public.select_historical_rule_bundles('[]')$q$,'permission denied');
reset role;
