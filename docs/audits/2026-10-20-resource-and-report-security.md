# Saved-report trust, request quotas and upload limits — October 20, 2026

Three application boundaries are implemented; the two supporting migrations are
applied to the linked database. No app deployment, push, model request, production
load test, real reviewer appointment or customer-record modification was made.
Database tests use synthetic records inside rolled-back transactions.

## Saved reports: integrity is not execution provenance

A member could submit a made-up report and government-looking source body through
the Data API and still have valid content hashes. Hashes prove retained bytes;
they do not prove Cante computed a number or fetched a government URL.

The archive reader now returns `provenance`, raw `result`, and a separate
`verifiedResult`. Only an append-only protected attestation matching workspace,
check ID, original-input hash, terminal-event ID and terminal-event hash can fill
`verifiedResult`. Members cannot insert/update attestations. The trusted service
role may insert them; it is never added to hosted-request credentials. Its issuer
must independently verify/recompute the actual check, not rubber-stamp existing
workspace reports. The check ID also binds immutable declarations/engine metadata.

Chat reads only `verifiedResult` as computed history. Unattested report totals,
claimed source findings and caller-authored failure text are excluded from its
saved-result context and numerical baselines. Original CSV fields remain available
as explicitly user-supplied inputs. A fresh check can still calculate today's
result directly, but an unverified previous report cannot produce a claimed duty
change. Opening an unverified saved calculation also prevents it from becoming the
browser's next comparison baseline. History/export retains the raw record with
explicit trust metadata and visible warnings; no evidence is deleted or rewritten.

**No existing record was grandfathered as trusted.** The attestation registry is
empty, and this change does not connect a trusted worker or implement independent
verification inside that worker. Until that exists, saved numerical comparisons
are deliberately unavailable. Fresh calculation results are not affected. A
missing attestation table/read failure denies trust rather than guessing.

## Distributed admission budgets

`acquire_api_request` derives identity from `auth.uid()`, verifies workspace
membership and atomically checks user/workspace counters and active leases under
transaction locks. Counters and leases are private, RLS-enabled and not writable
by customer or worker API roles. Caller-selected limits/clock values are not
accepted. The same operation buckets are shared across endpoints and instances.

| Operation | User/hour | User/day | Workspace/hour | Workspace/day | Concurrent per user/workspace |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chat / mapping / classification / review retry | 30 | 100 | 120 | 400 | 2 |
| Official/live checks and import-impact evaluation | 6 | 20 | 12 | 40 | 1 |
| File extraction / product uploads | 20 | 60 | 60 | 180 | 2 |
| Duty lookup / single and bulk calculation | 60 | 200 | 240 | 800 | 4 |

Hour/day counters use fixed UTC windows. Valid but rejected/invalid application
requests consume admission budget once admitted. Releasing a lease never refunds
that budget. Workspace selectors in chat/product/classification requests are
verified through membership; selecting a different workspace also reserves that
workspace's operation budget after bounded body intake. This may conservatively
charge both admission and execution workspaces; it cannot grant more requests.

Request limits return 429 with Retry-After; database/configuration failure returns
503 and starts no expensive work. Stream permits last until completion. A client
cancel leaves its lease until the ten-minute expiry because background work may
still be unwinding; reconnect/disconnect loops do not free concurrent slots.
Upload intake has a 55-second abort signal, other guarded requests 280 seconds;
existing handler/provider deadlines and platform limits still apply. Stale leases
recover after expiry without activating any new schedule.

Chat CSV execution also reserves the shared check bucket, so sending a file or
saying “any updates?” cannot bypass the direct live-check limit. When a check is
rejected after chat streaming began, the stream reports the failure instead of
claiming that a check succeeded; outer request admission rejects before streaming.
Fictional paid demo chat also consumes admission budget without gaining customer
catalogue/memory context. Archived routes remain disabled.

These are **operation/volume budgets, not a dollar-denominated provider invoice
cap**. A model's price, token allowance, web tools and bounded worker call chains
still affect cost per admitted operation. Existing output-token limits remain.
Trusted CLI/worker tasks are separate operator-authorized workloads, not silently
placed behind customer HTTP quotas. Provider billing/WAF settings were not changed.

### Direct archive storage writes

INSERT triggers charge actual inserted input/source/event rows, including logical
metadata bytes. A workspace is limited to 256 MiB and 5,000 rows per UTC day plus
1 GiB of retained logical archive bytes overall. Existing retained bytes were
counted when initializing the lifetime budget. Exceeding a limit rolls back the
write/RPC atomically; no partial evidence package is claimed as saved. Customers
cannot reset counters or bypass the cap by calling the Data API. Increasing a cap
is an explicit administrative migration, not deleting immutable history to fit.
These caps concern the live-check archive, not every database table or Supabase's
own physical storage overhead. Byte deduplication is charged only for new rows.

## Upload rejection before parsing/allocation

The shared request guard counts actual incoming bytes before concatenating the
body and before `formData()`, JSON decoding or CSV parsing. Content-Length is only
an early rejection hint; absent or false headers do not bypass counting. Oversized
or aborted streams are cancelled. Buffers remain bounded by endpoint limits and
concurrent admission, rather than growing until multipart parsing completes.

- Chat body: 8,000,000 bytes; original CSV still limited to 1,000,000 bytes.
- Direct live-check body: 1,000,000 bytes; impact/bulk intake: 2 MiB.
- Multipart extraction/product intake: 15 MiB plus 64 KiB framing allowance.
- Each document: 15 MiB checked before `file.arrayBuffer()`; extraction CSVs:
  1,000,000 bytes, also checked before `arrayBuffer()`.
- Extraction accepts one file and rejects unexpected form fields.

This is bounded multipart buffering, not a streaming per-part parser. The global
multipart envelope is checked while receiving bytes; format-specific file limits
are checked after parsing that bounded envelope. Existing DOCX/XLSX expansion
limits remain. Platform/proxy limits may be lower and were not reconfigured or
verified. This does not claim to control buffering inside an upstream platform.

## Verification

- All **922 existing tests**, **121 focused regressions**, TypeScript and an
  isolated production webpack build passed. Build retains existing middleware/
  Edge-runtime warnings. The user's localhost process was left running.
- Actual quota-helper fixtures: 12 parallel requests admit two and reject ten;
  permission/database failures start no handler work; Retry-After, lease release,
  disconnect retention, false/missing Content-Length, aborts and exact byte limits.
- Oversized CSV/PDF handler fixtures reject before `File.arrayBuffer()` is called.
  Actual archive-reader fixtures reject self-declared trust, mismatched or missing
  attestations; unverified fake totals are absent from chat and duty comparisons.
- `supabase/tests/request_resource_quotas.sql` passed against the applied database:
  concurrency/hour/day denial, non-refundable counts, cross-tenant admission
  denial, private-counter protection, Data API storage denial, attestation
  self-forgery/update denial and cross-tenant proof isolation. All fixtures roll back.
- Read-only metadata confirmed both migrations, no real attested records, no
  authenticated attestation INSERT or quota-counter UPDATE, and no anonymous
  admission-function execution.
- Supabase advisors retain six warnings: five intentionally callable, guarded
  SECURITY DEFINER functions (review/capability/admission/release) and disabled
  leaked-password protection. This is not a clean advisor scan or full penetration test.
- Production-build browser fixtures verified unverified totals are hidden in
  history and the saved-calculator view, the original CSV can still be rechecked,
  and the 390px mobile layout has no horizontal overflow. The deliberately
  malformed untrusted result did not crash either screen. All API responses were
  isolated fixtures with worker/model credentials blank. Only the expected local
  Vercel Analytics 404/MIME warnings appeared; no functional runtime error was seen.
- Existing parser/calculator tests explicitly isolate admission; dedicated helper
  and database tests establish the new limits. No hosted-model spend was used.

Applied migrations: `20261021020322_request_resource_quotas.sql` and
`20261021020437_archive_report_provenance.sql` (CLI-generated UTC filenames).
**The application reader/HTTP guards must be deployed before these protections
can be claimed for the hosted app.** Database storage/attestation permissions are
already applied; an old deployed reader does not automatically gain trust checks.
