-- Public signups reach this table only through the server-side waitlist route.
-- Anonymous and authenticated Supabase clients cannot execute the write function.
create table if not exists public.waitlist_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  email text not null,
  ip_hash text not null,
  user_agent text,
  created_at timestamptz not null default pg_catalog.now()
);

create unique index if not exists waitlist_entries_email_unique
  on public.waitlist_entries (pg_catalog.lower(email));
create index if not exists waitlist_entries_ip_created_idx
  on public.waitlist_entries (ip_hash, created_at desc);

create table if not exists public.waitlist_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  attempted_at timestamptz not null default pg_catalog.now()
);

create index if not exists waitlist_attempts_ip_attempted_idx
  on public.waitlist_attempts (ip_hash, attempted_at desc);
create index if not exists waitlist_attempts_retention_idx
  on public.waitlist_attempts (attempted_at);

alter table public.waitlist_entries enable row level security;
alter table public.waitlist_attempts enable row level security;
revoke all on public.waitlist_entries from public, anon, authenticated;
revoke all on public.waitlist_attempts from public, anon, authenticated;

create or replace function public.join_waitlist(
  requested_email text,
  requested_ip_hash text,
  requested_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(requested_email));
begin
  if normalized_email is null
    or pg_catalog.length(normalized_email) > 254
    or normalized_email operator(pg_catalog.!~) '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;

  if requested_ip_hash is null
    or requested_ip_hash operator(pg_catalog.!~) '^[0-9a-f]{64}$' then
    raise exception 'invalid IP hash';
  end if;

  -- Serialize count-and-insert operations for one IP so concurrent requests
  -- cannot all observe a count below the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(requested_ip_hash, 0)
  );

  -- Count attempts, not successful inserts, so new and existing addresses consume
  -- an identical abuse-control budget and cannot be distinguished indirectly.
  delete from public.waitlist_attempts
  where waitlist_attempts.attempted_at <= pg_catalog.now() - interval '24 hours';

  if (
    select pg_catalog.count(*)
    from public.waitlist_attempts
    where waitlist_attempts.ip_hash = requested_ip_hash
      and waitlist_attempts.attempted_at > pg_catalog.now() - interval '15 minutes'
  ) >= 5 then
    return pg_catalog.jsonb_build_object('accepted', false, 'rate_limited', true);
  end if;

  insert into public.waitlist_attempts (ip_hash)
  values (requested_ip_hash);

  insert into public.waitlist_entries (email, ip_hash, user_agent)
  values (
    normalized_email,
    requested_ip_hash,
    pg_catalog.left(requested_user_agent, 500)
  )
  on conflict ((pg_catalog.lower(email))) do nothing;

  -- New and duplicate addresses deliberately have the same result.
  return pg_catalog.jsonb_build_object('accepted', true, 'rate_limited', false);
end;
$$;

revoke all on function public.join_waitlist(text, text, text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, text) to service_role;
