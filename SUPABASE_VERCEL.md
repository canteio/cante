# Supabase + Vercel Production Runbook

## Architecture

```txt
Browser -> Vercel Next.js -> Supabase (session + RLS + production data)
                       \-> OpenAI or Anthropic API (deployed chat only)

Always-on Mac -> official sources -> local SQLite ledger -> Supabase sync + verification
              \-> local Claude/Codex/Antigravity CLI
```

Supabase is what the deployed app reads and writes. SQLite remains the trusted
worker ledger because a source run takes minutes, uses local CLI logins, and
keeps a raw evidence trail. A completed run is not reported healthy until its
optional production sync also succeeds.

The model does not receive a Supabase credential. The Next.js server resolves
the authenticated workspace, retrieves only rows allowed by that user's
Supabase session and RLS, and places those bounded excerpts in the model prompt.

## 1. Apply The Schema

In Supabase SQL Editor, run the complete file:

`supabase/migrations/202608230001_cante_production.sql`

It creates the operational tables, tenant membership policies, keyword/vector
retrieval functions, and indexes. It is idempotent, so rerunning it is safe.

Confirm the existing user is still linked:

```sql
select c.name as customer, u.email, cu.role
from public.customer_users cu
join public.customers c on c.id = cu.customer_id
join auth.users u on u.id = cu.user_id;
```

The expected row is `MA / cante@cante.cante / owner`.

## 2. Import SQLite Once

Put the Supabase secret key in the local Mac's `.env` temporarily. This is the
only process that needs it:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
CANTE_SUPABASE_CUSTOMER_SLUG=pt-ma
```

Never prefix the secret with `NEXT_PUBLIC_`, commit it, or add it to Vercel.

Run:

```bash
npm run db:cloud:dry-run
npm run db:cloud:sync
npm run db:cloud:verify
```

The importer preserves record IDs and maps the local MA customer to the
existing Supabase customer with slug `pt-ma`, so the existing owner membership
continues to authorize the imported rows. Upserts make the process resumable.
Verification proves that every local record ID exists in Supabase; it
deliberately allows additional cloud-created chats, memories, products, and
uploads.

## 3. Configure The Local Worker

Keep the existing local variables and add:

```txt
CANTE_AUTH_MODE=demo
CANTE_DATA_BACKEND=sqlite
CANTE_LLM=claude-code
CANTE_SYNC_SUPABASE=true
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
CANTE_SUPABASE_CUSTOMER_SLUG=pt-ma
```

`npm run check:scheduled` will run locally, verify the result, sync all rows to
Supabase, verify local IDs, then send delivery/heartbeat success. Before the
check starts, it pulls live profiles, memory, KBLI, checklist, catalogue,
supplier, lane, and document inputs back into SQLite so judgment never runs
against a stale company profile. A failed pull or push produces a failure
notification instead of letting stale data look current.

## 4. Configure Vercel

Set these for Production and Preview as appropriate:

```txt
CANTE_APP_URL=https://YOUR_DOMAIN
CANTE_AUTH_MODE=supabase
NEXT_PUBLIC_CANTE_AUTH_MODE=supabase
CANTE_DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
CANTE_LLM=api
CANTE_LLM_LOCKED=true
CANTE_HOSTED_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5
```

For Claude instead of OpenAI:

```txt
CANTE_HOSTED_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Do **not** add `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, local CLI
paths, Telegram credentials, or `CANTE_DB_PATH` to Vercel.

## 5. Supabase Auth URLs

In Supabase Authentication -> URL Configuration:

- Site URL: the production domain.
- Redirect URLs: `https://YOUR_DOMAIN/**` and the exact Vercel preview pattern
  you intend to test.
- Disable public signups for invite-only operation, or keep them enabled only
  if `/pending` is the intended holding area. A session without a
  `customer_users` membership cannot enter the app or operational APIs.

## 6. Deploy And Smoke Test

```bash
npm test
npx tsc --noEmit
npm run build
```

Then verify in production:

1. An anonymous visit to `/chat` redirects to `/login`.
2. The owner can sign in and sees MA's migrated checks, memory, and chat.
3. A signed-in user without membership lands on `/pending`.
4. Chat answers from the locked hosted provider.
5. An uploaded text document appears in Supabase `trade_documents` and its
   excerpts are retrievable on the next related chat question.
6. `POST /api/checks` returns `409`; production checks must run on the trusted
   local scheduler.

## Security Boundary

- Supabase publishable keys are safe in the browser because every operational
  table has RLS.
- The Supabase secret bypasses RLS and belongs only to the local sync process.
- AI keys are server-only Vercel variables.
- API routes are authenticated in middleware; unsafe cookie-authenticated
  requests also require a same-origin `Origin` header when one is present.
- Tenant IDs from request bodies are never trusted. They are resolved against
  `customer_users`, and Supabase RLS independently enforces the same boundary.
- OpenAI requests set `store: false`. Private context is bounded before it is
  sent to either hosted model.

## Current Honest Boundary

Checks, profiles, checklist, memory, conversations, chat history, findings,
alerts, sources, and uploaded chat documents are cloud-backed. The mature
customs document audit, tariff enrichment, screening, BOM assessment, and
check execution remain worker-side workflows. Their tables are migrated and
visible after sync, but those heavy mutations are not moved into Vercel.
