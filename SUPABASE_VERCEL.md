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

Create a Supabase project, then apply the SQL files in `supabase/migrations/`
in filename order using the SQL Editor or your migration workflow.

It creates the operational tables, tenant membership policies, keyword/vector
retrieval functions, indexes, and the server-only waitlist RPC. It is idempotent,
so rerunning it is safe. The waitlist table has RLS enabled and is not readable
by anonymous clients. Only the Next.js server's dedicated waitlist credential can
execute the validated, duplicate-safe RPC with its atomic per-IP rate limit.

Create or invite a user through Supabase Authentication. Copy that user's UUID.
Create a tenant and membership in SQL Editor, replacing the example values and
`YOUR_AUTH_USER_UUID` with your own values:

```sql
insert into public.customers (slug, name, country, city)
values ('example-company', 'Example Company', 'United States', 'Chicago');

insert into public.customer_users (customer_id, user_id, role)
select id, 'YOUR_AUTH_USER_UUID'::uuid, 'owner'
from public.customers where slug = 'example-company';
```

Verify the intended user and tenant are linked:

```sql
select c.slug, c.name, u.email, cu.role
from public.customer_users cu
join public.customers c on c.id = cu.customer_id
join auth.users u on u.id = cu.user_id;
```

No tenant or user is supplied by the repository. The values above are fictional.

## 2. Initialize the local worker and optionally import data

For a new local ledger, run `npm run db:push` and `npm run db:seed`.
Seeding creates official source definitions and a fictional Example Company;
replace its profile with your own verified inputs before monitoring operations.
For an existing ledger, review its intended tenant mapping before importing.

Put the Supabase secret key in the local Mac's `.env` temporarily. This is the
only process that needs it:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
CANTE_SUPABASE_CUSTOMER_SLUG=YOUR_TENANT_SLUG
```

Never prefix the secret with `NEXT_PUBLIC_`, commit it, or add it to Vercel.

Run:

```bash
npm run db:cloud:dry-run
npm run db:cloud:sync
npm run db:cloud:verify
```

The importer preserves record IDs and maps the first local customer to the
explicit `CANTE_SUPABASE_CUSTOMER_SLUG`. This variable is required for dry-run,
sync, pull, and verification. Use the slug created above for your deployment.
Additional local customers use slugs derived from their names. Review these
mappings before syncing. Upserts make the process resumable.
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
CANTE_SUPABASE_CUSTOMER_SLUG=YOUR_TENANT_SLUG
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
# A separately generated, revocable Supabase server secret used only by the
# waitlist route. It still has service-role power: never prefix with NEXT_PUBLIC_.
WAITLIST_WRITE_KEY=sb_secret_...
WAITLIST_HASH_SALT=GENERATE_A_RANDOM_SERVER_ONLY_VALUE
```

For Claude instead of OpenAI:

```txt
CANTE_HOSTED_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Do **not** add the worker's `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
local CLI paths, Telegram credentials, or `CANTE_DB_PATH` to Vercel. Create a
separate, revocable Supabase secret for `WAITLIST_WRITE_KEY`; keep it server-only
and use it only for the waitlist RPC.

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
2. The owner can sign in and sees only their tenant’s checks, memory, and chat.
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

## Scheduled tariff impact recalculation

Run `npm run tariff:recalculate` on the trusted worker. A failed calculation,
coverage limit, or queued/failed delivery exits nonzero. Undelivered immutable
impact events are retried on subsequent passes even when the calculation did
not change. Delivery is at least once: if Telegram accepts a message but the
bookkeeping write fails, a later retry can send it again.

The optional Supabase Edge trigger targets the worker's Next.js endpoint
`/api/internal/tariff-recalculate`, not the Vercel app. The hosted endpoint
returns 409; keep `SUPABASE_SECRET_KEY` and Telegram credentials on the worker.
Set `TARIFF_RECALC_SHARED_SECRET` on the worker, and configure the Edge secrets
`TARIFF_RECALC_TARGET_URL` (the reachable HTTPS worker endpoint),
`TARIFF_RECALC_SHARED_SECRET` (the same outbound secret), and
`TARIFF_RECALC_CRON_SHARED_SECRET` (a separate inbound cron secret).

Apply the cron migration and replace its Vault placeholders only when the
worker endpoint and deployed Edge Function are ready. The Edge Function uses
shared-secret authentication, so deploy its gateway with JWT verification
disabled. Confirm wrong secrets yield 401, a completed quiet pass yields 200,
and incomplete/failed work yields 503 through both HTTP layers. Check cron
history and HTTP response records; checked-in SQL alone does not prove the
schedule is active. No schedule or secrets are configured by this code change.
