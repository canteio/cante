# Supabase + Vercel Production Runbook

Monitoring results identify their calculation method. The current website requires
`exact-duty-arithmetic-v2` from the trusted worker. Release matching website and
worker builds together; a worker mismatch is a visible failure, not a completed
fresh check. A method change establishes a new numerical baseline, and old
attested checks remain in history. Refresh before using old/unknown methods for
current chat or dashboard costs. Never rewrite historical attestations to add a
method marker. Local verification does not update hosted targets.

October 27: migration `20261027194112_historical_audit_engine_refresh.sql` is
applied. The current audit refresh HTTP route requires this RPC and pins the
server calculation version; older clients retain their legacy RPC. Actual worker
proofs remain authoritative, separate from requested-version metadata. Release
the website and trusted worker together so a request for new support executes
on that version. No deployment or daily target changed. The real isolated
old-v19 → refresh → v20 workflow and tenant denials pass.
[Scope, rollback tests, advisors and cleanup](../audits/2026-10-27-statistical-components.md).

October 25 historical expansion is local-only. Migrations `20261024162000` and
`20261024210000` are applied for strict CBP original URLs and 512 pinned references.
The updated website and trusted worker must be released together; no deployment,
worker connector or daily Vault target was changed in this work. Use the
[historical audit runbook](historical-audits.md) and
[verified scope](../audits/2026-10-24-multiyear-chapter99.md) for bounds and checks.

October 30 Data API defaults: migration
`20261023165515_explicit_data_api_worker_grants.sql` is applied. Older table-creation
migrations now declare worker grants and sequence access explicitly; new tables
must do the same. Never copy anonymous access grants onto tenant tables. The
isolated rebuild check is `npm run verify:data-api-grants -- --postgres-bin=/absolute/postgresql/bin`.
[Scope and verification](../audits/2026-10-23-explicit-data-api-grants.md).


October 23 ordinary-audit release: website Preview
`[private deployment URL omitted]`, worker
`[private deployment URL omitted]`.
Both builds are READY. Preview/local future worker connectors use this worker;
existing daily Cron/Vault and production are unchanged. Real isolated local
production-build acceptance passed upload-to-export with actual Supabase and
worker proof. Vercel SSO blocks browser acceptance of the exact hosted website
build. [Current evidence and limits](../audits/2026-10-23-ordinary-audit-completion.md).


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
local CLI paths, Telegram credentials, or `CANTE_DB_PATH` to the customer-facing
Vercel project. The isolated checking-function project below is a separate trusted
worker, with no website routes or browser bundle. Create a
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
[private deployment URL omitted]
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

### Live-check archive — October 18, 2026

Migration `20261018050226_tariff_check_archive.sql` adds tenant-owned
`tariff_check_records`, `tariff_source_versions`, `tariff_check_events` and the
invoker-only `complete_tariff_check` RPC. The linked database has this migration;
the application changes still require a separate deployment. The customer app
continues to use its authenticated session and publishable key only.

Accepted CSVs/confirmations are inserted before government fetches. Source content
is deduplicated per workspace and URL/hash, with original response bytes recoverable
for PDFs. Source versions and the final event commit together. No automatic expiry
or background schedule was added. Member roles can add reviews; viewers can read
but cannot create checks or decisions. Actor/time defaults cannot be supplied by
ordinary API callers. UPDATE/DELETE grants are absent and mutation triggers reject
accidental privileged application writes too.

This is append-only application history, not protection against a database owner
altering schema/triggers, and not certified WORM or a complete legal-retention
program. Privileged maintenance and backup governance remain operator concerns.
Workspace deletion is restricted while archive records exist. Do not bypass those
restrictions for ordinary customer operations. Verification fixtures are isolated;
removal requires narrowly scoped administrative maintenance, never customer records.

Run `npm run test:archive` for handler/integrity tests. The SQL policy suite in
`supabase/tests/tariff_check_archive.sql` is administrative, creates isolated
fixtures and rolls its transaction back. It tests actual authenticated/anonymous
permissions, source deduplication/version preservation and mutation rejection.

### Historical rule comparison — October 18, 2026

Migration `20261019033002_tariff_historical_source_evidence.sql` is applied. It
extends the existing source archive to the official USITC archive and GovInfo
hosts, and adds optional lossless gzip metadata. Large schedule JSON is stored as
base64-encoded gzip: `sha256` identifies retained compressed bytes;
`original_sha256` identifies original downloaded bytes. Exports retain both and
verify bounded decompression. PDFs remain original bytes, base64 encoded.

Live checks discover an adjacent previous release from the publisher registry,
retain the actual archive links, compare both versioned subchapter III legal PDFs
(notes 16/20/52), compare Chapter 99 headings and exact-code base duties, and retain
linked modifying notices/official PDFs. No LLM, schedule or delivery is involved.
Current-data endpoints must not be assumed to honor an arbitrary release parameter.
Release availability intervals are not the legal effective intervals of every rule.

Capture guards bound individual response bytes, PDF page count, archive pages,
modifying-document count and retained evidence size. Unsupported or unavailable
historical coverage stays visible; current release instability invalidates the
comparison. Code/measure matches are review leads, not approved exclusions or a
complete historical full-stack duty/refund calculation. Missing old codes do not
become zero rates. Broad historical and eCFR backfill remain separate work.

Evidence exports now retrieve one stored source per database response with at most
three simultaneous reads, avoiding oversized combined responses of many PDFs.
Run `npm run test:history` offline or `npm run verify:history` for a fresh read-only
comparison against the current official release. The latter can fail honestly
when the source format, current law or supported archive coverage changes.

## On-demand file checking worker (October 21)

Supabase and Vercel are sufficient for the implemented on-demand path. The
customer-facing project dispatches to a separate Vercel Function project; only
that isolated worker has a Supabase service credential. No schedule, model or
delivery is needed. The older tariff-recalculation bridge and its unconditional
Vercel rejection remain unchanged.

Package the reviewed code:

```sh
npm run build:check-worker
```

This builds `output/check-worker/api/check.mjs`, plus the standalone Vercel
configuration. The generated directory is ignored. The build checks that no
Next.js website, LLM provider or delivery modules are included. Its authenticated
Supabase adapter is request-scoped; calculations retain the user's JWT and RLS.
There is no privileged fallback when that context is absent. Node.js 22 and a
300-second function duration are configured. The measured PDF-processing workload
exceeded Supabase Edge Functions' two-second CPU limit, so this package uses the
existing Vercel account rather than adding another hosting provider.

Link this generated directory to a **separate worker project**, not the website
project. Set the following server environment there:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=WORKER_ONLY_SUPABASE_SECRET
CANTE_TRUSTED_CHECK_WORKER=true
CANTE_DEPLOYMENT_ROLE=trusted-check-worker
CANTE_CHECK_DISPATCH_SECRET=AT_LEAST_32_RANDOM_CHARACTERS
```

The publishable settings are public configuration; the service and dispatch keys
must be Vercel Secrets. Only the worker's own extra deployment SSO gate may be
disabled for server-to-server calls; its function still requires both the signed
dispatch and a verified workspace session. The customer-facing project's existing
deployment protection is preserved.

For the website project's matching environment, configure only:

```txt
CANTE_CHECK_WORKER_URL=https://YOUR_WORKER_DEPLOYMENT/api/check
CANTE_CHECK_DISPATCH_SECRET=THE_SAME_DISPATCH_SECRET
```

The connector secret authorizes this connection; it is not a database/admin
credential. Never put the worker's Supabase service credential in the website
project. HTTPS is required except explicit localhost development. Redirects,
credentials in URLs, query strings and unexpected endpoint paths are rejected.
The standalone worker receives a user access token, verifies it with Supabase
Auth, verifies write-capable membership and record ownership, and reads the
immutable original itself. HMAC freshness binds the IDs and authentication header.
Hosted dispatch remains behind the shared database admission guard. Partial
connector settings fail visibly; no alternate worker or old result is substituted.

The worker fetches and computes independently, saves through the user's RLS-scoped
client, compares the committed payload to its own output, then inserts the
protected execution proof using its service client. Existing member-authored
completed reports are never signed retrospectively. Failed proofs leave an
unverified archive; start a new check to retry. The response omits source bodies;
original bytes remain available through authenticated history/export.

The Next.js adapter at `/api/internal/tariff-live-check` can also run on a separate
trusted Node worker using signed cookies. A normal website deployment rejects it;
Vercel execution additionally requires the explicit isolated-worker deployment
role. This exception does not change the older recalculation bridge's rejection.

Without a connector, direct on-demand checking remains available, but its saved
calculation is unverified and cannot become a saved numerical baseline. The worker
flag does not launch a process or enable a schedule. Preview deployments and their
settings do not update the existing production website. On a brand-new Vercel
project, the first deployment may receive the project's default production alias;
check its environment before use. The active test worker was an explicitly
configured preview; the initial bootstrap had no execution credentials.

A government archive index returned HTTP 403 from Vercel during verification.
Historical checking therefore retrieves and verifies the two versioned legal-note
PDFs independently. A failed JSON/index phase leaves historical base-duty/heading
comparisons unavailable, with explicit coverage flags and the failed request kept
in evidence. Empty missing comparisons never mean no change. This fallback does
not manufacture archive filenames, infer historical rates, or approve exclusions.

Verification records and limits are in the
[October 21 audit](../audits/2026-10-21-mvp-file-impact-flow.md). The isolated worker
and preview were exercised with labelled fictional inputs and real Supabase
archives. No customer ledger, full legal coverage or production release is implied.

## Unified workspace (October 22)

Migration `20261022041336_workspace_tariff_inputs.sql` adds nullable, bounded JSON
inputs to products under existing tenant RLS. It does not backfill reference prices
as customs values or rewrite customer data. Both dashboard and chat refreshes now
snapshot the catalogue, not the latest separately uploaded file. Deploy the
compatible worker before the website because catalogue snapshots can contain null
customs values and missing classification facts. Keep the website connector URL and
shared dispatch key paired with that worker. Local Next development reads the two
connector settings from ignored `.env.local`; a custom `.env.check-worker.local`
file alone is not automatically loaded by Next. Never put the worker's database
service key in the website environment.

The compatible isolated worker and standard local connector are configured.
Website preview and production build environments also have matching connector
settings. These environment updates do not redeploy the current production
website; the unified dashboard has not yet been promoted there.

Use the [workspace audit](../audits/2026-10-22-unified-tariff-workspace.md) for the
specific verification and release state. No new background schedule is part of
this dashboard refresh flow.


## Historical reference archive and database audit (October 22)

Five follow-up migrations add immutable shared sources, per-chapter publication,
exact historical rate lookups and indexed code/origin/date-scoped approved-rule
selection. They also add 65 missing relationship indexes and remove redundant
read policies/expensive auth expressions. See the [full schema/routing audit](../audits/2026-10-22-supabase-architecture.md)
and [reference operations](historical-references.md). The latter distinguishes
current search data, extracted candidates and legal approval; a published rate
reference alone cannot establish a complete historical stacked duty.

The compatible worker deployment is
`[private deployment URL omitted]`.
Local and future Preview/Production connector settings are updated; no main
website redeployment was performed. Privileged database keys remain absent from
the website's configured Vercel environment. Execution verification used the
compiled worker locally with actual Supabase, not an HTTP probe of its Vercel URL.

The existing `tariff-impact-recalculate` Edge Function is now v3, matching repository
failure-count handling; unauthenticated calls return 401. `hts-revision-check` v6
also matches repository source. The one existing HTS cron is unchanged and no
recalculation schedule or delivery was enabled. SQL lint is clean. The remaining
advisor warning about leaked-password protection is an Auth configuration item;
it was not changed by schema cleanup. Deliberate narrowly authorized definer RPCs,
service-only deny-all RLS tables and recently added unused indexes are documented
in the architecture audit rather than hidden by granting broader access.

## Daily workspace checks (October 22)

The user authorized only the Cante daily monitor, with in-app notices. Owners/admins
opt in using the dashboard checkbox. No workspace is enabled by deployment.
Apply `20261022224156_daily_workspace_monitor.sql` before releasing this UI.

The separate worker serves `/api/monitor` and requires its own random 32-byte
`CANTE_MONITOR_CRON_SECRET`. Keep that secret and all Supabase privileged keys off
the website. Provision the same secret in `.env.check-worker.local` and the worker's
Vercel environment, then deploy `output/check-worker` after `npm run build:check-worker`.
Configure Vault plus the one authorized Supabase Cron job explicitly:

```sh
node scripts/configure-daily-monitor.mjs --worker=https://WORKER.vercel.app/api/monitor
# Inspect the dry run, then apply:
node scripts/configure-daily-monitor.mjs --write --worker=https://WORKER.vercel.app/api/monitor
```

The job checks due workspaces every five minutes, one at a time; successful workspaces
recur after 24 hours, failed source/check attempts after one hour. Current workspace
limit is 100 active products. Review `cron.job_run_details`, `net._http_response`
and tenant daily settings for failures; never interpret a dispatch as a completed
check. A protected archive attestation is required before completion. Repoint Vault
when replacing the worker deployment. Do not turn on external delivery.

Verification: `supabase/tests/daily_monitor.sql` rolls back isolated fixtures;
`scripts/test-daily-worker.mjs` verifies the built worker's authentication/admission.

Earlier hosted-tested pilot Preview: `[private deployment URL omitted]`.
The latest historical-expansion Preview is
`[private deployment URL omitted]`; its build is ready,
but Vercel sign-in prevented hosted end-to-end acceptance of this exact version.
Preview/local worker connectors and the Vault scheduler now target the separate
`[private deployment URL omitted]` deployment,
using `/api/check` and `/api/monitor` respectively. Production website connector
settings were not changed by this expansion. No workspace opt-in was added.
Production website promotion remains separate. Migration
`20261022231308_tariff_archive_execution_timeout.sql` gives only the bounded atomic
archive writers a 45-second REST statement allowance; ordinary roles remain at
8 seconds. Preserve this per-function setting when updating those functions.
Background execution must bind the trusted client with `withWorkerClient`, so the
shared tariff-rule readers have their database context. Run
`node scripts/verify-check-worker-bundle.mjs --daily` after retaining official
sources; an idle-job smoke test alone cannot verify numerical calculations.

Latest free historical-data Preview:
`[private deployment URL omitted]` (Vercel-auth protected;
build ready, no new hosted signed-in end-to-end acceptance).
Its Preview/local manual and audit connector selects
`[private deployment URL omitted]`.
The daily Vault target remains on the previous `h41oj2412` worker recorded above;
no daily schedule/settings change was needed. Production remains unchanged. See
the [free-data source/release record](../audits/2026-10-22-free-official-data.md).


October 27 v21 source/engine expansion: 48 unique Chapter 91 originals across
2000–2017 are retained with archive/index or registry provenance. This is partial
reference coverage; 64 sampled edition/component source issues and publication
gaps remain explicit. No new migration, grant or human approval is introduced.
The v20 engine-refresh migration remains required. Website and protected worker
must both run the current engine before claiming refreshed support; request
metadata alone is insufficient. Local isolated builds/tests are not a production
deployment. Production/daily targets and customer opt-ins remain unchanged. See
[older statistical source evidence](../audits/2026-10-27-older-statistical-schedules.md).


October 27 v22 country/processing extension: four original country-status notices
are retained and paired with dated General Note 3. No schema, grant, rule approval,
quota policy or daily target changes. Current website and protected worker must
be released together when deployment is authorized; source captures alone do not
upgrade deployed calculations. Engine-refresh migration 20261027194112 remains
required. Request-local annual subsets retain at most 4 MB and preserve conflicts;
checkpoints save at most 25 new lines or every 30 seconds and flush before a timed
continuation. Usage limits remain enforced. The first browser attempt exhausted
its check allowance; the final isolated rerun and export pass with five total
admissions. Do not clear counters or reuse its now-revoked fictional credentials.
See [country/processing acceptance and limits](../audits/2026-10-27-ordinary-country-coverage.md).


October 28 v23: Column 2 uses separate original fields and shared deterministic
formulas. Current app and protected worker must be released together when deployment
is authorized. Existing engine-refresh migration remains required; no new migration,
grant, rule approval, quota change or daily target is introduced. Final isolated
actual-worker/browser acceptance and export pass with four admitted checks and
zero remaining fixture sessions. The first test UI hold expired and was cleaned
up; its revoked credentials were not reused. [Scope and release evidence](../audits/2026-10-28-column2-historical-duties.md).


October28 v29: dated statistical-code support requires matched app/worker release
when authorized; no deployment performed. Actual v28 retained separately for
upgrade acceptance. Read-only retained-source check:
`node --import tsx scripts/verify-ordinary-pilot.ts --dated-codes`.
No source capture, migration, grant, approval, quota or daily target change.
Real fictional acceptance verified correction/export and tenant denials, followed
by independent zero-active/zero-session cleanup. See
[v29 scope and verification](../audits/2026-10-28-dated-statistical-codes.md).


October28 v30: optional relatedArticleHts CSV/review data reuses existing immutable
JSON snapshots and dated evidence decisions. No migration/grant/source import or
reviewer authority change. Matched app/worker release is required when authorized;
no deployment performed. Read-only check:
`node --import tsx scripts/verify-related-article.ts`. Real isolated fixture
acceptance uses `--related-article-only`, verifies tenant denials and cleans up
identities; do not run against customer records. v29 remains separately retained.
[Scope and verification](../audits/2026-10-28-related-article-duties.md).


October28 v31:21 public CBP A201844 originals were captured (complete59-message
index and10deposit header/body pairs),with no shared approval or tenant writes.
Other49 message types require separate review; this is not a complete AD/CVD
legal engine. New audits keep bounded pinned sources; ambiguous versions fail
closed. Existing tables/grants/RLS remain,no migration or quota change.

Read-only: `npm run verify:historical-adcvd`. Parser/source tests:
`npm run test:adcvd`. Real isolated acceptance uses `--mexico-deposit-only
--engine-upgrade`,the actual preservedv30 worker and current matched app/worker.
Old outputs,source versions and declarations stay. Cleanup independently verifies
zero fixture sessions. No deployment performed; app and worker release together
when authorized. [Scope and next work](../audits/2026-10-28-mexico-deposit-instructions.md).

October28 v32: no schema,grant,review-authority,quota,source-capture or schedule
changes. Matched website/worker build is required when release is authorized;
no deployment performed. Corrections invalidate stale AD evidence; original
snapshots remain readable. Request-local Chapter99 cache shares existing4MB PDF
bounds and never stores failed/partial projections. Real isolated old31→32
acceptance uses `--mexico-evidence-only --engine-upgrade`; retain the actual old
bundle. Cleanup independently confirms zero active fixture users/sessions.
[Verification and boundaries](../audits/2026-10-28-evidence-corrections-and-reference-cache.md).

October29 v33: deliberate public-source capture retained70 CBP records for
A122857/C122858; all originals read back and hashes verify. No shared approval,
customer writes, schema/grant/quota/reviewer/schedule change. Matched local
website/worker build and real old32→33 acceptance pass; no deployment performed.
The isolated external node_modules symlink needs the previously used
`next build --webpack` for this local test setup. Production build compatibility
is not inferred from that local workaround. Read-only:
`npm run verify:historical-canada`. Test fixtures stay fictional, and their
identities are revoked/banned; independent cleanup confirms zeroactive/sessions.
[Scope and remaining work](../audits/2026-10-29-canadian-deposit-instructions.md).

October29 v34 local work: four public wood enactment/instruction originals were
captured and hash verified. No schema/grant/RLS/quota/reviewer/schedule change.
`npm run verify:historical-wood` is read-only; optional snapshot replay requires
exact input identity. Real isolated acceptance uses `--wood-only --engine-upgrade`
and the preserved actual33 worker. That old worker has27 incomplete totals in
the selected fictional baseline; preserve them rather than assuming100nulls.
Current calculations require explicit wood facts. Website/worker builds and
tests pass; saved/browser/export/tenant acceptance and cleanup pass.104fixture
users banned,0active/sessions; owned3132/3133 closed,main3000 remains. No deployment.
[Sources and limits](../audits/2026-10-29-wood-historical-duties.md).
