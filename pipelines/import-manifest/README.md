# Continuous import monitoring

A Cante feature at **`/import-monitor`** and **`GET /api/import-monitor`**, backed
by the repo-owned **`npm run imports:refresh`** worker. It extends the existing
CAMIR parser, commodity matcher and search scaffold.

## What is real, and what is blocked

1. **Live public shipment feed: blocked.** No free, legal, continuously
   reusable shipment feed was established in the 14 September 2026 research.
   ImportYeti's free website is not a keyless API; Census/USA Trade Online
   provide statistical trade data rather than identifiable importer shipments.
   No FOIA request, paid subscription or scraping was performed. See
   [research and sources](../../docs/import-data-pipeline.md).
2. **CAMIR M01/P01 header parsing: working against samples/files.**
   `loadRawManifestText()` now reads `CANTE_CAMIR_FILE`, with explicit errors
   for missing/empty/oversize files. The scaffold does **not** decode full
   bills of lading, H01, parties or cargo records. Header parsing must not be
   mistaken for a complete CAMIR shipment normalizer.
3. **Matching and persistent search: implemented.** Existing token overlap
   remains a research-candidate signal. New strict matching requires an exact
   case/punctuation-normalized CPSC `Importers.Name`, commodity overlap,
   explicit U.S. consignee address and manifest filed within 180 days. Recalls
   must also be within 180 days. HS chapter is a shipment filter, **not** a
   recall classification mapping. Name variants/DBAs and addresses without a
   U.S. country token can be missed; review the source before acting.
4. **Automation: implemented; installation is an operator step.** The worker
   fetches the official free CPSC API and reads a configured authorized JSON
   shipment export each run. Missing shipments still allow recalls to refresh,
   but the persisted status and exit code remain incomplete.
5. **Productization: implemented.** Authenticated UI/API, filters, pagination,
   provenance, discovery dates and coverage caveats. Samples never become leads.

**No live end-to-end shipment pipeline is claimed.** There is no authorized
shipment source configured by this change. The official CPSC endpoint is wired,
with HTTP/payload tests, but direct network verification in this restricted
session failed. Local native SQLite dependencies are also currently broken.

## Run on the trusted worker

Use the existing workspace ID from `customers`; do not create arbitrary tenant
IDs. The worker does not choose a default tenant.

1. Install dependencies using the repository's normal setup. For SQLite,
   restore the `better-sqlite3` native binding for the worker's Node version,
   then run `npm run db:push` to create `import_monitor_state`. For Supabase,
   apply `supabase/migrations/202609140001_import_monitor.sql` **after** the
   existing production migration. Do not reset either database.
2. Put these values in the worker's `.env` (the existing loader reads it):

   ```dotenv
   CANTE_IMPORT_CUSTOMER_ID=<existing-customer-id>
   CANTE_DATA_BACKEND=sqlite
   CANTE_IMPORT_SHIPMENTS_FILE=/absolute/path/to/cante/import-data/shipments.json
   ```

   For production, use `CANTE_DATA_BACKEND=supabase` and the existing worker-only
   `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY`. The worker writes directly
   to Supabase; this state is not included in `sync-supabase.ts`. Hosted UI/API
   reads use the signed-in session and RLS, never the worker secret. Do not run
   independent SQLite and Supabase workers for the same monitoring workspace.
3. Run `npm run imports:validate` first. It checks the configured snapshot's
   complete contract without contacting CPSC or writing customer storage; pass a
   one-off path with `npm run imports:validate -- /path/to/shipments.json`.
   Then run `npm run imports:refresh`. Leave the shipment path unset to record
   the blocker while refreshing real recalls. To inspect sample ingestion, point
   it at `pipelines/import-manifest/fixtures/sample-export.json`; this is
   visibly synthetic and produces zero importer leads.
4. Open `/import-monitor` while logged in. Use Cargo, Shipper country,
   Importer and Evidence filters. The default lists named CPSC importers;
   selecting commodity overlap shows explicitly labelled research candidates.
5. Create `raw/`, then install the line from
   [`scripts/crontab.example`](scripts/crontab.example) in the worker's crontab
   after replacing the repository and Node paths. It runs daily at 07:20 in
   the worker's timezone. The checked-in schedule is not silently installed.
   Set up your process monitor to flag nonzero exits; log redirection alone
   does not provide an outage notification.

Exit codes: **0** = both refreshes succeeded with shipment observations no more
than seven days old; **2** = blocked, sample, stale shipment data, or feed
failure; **1** = configuration, persistence or concurrency failure. New
importer/recall discoveries are persisted and printed to stdout; no messages
are sent to customers or prospects. The UI reports worker results older than
two days as stale, even when the process last exited successfully.

## Authorized normalized export contract

This is a **working file adapter**, not a manufactured free data source. The
operator must supply data they are authorized to use. The worker consumes one
complete rolling snapshot, not incremental deltas: publish files by atomic
rename and retain the desired 180-day activity window. It replaces the prior
shipment snapshot on a successful read. Missing/malformed files retain prior
rows with a failed source status. A valid empty array clears the current rows.

```json
{
  "sourceType": "authorized_export",
  "sourceRef": "your-source-and-release-reference",
  "observedAt": "2026-09-14T00:00:00.000Z",
  "shipments": []
}
```

The empty example deliberately contains no invented live shipments.
[`fixtures/sample-export.json`](fixtures/sample-export.json) demonstrates fields
with unmistakably synthetic data. `monitor/model.ts` defines the validated
contract. Each shipment requires `billOfLading` and boolean `dataRedacted`;
other supported fields default to null. Dates are real `YYYY-MM-DD` dates;
country codes are uppercase two-letter codes; HS chapters are two digits.
`observedAt` describes source freshness, not the time you reread the file.
No country or filing date is guessed. Stable row IDs use source reference,
carrier and B/L. Use a stable source reference across snapshots to preserve
identity. Duplicate identities are rejected. Limits: 20 MB input and 5,000
shipments; oversize exports fail explicitly rather than truncating.

If the eventual delivered source is raw CAMIR, a complete decoder still needs
implementation against that actual delivery format. Do not label the existing
M01/P01 samples a complete CAMIR parser. A producer capable of the normalized
JSON contract can use the worker immediately without that decoder.

## Storage, failure handling and interpretation

`lib/db/schema.ts` adds a tenant-owned `import_monitor_state` Drizzle table;
the matching Postgres migration grants members read access via existing tenant
RLS and grants writes only to the trusted worker. One atomic JSON snapshot
contains the shipment rows (the existing `ImportShipmentRow` shape), CPSC
records, source states, matches and discovery history. The standalone
`schema/shipments.ts` table is still a shape definition, not a second store.
This intentionally bounded store is suitable for small workspace exports,
not a national-scale manifest archive or indexed millions-of-rows search.

Each source refresh runs independently. Failures retain the prior successful
source's data and observation timestamp, not a fake zero-record success.
Matching uses retained evidence with caveats, but incomplete runs cannot
announce new leads. Compare-and-swap revisions reject competing cron writes.
Discovery deduplication is importer + recall, so another B/L for the same
importer does not announce it again. Current matches expire on refresh **and**
query; first discovery history survives source outages and expiry.

A named match does not establish that the specific shipment contains recalled
units. Product-word matches alone never establish the importer was recalled.
"Active" means recent manifest filing, not completed arrival or ongoing sales.
Shipper country is not necessarily manufacturing origin. Redaction, missing
names, absent countries and incomplete cargo descriptions reduce coverage.

## API

```text
GET /api/import-monitor?cargo=stroller&country=CN&kind=named_importer&limit=50&offset=0
```

Also accepts `importer` (substring), `hsChapter`, and
`kind=commodity_candidate|all`. Filters combine with AND semantics. `limit` is
1–100; offsets are 0–100000. Invalid parameters return 400, missing workspace
auth returns 401, storage failure returns 503. Middleware also protects the
page and API. Requests cannot choose another tenant: the API resolves the
session's workspace. The response includes `status`, `sources`, `updatedAt`,
`caveats`, `total`, and paginated `results`; blocked/failed sources include an
operator-safe `nextAction` recovery step. Responses are private/no-store.

Runnable curl examples (an agent still needs a logged-in session cookie —
this is a workspace-scoped endpoint, not a public API key; swap `$COOKIE` for
your authenticated `Cookie:` header value). These mirror the worked examples
already embedded in `/api/import-monitor/openapi` so an agent can copy either
one and get a consistent shape back:

```sh
# Default query: named-importer leads only, first page.
curl -s -H "Cookie: $COOKIE" \
  "https://<host>/api/import-monitor" | jq .

# Narrow to strollers shipped from China, including commodity-overlap
# candidates (not just exact CPSC-name matches) — see the `kind` caveat
# in the response before treating a candidate as a confirmed lead.
curl -s -H "Cookie: $COOKIE" \
  "https://<host>/api/import-monitor?cargo=stroller&country=CN&kind=all" | jq .

# Page 2 of up to 100 results.
curl -s -H "Cookie: $COOKIE" \
  "https://<host>/api/import-monitor?limit=100&offset=100" | jq .

# Discover the full parameter/response contract without a session at all.
curl -s "https://<host>/api/import-monitor/openapi" | jq .
```

## Verification

```sh
npm test
node --import tsx --test pipelines/import-manifest/**/*.test.ts
npx tsc --noEmit
```

`npm test` now includes pipeline tests. It uses Node's `--import tsx` runner
rather than tsx CLI's IPC server, which this restricted environment disallows.
Tests cover input validation, real SQLite persistence via Node's SQLite engine,
Supabase request scoping/CAS/error paths, recentness, identity versus commodity
matching, sample exclusion, blocked/outage retention, duplicate discoveries,
tenant isolation, pagination, expiry, and concurrent writes. Postgres RLS must
also be verified against the deployed migration with actual user sessions;
no remote database credentials were used in this development session.

Validation recorded in the restricted development session (14 September 2026):
all **40 pipeline tests pass**; full `npm test` is **258 pass / 79 fail**, up
from 218/79 because pipeline tests now run with the main suite. The same 79
failures concern the existing `better-sqlite3` native dependency. `npx tsc
--noEmit` reports only the pre-existing null-title fixture errors at
`lib/impact/codes-mentioned.test.ts:27` and `:64`. `npm run build` cannot finish
because the environment cannot resolve Google Fonts for the existing layout.
The new PostgreSQL migration and UI have not been exercised on a deployed
Supabase/Vercel instance.
