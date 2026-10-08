-- Managed, recurring HTS revision check: replaces "a human or coding agent
-- must remember to run scripts/check-hts-revision.ts" with a real
-- Supabase-native scheduled job. Every 6 hours, pg_cron fires an HTTP POST
-- (via pg_net, non-blocking) at the deployed hts-revision-check Edge
-- Function, which compares the live USITC HTS revision against the latest
-- ingested revision and, only if different, runs the full re-ingestion
-- (idempotent; see supabase/functions/hts-revision-check/index.ts).
--
-- 6 hours, not 1-3, because the HTS schedule changes at most a handful of
-- times a year (USITC revision bumps), so a no-op check four times a day
-- already gives same-day pickup of a real change without wastefully
-- polling USITC/the database every hour for a schedule that is static the
-- overwhelming majority of the time.
--
-- The shared secret the Edge Function requires is stored in Supabase
-- Vault (vault.secrets), not hardcoded in this migration's SQL text, so
-- it never ends up in migration history or a git diff. Vault's secret
-- itself must be inserted out-of-band (e.g. via `supabase secrets set` /
-- the dashboard / `select vault.create_secret(...)`) before the cron job
-- can authenticate successfully; a missing secret makes the HTTP call
-- fail closed (401 from the function) rather than silently succeed.
begin;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- pg_cron and pg_net run as superuser-owned background workers; grant the
-- minimum needed for the scheduling role used below.
grant usage on schema cron to postgres;
grant all on all tables in schema cron to postgres;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hts_cron_shared_secret') then
    -- Placeholder so the job can be scheduled immediately; the real value
    -- must be set out-of-band (see supabase/functions/hts-revision-check
    -- README note and the deployment runbook) via
    -- select vault.update_secret(id, '<the real HTS_CRON_SHARED_SECRET>')
    -- where name = 'hts_cron_shared_secret'. Until updated, the Edge
    -- Function correctly rejects every cron-triggered call with 401,
    -- which is fail-closed, not fail-open.
    perform vault.create_secret('placeholder-set-via-supabase-secrets-runbook', 'hts_cron_shared_secret', 'Bearer token the hts-revision-check pg_cron job sends to the Edge Function; must match the function''s HTS_CRON_SHARED_SECRET secret.');
  end if;
  if not exists (select 1 from vault.secrets where name = 'hts_revision_check_function_url') then
    perform vault.create_secret('https://project-ref-placeholder.supabase.co/functions/v1/hts-revision-check', 'hts_revision_check_function_url', 'Deployed URL of the hts-revision-check Edge Function; set via the deployment runbook to the real project URL.');
  end if;
end $$;

select cron.schedule(
  'hts-revision-check-every-6h',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'hts_revision_check_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'hts_cron_shared_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

commit;
