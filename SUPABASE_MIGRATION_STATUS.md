# Supabase migration — incomplete working-tree checkpoint

This is a partial migration, not a deployable completion of the requested conversion.
No commit, push, live database writes, or migration resets were performed.

## Exact changed files

- `lib/db/queries.ts`: removed 19 SQLite fallback branches, retaining their established Supabase implementations. Converted the SQLite-only `reapStaleRuns` and `getSeenRegulations` functions. All database access in this file now uses the existing cookie-backed `createClient` from `lib/supabase/server.ts`. Auth-mode selection in `resolveCustomerId` remains unchanged. The stale-run update filters by running status at write time.
- `lib/checks/run.ts`: awaits the now-asynchronous stale-run query. The remainder of this worker still uses SQLite and is not migrated.
- `SUPABASE_MIGRATION_STATUS.md`: this checkpoint and schema inventory.

Deleted files: none. Dependencies and lockfile: unchanged.

## Verification

- `npm test`: FAILED, 695 tests, 683 passed, 12 failed, 0 skipped, 0 cancelled.
- `npx tsc --noEmit`: PASSED.
- `npm run build`: PASSED (existing Next.js middleware deprecation warning).
- `git diff --check`: PASSED before this documentation addition.

The failing route tests still call handlers directly and initialize SQLite fixtures. The retained Supabase client requires a Next.js cookie request scope and a real authenticated Supabase session. Failures include `cookies was called outside a request scope` and corresponding HTTP 500 responses. These failures are unresolved, not skipped or replaced with mocks. The passing tests do not establish that the new queries work against a real Supabase database.

## Database access blockers

No `.env.test`, CI test database setup, or local Supabase configuration was found. The linked-project metadata is present, but `DO_NOT_TRACK=1 npx --no-install supabase migration list --linked` reports `Access token not provided`. Local `supabase status` reports Docker and Podman unavailable. A read-only request to the configured Supabase REST endpoint fails with `ENOTFOUND` in this session. `DO_NOT_TRACK=1` avoids the CLI's otherwise-blocked telemetry write outside the workspace.

No disposable test schema was created; no tests have been converted to a real Supabase harness. Live table definitions, migration application status, types, constraints, and RLS behavior remain unverified.

## Schema source audit

Compared all 32 `sqliteTable` definitions exported by `lib/db/schema.ts` (using Drizzle table metadata) against CREATE TABLE statements in every `supabase/migrations/*.sql` file. All 357 column names are represented; there are no missing table or column names in the checked-in migrations. This is a name-coverage check, not a claim that the live database matches or that SQLite/Postgres types and constraints are equivalent.

The first 31 tables below are declared by `202608230001_cante_production.sql`; `import_monitor_state` is declared by `202609140001_import_monitor.sql`. No schema was invented or modified.

| Table | Column names checked | Missing names |
| --- | ---: | --- |
| `alerts` | 11 | None |
| `chat_messages` | 6 | None |
| `check_runs` | 7 | None |
| `checklist_items` | 21 | None |
| `component_substances` | 8 | None |
| `conversations` | 6 | None |
| `customer_profiles` | 11 | None |
| `customers` | 5 | None |
| `document_findings` | 14 | None |
| `finding_actions` | 13 | None |
| `findings` | 13 | None |
| `impact_assessments` | 22 | None |
| `import_monitor_state` | 3 | None |
| `jurisdiction_profiles` | 19 | None |
| `kbli_records` | 15 | None |
| `memories` | 9 | None |
| `product_classifications` | 15 | None |
| `product_components` | 11 | None |
| `products` | 15 | None |
| `regulation_links` | 9 | None |
| `restricted_substance_entries` | 7 | None |
| `restricted_substance_lists` | 7 | None |
| `screening_results` | 11 | None |
| `source_documents` | 9 | None |
| `source_packs` | 9 | None |
| `source_results` | 9 | None |
| `sources` | 10 | None |
| `substances` | 6 | None |
| `supplier_documents` | 12 | None |
| `suppliers` | 11 | None |
| `trade_documents` | 11 | None |
| `trade_lanes` | 22 | None |

`lib/db/schema.ts` is not dead: the Supabase implementations in `queries.ts` still use its inferred `Customer`, `CustomerProfile`, `JurisdictionProfile`, `Source`, `CheckRun`, `Finding`, `Alert`, `Conversation`, `ChatMessage`, `Memory`, and `ChecklistItem` types. Other unconverted modules also still use its runtime SQLite table objects. Consequently `lib/db/client.ts`, Drizzle, and better-sqlite3 have not been removed.

## Remaining scope and behavior limitations

- Convert the remaining SQLite-only operating modules and their callers to asynchronous Supabase operations. Several have no existing cloud branch to retain.
- Remove the remaining backend branches and `CANTE_DATA_BACKEND`, without changing `CANTE_AUTH_MODE`.
- Migrate worker execution, delivery, seed/sync scripts, and the import-monitor store outside `app/` and `lib/` before removing the SQLite client/dependencies.
- Preserve transaction semantics where SQLite currently uses transactions; separate REST calls are not an atomic replacement.
- Build and execute disposable real Supabase fixtures, authenticated request sessions, cleanup, and tenant-isolation tests.
- Confirm the live schema and run all required checks again after completing the migration.

This partial state changes data access for all callers of `queries.ts`. The local worker still writes SQLite but now invokes cookie-backed Supabase queries, and therefore is not operational as a standalone CLI in this checkpoint. Demo mode no longer gains a default customer from SQLite; Supabase session/RLS requirements apply to the migrated queries. These are unfinished migration issues, not supported final behavior.

Remaining matching TypeScript files (includes tests and modules outside the initial search scope):

- `app/api/chat/route.ts`
- `app/api/checks/route.ts`
- `app/api/documents/route.ts`
- `app/api/import-monitor/route.ts`
- `app/api/products/route.ts`
- `app/api/workqueue/route.ts`
- `lib/auth/config.test.ts`
- `lib/auth/config.ts`
- `lib/catalogue/classifications-openapi.test.ts`
- `lib/catalogue/classifications.ts`
- `lib/catalogue/lanes-openapi.test.ts`
- `lib/catalogue/lanes.ts`
- `lib/catalogue/openapi.test.ts`
- `lib/catalogue/products.test.ts`
- `lib/catalogue/products.ts`
- `lib/chat/attachments.ts`
- `lib/checks/checklist-request.test.ts`
- `lib/checks/checklist.ts`
- `lib/checks/lifecycle.ts`
- `lib/checks/openapi.test.ts`
- `lib/checks/remember.ts`
- `lib/checks/run.ts`
- `lib/checks/runs-openapi.test.ts`
- `lib/checks/source-changes.test.ts`
- `lib/checks/source-changes.ts`
- `lib/classification/suggest-openapi.test.ts`
- `lib/classification/suggest.ts`
- `lib/conversations/openapi.test.ts`
- `lib/customers/openapi.test.ts`
- `lib/db/client.ts`
- `lib/delivery/delivery.test.ts`
- `lib/delivery/dispatch.ts`
- `lib/documents/audit.ts`
- `lib/documents/files-extract-openapi.test.ts`
- `lib/documents/onboarding-website-openapi.test.ts`
- `lib/documents/openapi.test.ts`
- `lib/impact/assess.ts`
- `lib/impact/impact.test.ts`
- `lib/memories/openapi.test.ts`
- `lib/profiles/openapi.test.ts`
- `lib/screening/persist.test.ts`
- `lib/screening/persist.ts`
- `lib/substances/bom.ts`
- `lib/substances/openapi.test.ts`
- `lib/suppliers/evidence.ts`
- `lib/suppliers/openapi.test.ts`
- `lib/tariff/openapi.test.ts`
- `lib/test-support/operating-db.ts`
- `lib/workflow/actions.ts`
- `scripts/refresh-import-monitor.ts`
- `scripts/sync-supabase.ts`
- `pipelines/import-manifest/monitor/store.test.ts`
- `pipelines/import-manifest/monitor/store.ts`
