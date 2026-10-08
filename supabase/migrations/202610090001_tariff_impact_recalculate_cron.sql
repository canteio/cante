-- Managed, recurring proactive tariff-impact recalculation: replaces "a
-- human or coding agent must remember to run
-- `npm run tariff:recalculate`" with a real Supabase-native scheduled job.
--
-- Every 6 hours (same cadence as the HTS revision check, and more frequent
-- than most regulatory actions land), pg_cron fires an HTTP POST (via
-- pg_net, non-blocking) at the deployed tariff-impact-recalculate Edge
-- Function, which calls the authenticated Next.js API route
-- app/api/internal/tariff-recalculate/route.ts to run the real,
-- already-reviewed recalculateTariffImpacts() against every customer with
-- monitor candidates and deliver/record only what is materially new.
--
-- Both shared secrets this job needs are stored in Supabase Vault
-- (vault.secrets), not hardcoded in this migration's SQL text, so neither
-- ends up in migration history or a git diff:
--   - tariff_recalc_cron_shared_secret: the Edge Function's OWN inbound
--     auth secret (matches TARIFF_RECALC_CRON_SHARED_SECRET on the
--     function).
--   - tariff_recalculate_function_url: the deployed Edge Function's URL.
-- The Edge Function's own outbound secret to the Next.js route
-- (TARIFF_RECALC_SHARED_SECRET / TARIFF_RECALC_TARGET_URL) is set directly
-- as Edge Function secrets via `supabase secrets set`, not through this
-- migration, since pg_cron/pg_net only need to reach the Edge Function,
-- not the Next.js route directly.
--
-- Both Vault secrets must be set to real values out-of-band (via
-- `select vault.update_secret(id, '<real value>') where name = '...'`)
-- before the cron job can authenticate successfully; a missing/placeholder
-- secret makes the HTTP call fail closed (401 from the function) rather
-- than silently succeed -- same fail-closed behavior as the HTS job.
begin;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'tariff_recalc_cron_shared_secret') then
    perform vault.create_secret('placeholder-set-via-supabase-secrets-runbook', 'tariff_recalc_cron_shared_secret', 'Bearer token the tariff-impact-recalculate pg_cron job sends to the Edge Function; must match the function''s TARIFF_RECALC_CRON_SHARED_SECRET secret.');
  end if;
  if not exists (select 1 from vault.secrets where name = 'tariff_recalculate_function_url') then
    perform vault.create_secret('https://project-ref-placeholder.supabase.co/functions/v1/tariff-impact-recalculate', 'tariff_recalculate_function_url', 'Deployed URL of the tariff-impact-recalculate Edge Function; set via the deployment runbook to the real project URL.');
  end if;
end $$;

select cron.schedule(
  'tariff-impact-recalculate-every-6h',
  '20 */6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tariff_recalculate_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tariff_recalc_cron_shared_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

commit;
