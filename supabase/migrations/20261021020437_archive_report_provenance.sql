-- Content hashes alone are not execution provenance. No existing reports are grandfathered.
-- Only a trusted worker that independently verifies/recomputes a check may attest it.
create table public.tariff_check_attestations (
 check_id uuid primary key, customer_id uuid not null,
 terminal_event_id uuid not null references public.tariff_check_events(id),
 input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'),
 event_sha256 text not null check(event_sha256 ~ '^[0-9a-f]{64}$'),
 verified_at timestamptz not null default now(),
 verifier_version text not null check(length(verifier_version) between 1 and 160),
 foreign key(check_id,customer_id) references public.tariff_check_records(id,customer_id)
);
alter table public.tariff_check_attestations enable row level security;
revoke all on public.tariff_check_attestations from public,anon,authenticated,service_role;
grant select on public.tariff_check_attestations to authenticated;
grant select,insert on public.tariff_check_attestations to service_role;
create policy read_check_attestations on public.tariff_check_attestations for select to authenticated using(private.is_customer_member(customer_id));
create trigger immutable_check_attestation before update or delete on public.tariff_check_attestations for each row execute function private.prevent_tariff_archive_mutation();
