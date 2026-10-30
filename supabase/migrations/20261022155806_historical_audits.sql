begin;
create table public.tariff_rule_bundles (
 id uuid primary key default gen_random_uuid(), definition jsonb not null check(jsonb_typeof(definition)='object' and octet_length(definition::text)<=1000000),
 sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 20 and octet_length(sources::text)<=12000000),
 status text not null default 'draft' check(status in ('draft','approved','rejected')),
 actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(),
 approved_by uuid, approved_at timestamptz, review_note text,
 check(status<>'approved' or (approved_by is not null and approved_at is not null and length(btrim(review_note))>=10 and definition->>'synthetic'='false'))
);
alter table public.tariff_rule_bundles enable row level security;
revoke all on public.tariff_rule_bundles from public,anon,authenticated,service_role;
grant select on public.tariff_rule_bundles to authenticated;
grant insert(definition,sources) on public.tariff_rule_bundles to authenticated;
grant select on public.tariff_rule_bundles to service_role;
create policy read_bundles on public.tariff_rule_bundles for select to authenticated using(status='approved' or public.is_platform_tariff_reviewer());
create policy draft_bundles on public.tariff_rule_bundles for insert to authenticated with check(public.is_platform_tariff_reviewer() and actor_id=auth.uid() and status='draft');
create function private.freeze_historical_bundle() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'draft' or new.definition is distinct from old.definition or new.sources is distinct from old.sources or new.id<>old.id or new.actor_id<>old.actor_id then raise exception 'Historical rule versions are immutable'; end if;
 return new;
end;$$;
revoke all on function private.freeze_historical_bundle() from public;
create trigger freeze_bundle before update or delete on public.tariff_rule_bundles for each row execute function private.freeze_historical_bundle();
create function public.review_historical_bundle(bundle_id uuid,decision text,note text,source_read boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_platform_tariff_reviewer() then raise exception using errcode='42501',message='Platform tariff reviewer required'; end if;
 if decision not in ('approved','rejected') or not coalesce(source_read,false) or length(btrim(note)) not between 10 and 3000 then raise exception 'Read the sources and record your review'; end if;
 update public.tariff_rule_bundles set status=decision,approved_by=auth.uid(),approved_at=now(),review_note=note where id=bundle_id and status='draft';
 if not found then raise exception 'Pending bundle not found'; end if;
end;$$;
revoke all on function public.review_historical_bundle(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.review_historical_bundle(uuid,text,text,boolean) to authenticated;

create table public.audit_batches (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id),
 actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(),
 filename text not null check(length(filename) between 1 and 160), upload_id uuid not null, input_run_id text not null,
 mapping jsonb not null check(jsonb_typeof(mapping)='object' and octet_length(mapping::text)<8000),
 options jsonb not null check(jsonb_typeof(options)='object' and octet_length(options::text)<2000),
 bundle_ids uuid[] not null default '{}' check(cardinality(bundle_ids)<=100),
 idempotency_key text not null check(idempotency_key ~ '^[0-9a-f]{64}$'),
 revision integer not null default 0 check(revision>=0), status text not null default 'ready' check(status in ('ready','analyzing','completed','interrupted')),
 active_run_id uuid, lease_token uuid, lease_until timestamptz, checkpoint jsonb not null default '[]' check(jsonb_typeof(checkpoint)='array' and jsonb_array_length(checkpoint)<=500 and octet_length(checkpoint::text)<=12000000),
 progress integer not null default 0 check(progress between 0 and 500), input_hash text, summary jsonb, last_error text,
 unique(id,customer_id), unique(customer_id,idempotency_key),
 foreign key(upload_id,customer_id) references public.chat_file_uploads(id,customer_id),
 foreign key(input_run_id,customer_id) references public.tariff_impact_runs(id,customer_id)
);
create index audit_batches_customer_created on public.audit_batches(customer_id,created_at desc,id);
alter table public.audit_batches enable row level security;
revoke all on public.audit_batches from public,anon,authenticated,service_role;
grant select on public.audit_batches to authenticated;
grant insert(id,customer_id,filename,upload_id,input_run_id,mapping,options,bundle_ids,idempotency_key) on public.audit_batches to authenticated;
grant select,update on public.audit_batches to service_role;
create policy read_audits on public.audit_batches for select to authenticated using(private.is_customer_member(customer_id));
create policy insert_audits on public.audit_batches for insert to authenticated with check(actor_id=auth.uid() and private.has_customer_role(customer_id,array['owner','admin','member']));
create trigger audit_batch_budget after insert on public.audit_batches for each row execute function private.enforce_tariff_archive_budget();

create table public.audit_entry_results (
 audit_id uuid not null, customer_id uuid not null, run_id uuid not null, revision integer not null,
 row_number integer not null check(row_number between 1 and 500), result_text text not null check(octet_length(result_text)<=100000),
 result_sha256 text generated always as(encode(extensions.digest(result_text,'sha256'),'hex')) stored,
 created_at timestamptz not null default now(), primary key(audit_id,run_id,row_number),
 foreign key(audit_id,customer_id) references public.audit_batches(id,customer_id)
);
alter table public.audit_entry_results enable row level security;
revoke all on public.audit_entry_results from public,anon,authenticated,service_role;
grant select on public.audit_entry_results to authenticated;
grant select,insert on public.audit_entry_results to service_role;
create policy read_results on public.audit_entry_results for select to authenticated using(private.is_customer_member(customer_id));
create trigger immutable_audit_results before update or delete on public.audit_entry_results for each row execute function private.prevent_tariff_archive_mutation();
create trigger audit_results_budget after insert on public.audit_entry_results for each row execute function private.enforce_tariff_archive_budget();

create table public.audit_review_events (
 id uuid primary key default gen_random_uuid(), audit_id uuid not null, customer_id uuid not null,
 actor_id uuid not null default auth.uid(), created_at timestamptz not null default now(), revision integer not null,
 decision jsonb not null check(jsonb_typeof(decision)='object' and octet_length(decision::text)<=12000),
 foreign key(audit_id,customer_id) references public.audit_batches(id,customer_id)
);
create index audit_review_events_order on public.audit_review_events(customer_id,audit_id,created_at,id);
alter table public.audit_review_events enable row level security;
revoke all on public.audit_review_events from public,anon,authenticated,service_role;
grant select on public.audit_review_events to authenticated,service_role;
create policy read_audit_reviews on public.audit_review_events for select to authenticated using(private.is_customer_member(customer_id));
create trigger immutable_audit_reviews before update or delete on public.audit_review_events for each row execute function private.prevent_tariff_archive_mutation();
create trigger audit_reviews_budget after insert on public.audit_review_events for each row execute function private.enforce_tariff_archive_budget();

create table public.tariff_impact_attestations (
 run_id uuid primary key, audit_id uuid not null, customer_id uuid not null, revision integer not null,
 input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'), result_sha256 text not null check(result_sha256 ~ '^[0-9a-f]{64}$'),
 engine_version text not null, bundle_ids uuid[] not null, summary jsonb not null, verified_at timestamptz not null default now(),
 foreign key(audit_id,customer_id) references public.audit_batches(id,customer_id)
);
alter table public.tariff_impact_attestations enable row level security;
revoke all on public.tariff_impact_attestations from public,anon,authenticated,service_role;
grant select on public.tariff_impact_attestations to authenticated;
grant select,insert on public.tariff_impact_attestations to service_role;
create policy read_audit_proofs on public.tariff_impact_attestations for select to authenticated using(private.is_customer_member(customer_id));
create trigger immutable_audit_proof before update or delete on public.tariff_impact_attestations for each row execute function private.prevent_tariff_archive_mutation();

create function public.record_audit_review(target_audit uuid,payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare b public.audit_batches; row_id integer; rev integer;
begin
 select * into b from public.audit_batches where id=target_audit for update;
 if b.id is null or not private.has_customer_role(b.customer_id,array['owner','admin','member']) then raise exception using errcode='42501',message='Audit write access required'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>12000 or payload->>'kind' is null or payload->>'kind' not in ('note','reviewed','resolved','confirm_facts') or coalesce(length(btrim(payload->>'note')),0) not between 10 and 2000 then raise exception 'Record a review note'; end if;
 row_id:=(payload->>'row')::integer;
 if row_id is null or row_id not between 1 and (select source_count from public.tariff_impact_runs where id=b.input_run_id and customer_id=b.customer_id) then raise exception 'Invalid entry row'; end if;
 if (payload ? 'origin' and ((payload->>'origin') !~ '^[A-Z]{2}$' or payload->'facts'->>'origin_verified' is distinct from 'true')) or (payload ? 'hts' and ((payload->>'hts') !~ '^[0-9]{10}$' or payload->'facts'->>'classification_verified' is distinct from 'true')) then raise exception 'A correction requires an explicit reviewed fact decision'; end if;
 if payload->>'kind'='confirm_facts' and (jsonb_typeof(payload->'evidence') is distinct from 'array' or jsonb_array_length(payload->'evidence')<1 or (payload->>'validFrom')::date is null or (payload->>'validBefore')::date is null or (payload->>'validBefore')::date<=(payload->>'validFrom')::date) then raise exception 'Evidence and a valid date interval are required'; end if;
 if payload->>'kind' in ('reviewed','resolved') and not exists(select 1 from public.tariff_impact_attestations a where a.audit_id=b.id and a.customer_id=b.customer_id and a.run_id=b.active_run_id and a.revision=b.revision) then raise exception 'Run this revision before reviewing its results'; end if;
 if payload->>'kind'='resolved' and not exists(select 1 from public.audit_entry_results r where r.audit_id=b.id and r.run_id=b.active_run_id and r.row_number=row_id and r.result_text::jsonb->'result'->>'expected' is not null) then raise exception 'Missing calculations cannot be marked resolved'; end if;
 rev:=b.revision+case when payload->>'kind'='confirm_facts' then 1 else 0 end;
 insert into public.audit_review_events(audit_id,customer_id,revision,decision) values(b.id,b.customer_id,rev,payload);
 if payload->>'kind'='confirm_facts' then update public.audit_batches set revision=rev,status='ready',active_run_id=null,lease_token=null,lease_until=null,checkpoint='[]',progress=0,input_hash=null,summary=null,last_error=null where id=b.id; end if;
end;$$;
revoke all on function public.record_audit_review(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_audit_review(uuid,jsonb) to authenticated;

create function public.claim_historical_audit(target_audit uuid,target_customer uuid,expected_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.audit_batches; token uuid:=gen_random_uuid();
begin
 select * into b from public.audit_batches where id=target_audit and customer_id=target_customer for update;
 if b.id is null or b.revision<>expected_revision or b.status='completed' or (b.status='analyzing' and b.lease_until>now()) then raise exception 'Audit is complete, changed or already running'; end if;
 update public.audit_batches set status='analyzing',lease_token=token,lease_until=now()+interval '5 minutes',active_run_id=coalesce(active_run_id,gen_random_uuid()),last_error=null where id=b.id returning * into b;
 return to_jsonb(b);
end;$$;
revoke all on function public.claim_historical_audit(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_historical_audit(uuid,uuid,integer) to service_role;

create function public.finish_historical_audit(target_audit uuid,target_customer uuid,token uuid,expected_revision integer,result_lines jsonb,summary_data jsonb,input_fingerprint text,engine text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare b public.audit_batches; n integer; item jsonb; row_index integer:=0; result_hash text;
begin
 select * into b from public.audit_batches where id=target_audit and customer_id=target_customer for update;
 if b.id is null or b.status<>'analyzing' or b.lease_token is distinct from token or b.revision<>expected_revision or b.lease_until<now() then raise exception 'Audit execution lease expired or inputs changed'; end if;
 n:=jsonb_array_length(result_lines);
 if n not between 1 and 500 or n<>(select source_count from public.tariff_impact_runs where id=b.input_run_id and customer_id=b.customer_id) then raise exception 'Incomplete audit output'; end if;
 for item in select value from jsonb_array_elements(result_lines) loop
  row_index:=row_index+1;
  if jsonb_typeof(item)<>'string' or (item#>>'{}')::jsonb->'entry'->>'row' is distinct from row_index::text then raise exception 'Invalid audit row order'; end if;
  insert into public.audit_entry_results(audit_id,customer_id,run_id,revision,row_number,result_text) values(b.id,b.customer_id,b.active_run_id,b.revision,row_index,item#>>'{}');
 end loop;
 select encode(extensions.digest(string_agg(r.result_text,E'\n' order by r.row_number),'sha256'),'hex') into result_hash from public.audit_entry_results r where r.audit_id=b.id and r.run_id=b.active_run_id;
 insert into public.tariff_impact_attestations(run_id,audit_id,customer_id,revision,input_sha256,result_sha256,engine_version,bundle_ids,summary) values(b.active_run_id,b.id,b.customer_id,b.revision,input_fingerprint,result_hash,engine,b.bundle_ids,summary_data);
 update public.audit_batches set status='completed',summary=summary_data,checkpoint='[]',progress=n,lease_token=null,lease_until=null,input_hash=input_fingerprint where id=b.id;
 return b.active_run_id;
end;$$;
revoke all on function public.finish_historical_audit(uuid,uuid,uuid,integer,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.finish_historical_audit(uuid,uuid,uuid,integer,jsonb,jsonb,text,text) to service_role;
commit;
