# Supabase + Vercel Readiness

This repo is prepared for a staged deploy, but the production switch is still
deliberate. The local daily runner still depends on SQLite plus the local
Claude/Codex CLI providers; do not move check execution to Vercel until hosted
LLM usage is accepted.

## Current Staged Architecture

```txt
Vercel
  - public landing page
  - login / request-access / pending / logout pages
  - authenticated app UI

Supabase
  - email/password identity
  - later: customer_users / tenant mapping
  - later: app data mirror or Postgres migration

Always-on Mac
  - scheduled check runner
  - local SQLite source ledger for now
  - local Claude/Codex CLI providers
```

## Environment Variables

Local demo mode:

```txt
CANTE_AUTH_MODE=demo
NEXT_PUBLIC_CANTE_AUTH_MODE=demo
```

Supabase mode:

```txt
CANTE_AUTH_MODE=supabase
NEXT_PUBLIC_CANTE_AUTH_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CANTE_ALLOWED_EMAILS=you@domain.com,client@company.com
```

`CANTE_ALLOWED_EMAILS` is a temporary bridge. In Supabase mode, a user must be
signed in **and** their email must be listed there or middleware sends them to
`/pending`. Replace this with a real `customer_users` lookup before hosting real
customer data.

## Supabase Setup Later

1. Create a Supabase project.
2. Enable email/password auth.
3. Add the Supabase URL and publishable key to Vercel env vars.
4. Add allowed pilot emails to `CANTE_ALLOWED_EMAILS`.
5. Create Supabase Auth users or invite them through the dashboard.
6. Set `CANTE_AUTH_MODE=supabase` and `NEXT_PUBLIC_CANTE_AUTH_MODE=supabase`.
7. Deploy.

## What Is Ready

- `@supabase/ssr` and `@supabase/supabase-js` are installed.
- `lib/supabase/client.ts` creates the browser client.
- `lib/supabase/server.ts` creates the server client.
- `lib/supabase/middleware.ts` refreshes/verifies SSR auth via `getClaims()`.
- `middleware.ts` protects app routes in demo or Supabase mode.
- `/login` uses demo credentials today and Supabase email/password when
  `NEXT_PUBLIC_CANTE_AUTH_MODE=supabase`.
- `/logout` clears demo and Supabase sessions.
- `/pending` exists for signed-in users without workspace access.
- `/request-access` works without keys by preparing an email.

## What Is Not Ready Yet

- The app still reads operational data from `cante.db`.
- Vercel cannot run `better-sqlite3` as a durable production database.
- Vercel cannot shell out to the local `claude` or `codex` CLIs.
- There is no Supabase `customer_users` table wired into app authorization yet.
- The Mac runner does not push check results to Supabase yet.

## Correct Next Cut

Keep the daily runner local. Use Supabase first for identity and read-only pilot
access, then decide whether to:

- mirror selected alert/check data from SQLite into Supabase, or
- migrate the operational schema to Postgres, or
- keep the deployed app as landing/login only until a paying customer justifies
  the migration.
