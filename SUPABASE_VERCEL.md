# Supabase + Vercel Production Runbook

## Architecture

```txt
Browser -> Vercel Next.js -> Supabase (session + RLS + production data)
                       \-> OpenAI or Anthropic API (deployed chat only)

Trusted worker -> official sources -> Supabase (tenant data and evidence)
              \-> local Claude/Codex/Antigravity CLI
```

Supabase is the only runtime store for the app and worker. The worker uses
local CLI logins for long checks; raw evidence can remain on local disk.
`db:cloud:*` commands now verify reads and do not copy a local ledger.
The operator requested no Telegram or launchd for this rollout.

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

## 2. Configure the trusted worker

Set the intended Supabase URL and a local-only trusted secret in `.env`.
`npm run db:seed` optionally creates official source definitions and fictional
example data in Supabase; review the destination before running it. There is
no `db:push` command and no current SQLite import requirement.

```txt
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
CANTE_SUPABASE_CUSTOMER_SLUG=YOUR_TENANT_SLUG
CANTE_LLM=claude-code
```

Never expose the secret to the browser or commit it. The legacy
`npm run db:cloud:verify` command checks access/counts and performs no writes.
Customer inputs already reside in Supabase; no pull/sync is required.
Long source checks still execute on the trusted worker. Do not activate
Telegram delivery or launchd as part of the website release.

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

### October 9 audit fixes on dev

Applied to **Cante** on October 9:
`supabase/migrations/20261009132549_audit_tariff_coverage_and_hts_progress.sql`.
The follow-up `20261009142954_tariff_reference_rls.sql` is also applied: both
public tariff reference tables now use RLS with existing global SELECT access
preserved and service-role ingestion unchanged.
The migration adds historical entry evidence, idempotent snapshot creation, and
atomic per-chapter publication markers. `hts-revision-check` is deployed as active version 4.
Existing embedding rows are not completion proof: the first refresh republishes
chapters to establish markers, reusing unchanged vectors. Chapter 99 must use
`from=99&to=9999`; `to=99` and `to=100` return empty exports.

Live Section 232 requires a `section232_coverage_reviews` record for the exact
latest accepted document/effective date and a reviewed-through date covering the
entry date. A reviewer must establish that those accepted rows are a complete,
consolidated schedule; a narrow amendment is insufficient. Never populate the
review ledger merely because an annex-level model verification passed. Missing
reviews, stale coverage, or a failed lookup withhold aggregate quotes. General
quotes also withhold totals for origins covered by the July 24 forced-labor
Section 301 action until its exemptions and combined-rate rules are implemented.

Historical pilot scope is in `config/tariff-pilot.json`: full HTS 3916.90.30.00,
CN/VN origin, September 15–27, 2026 (Revision 19). CSV fields are `entry_id`,
`line_number`, `sku`, `hts`, `origin`, `customs_value_usd`, `paid_duty_usd`,
`entry_date`, `qualification_verified`, and `qualification_basis`. Qualification
must be a caller's explicit reviewed fact, never inferred by the mapping model.
The SKU must link to exactly one tenant catalogue product before a persisted
row can report a discrepancy. Unsupported dates, claims, or qualifications
stay unresolved. Historical amounts are assessed-minus-paid duty differences,
not annual savings or a determination of refund eligibility.

Validation used an isolated PostgreSQL 14 database for snapshot constraints,
idempotency, and publication markers. Its vector cast was substituted with a
bounded text column because that local server has no pgvector; vector operations
were not verified by that local harness. Subsequent live Supabase checks passed
for the schema, RLS/privileges, public reference reads, a rolled-back publication
marker, and actual signed-in historical persistence/idempotency. All 25 migration
versions now match remote history; no migrations are pending.

For this rollout, use the authenticated CLI 2.120.0 (for example,
`npx supabase@2.120.0 projects list`), which has access to Cante. The repository's
older 2.118.0 binary blocked on Keychain while the logged-in 2.120.0 worked.
Use explicit `--project-ref nvdsjqzbzsczvmvjxhro`; `db query` and `db advisors`
also require `--linked` with that flag. Never use the unrelated PeakMV project.

The dev Vercel preview is
https://cante-444ecg7ve-jeremygautamas-projects.vercel.app.
Its Supabase URL was verified to target Cante. Branch-specific dev preview
settings now include `CANTE_LLM=api` and `CANTE_LLM_LOCKED=true`. The production
website has not been promoted. No Telegram, launchd, Vault-secret change, or
scheduler activation was used for this rollout.


## October 9 scoped MVP follow-up

Three further migrations are applied (28 total):
`20261009184839_mvp_impact_basis_and_monitor_health.sql`,
`20261009185719_hts_reuse_unchanged_embeddings.sql`, and
`20261009185935_hts_publication_rpc_timeout.sql`.
The last sets the service-only RPC's timeout in its function configuration,
which PostgREST reads before execution; an in-body SET LOCAL alone did not
extend the active API statement timer. No global or tenant role timeout changed.

HTS Edge Function v6 processes one chapter per worker request and at most 24
workers per coordinator invocation. The existing cron resumes missing chapters.
Unchanged embeddings are retained in Postgres. Completion remains transactional,
including reserved chapter 77 and the terminal 9999 boundary for chapter 99.
Live request 12 returned HTTP 200 with Revision 21 fully ingested; source health
recorded 99/99 chapters at 2026-10-09 19:00:37 UTC. No new schedule, Telegram
or launchd was activated. Published-rate history starts with this migration;
it is source evidence, not automatic legal-rule approval. See MVP_STATUS.md.
