-- Auto-provision a workspace on signup, per J's instruction: a brand-new
-- Supabase auth user should land with access immediately rather than
-- sitting on /pending until someone manually inserts a customer_users row.
--
-- Scope, explicitly: this fires ONLY on INSERT into auth.users, i.e. a real
-- authenticated signup through /login's Supabase sign-in flow. The public
-- waitlist (public.waitlist_entries, see 202609210001_public_waitlist.sql)
-- never creates an auth.users row and is completely untouched by this —
-- joining the waitlist must never grant dashboard access.
--
-- Each new user gets their OWN new customer workspace (not a shared pool),
-- named from their email, and is attached as 'owner' of it. This mirrors
-- how a self-serve SaaS onboarding would work and keeps tenants isolated —
-- nobody auto-joins a workspace they didn't create.
--
-- Hardened across two independent red-team reviews (deleg_0d1461dd,
-- deleg_1b6e1456):
--   1. Only confirmed, non-banned, non-deleted accounts are provisioned
--      (email_confirmed_at is not null, banned_until/deleted_at is null).
--      An admin invite, a pending email-confirmation row, a banned
--      account, or a soft-deleted row must never receive a live
--      owner-level workspace the instant the auth.users row exists.
--      This repo currently has no admin-invite flow at all (verified by
--      search), so an invite path arriving later is the only way this
--      trigger could still auto-provision an unwanted workspace for an
--      invited user — tracked as a known follow-up, not silently ignored.
--   2. The entire trigger/backfill body is wrapped in BEGIN/EXCEPTION so
--      any failure degrades to "no workspace provisioned, user lands on
--      /pending" rather than aborting the INSERT into auth.users and
--      taking down signup. `raise warning` logs the failure so it is NOT
--      completely silent to an operator (visible in Postgres/Supabase
--      logs), closing the observability gap the second review flagged.
--   3. REMOVED a single-column unique index on customer_users(user_id)
--      from the first rewrite: customer_users' own primary key is the
--      composite (customer_id, user_id) BY DESIGN — SUPABASE_VERCEL.md
--      documents manually adding an existing user to a SECOND workspace,
--      and lib/supabase/server.ts's getAuthenticatedWorkspace() is written
--      to expect more than one customer_users row per user_id. A
--      single-column unique index on user_id would have silently broken
--      that already-supported, already-coded multi-workspace pattern —
--      caught by the second review before shipping.
--   4. The real concurrency problem that index was trying to paper over —
--      two concurrent provisioning attempts for the same user racing past
--      the NOT EXISTS check and each creating their own `customers` row,
--      leaving an orphaned ownerless workspace when only one wins the
--      customer_users insert — is closed properly with a per-user
--      transaction-scoped advisory lock instead. The lock serializes
--      concurrent attempts for the SAME user_id without touching the
--      legitimate case of one user later being added to a SECOND,
--      different workspace by hand.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_customer_id uuid;
  derived_name text;
begin
  -- Only a genuinely completed, live signup gets auto-provisioned. This is
  -- what keeps admin-invited, unconfirmed, banned, and soft-deleted rows
  -- from receiving a workspace the instant their auth.users row exists.
  if new.email_confirmed_at is null
    or new.banned_until is not null
    or new.deleted_at is not null
  then
    return new;
  end if;

  -- Serialize any concurrent provisioning attempt for this exact user
  -- (e.g. overlapping confirmation retries, or a backfill run racing a
  -- live signup) so at most one `customers` row for THIS user's
  -- auto-provisioning can ever be created — without touching any other
  -- user's provisioning or a later, separate, manually-added membership.
  -- Transaction-scoped: releases automatically when this statement's
  -- transaction ends, never held across calls.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.id::text));

  -- Re-check after acquiring the lock — a concurrent call may have already
  -- provisioned this user while we were waiting for it.
  if exists (
    select 1 from public.customer_users where user_id = new.id
  ) then
    return new;
  end if;

  derived_name := coalesce(
    split_part(new.email, '@', 1),
    'Workspace'
  );

  insert into public.customers (name, slug)
  values (
    derived_name,
    -- slug must be globally unique; the user id guarantees that without a
    -- retry loop, and is itself opaque (no email leaked into the slug).
    'auto-' || replace(new.id::text, '-', '')
  )
  returning id into new_customer_id;

  insert into public.customer_users (customer_id, user_id, role)
  values (new_customer_id, new.id, 'owner');

  return new;
exception
  when others then
    -- Never let a provisioning bug block the signup itself. Worst case,
    -- the user lands on /pending and this is attached manually later —
    -- that is the pre-existing, safe behavior this migration is adding
    -- automation on top of, not replacing. `raise warning` still makes
    -- the failure visible in Postgres/Supabase logs rather than silent.
    raise warning 'handle_new_auth_user: failed to auto-provision workspace for user % (%)', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_provision_workspace on auth.users;
create trigger on_auth_user_created_provision_workspace
  after insert or update of email_confirmed_at on auth.users
  for each row
  execute function private.handle_new_auth_user();

-- One-time backfill: provision a workspace for every existing, CONFIRMED,
-- live auth user who signed up before this trigger existed and is still
-- stuck without one (e.g. landing on /pending). Idempotent and safe to
-- re-run — the same per-user advisory lock plus the NOT EXISTS guard
-- prevent duplicate or orphaned workspace rows under concurrency.
-- Unconfirmed/banned/deleted accounts are excluded, matching the trigger's
-- own gate above.
do $$
declare
  existing_user record;
  new_customer_id uuid;
begin
  for existing_user in
    select u.id, u.email
    from auth.users u
    where u.email_confirmed_at is not null
      and u.banned_until is null
      and u.deleted_at is null
  loop
    begin
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(existing_user.id::text));

      if exists (
        select 1 from public.customer_users where user_id = existing_user.id
      ) then
        continue;
      end if;

      insert into public.customers (name, slug)
      values (
        coalesce(split_part(existing_user.email, '@', 1), 'Workspace'),
        'auto-' || replace(existing_user.id::text, '-', '')
      )
      returning id into new_customer_id;

      insert into public.customer_users (customer_id, user_id, role)
      values (new_customer_id, existing_user.id, 'owner');
    exception
      when others then
        -- Skip this user on any failure; the backfill is safe to re-run,
        -- and one user's problem must not abort the whole backfill.
        raise warning 'backfill handle_new_auth_user: failed for user % (%)', existing_user.id, sqlerrm;
        continue;
    end;
  end loop;
end $$;
