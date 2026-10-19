# Live-check history and captured source versions

October 18, 2026. Implemented locally on `dev`; the archive database migration is
applied to the linked project. The application was not deployed and no schedule,
model call or notification delivery was enabled.

## What is retained

Accepted `/api/tariff/live-check` inputs are saved before any government fetch:
original UTF-8 CSV, sanitized display filename, explicit importer confirmations,
compiler contract and build identity. Local unversioned builds are explicitly
labelled `unversioned-working-tree`, not falsely attributed to a release.

A check's terminal event contains its original deterministic result and source
observations. Government response bodies deduplicate by workspace, URL and SHA-256;
changed bodies create additional versions instead of replacing old ones. PDF bytes
are retained as base64 with an original-byte hash. Each check keeps its own fetch
timestamps and version references even when the source body is shared. Result
and source-version inserts commit atomically through an authenticated invoker RPC.

Failed checks retain their captured evidence and an error event when persistence
is available. A runtime terminated before final persistence leaves an incomplete
record, not a success. Initial-save failure prevents the fetch entirely. A final
save failure is visible and never emits a claimed saved result.

Review decisions append attributed, timestamped notes: reviewed, needs information,
broker review or superseded. They do not approve tariff rules, modify the original
result or clear unresolved duty components. Original inputs, events and source
bytes are hash-verified on retrieval/export.

## Interface and boundaries

`/tariff/history`, linked from the sidebar and live-check page, provides paginated
saved checks and captured source versions. It supports original-result reopening,
original CSV/confirmations, review timelines and full evidence download. Reopened
results do not refetch today's rules. Running another check creates another record.
Comparisons require identical inputs/facts and complete comparable calculations;
object key order in persisted JSON is normalized for comparison.

The capture timestamp is not a legal effective date. This is an archive of checked
sources going forward, not every law, every historical amendment or a comprehensive
historical legal-date lookup. Earlier unsaved checks are not backfilled. Government
feed captures are evidence of listings, not automatic legal interpretation.
Standalone calculator previews are not saved as live-check records; historical
entry audits retain their existing separate persistence path.

## Persistence controls

Migration `20261018050226_tariff_check_archive.sql` adds:

- `tariff_check_records`: original immutable input and engine metadata.
- `tariff_source_versions`: immutable, tenant-owned source bodies.
- `tariff_check_events`: immutable terminal events and appended review decisions.
- `complete_tariff_check`: security-invoker/RLS transaction for evidence and result.

Workspace membership controls reads. Owner/admin/member roles can create records
and reviews; viewers cannot. Actor/time defaults are database-authored and cannot
be supplied through authenticated insert grants. UPDATE/DELETE privileges are
absent, mutation triggers also reject accidental privileged application writes,
and parent-workspace deletion is restricted while records exist. Request handlers
use the authenticated session and publishable key, without a service-role key.

This is database-enforced append-only application history, not certified WORM
storage or protection against the database owner changing schema/triggers. Hashes
can detect accidental/tampered content against stored hashes; they are not an
externally anchored signature or independent proof of government authenticity.
Tenant-uploaded API submissions cannot become globally approved calculation rules.
Backup governance, retention certification and comprehensive legal coverage are
separate work.

## Verification

- New migration applied successfully to an isolated PostgreSQL 14 database first.
- `supabase/tests/tariff_check_archive.sql` passed locally and on the linked real
  database. Its fixtures rolled back. It tests original Unicode CSV/hash/attribution,
  actor/time forgery denial, anonymous and cross-tenant denial, viewer read-only
  access, deduplication, preserved changed versions, terminal uniqueness, retained
  review corrections and mutation rejection, including a privileged accidental edit.
- 29 focused handler, source-refresh and archive-integrity tests passed. Integrity
  tests reject changed input/result/source bytes and missing evidence, and ensure
  failed checks export captured sources without inventing completed results. A
  261-event history test verifies pagination past database response limits.
- 88 existing stack, single/bulk route and business-impact tests passed.
- TypeScript and an isolated production webpack build passed.
- A real authenticated upload in a temporary isolated workspace saved two worked
  examples, $4,150 + $5,900 = $10,050, and nine distinct government-source bodies.
  Values/qualifications were hypothetical; rates came from actual official fetches.
  No model/admin keys were present in the hosted test server. Real history APIs
  reopened the original CSV/result, retained multiple review notes and exported
  source bodies whose hashes independently matched. Anonymous access returned 401.
- A real interrupted HTTP check produced a failed event and retained its captured
  source observation; its completed result stayed null.
- Actual desktop/mobile browser checks verified saved-result reopening, a persisted
  review note, original-evidence download, source-version navigation and no
  horizontal overflow. A tab-switch bug found during testing was fixed: old check
  rows are cleared before rendering the source tab. Final checks passed both ways.
  Existing local Vercel Analytics requests still logged 404/MIME errors.
- Temporary QA records were removed by narrowly scoped administrative maintenance
  after validating their auto-provisioned workspace/user ownership. Mutation guards
  were restored within that same transaction. The QA workspace/user and local QA
  servers were removed afterward; the user's existing localhost server was retained.

Ignored local evidence is under `raw/check-archive/`: authenticated exports,
interrupted-check export, browser export, screenshots and verification runners.
`npm run test:archive` reproduces the offline handler/integrity tests. Run the SQL
suite only with an administrative connection; it always rolls back its fixtures.

The security advisor reported no archive-specific issue. It still reports existing
warnings for two authenticated stacking-review SECURITY DEFINER functions and
password leak protection being disabled. Those settings were not changed here.
See [function advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
