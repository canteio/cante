# Chat CSV → saved official-source check

Implemented October 19, 2026 on `dev`. No commit, push, deployment, migration,
schedule, notification delivery or worker activation was performed.

## Behavior

Sending a CSV in Ask Cante now connects the existing live tariff checker to chat:

1. Extraction returns a bounded text preview **and a separate complete UTF-8
   original**. BOM, CRLF, Unicode and rows beyond the 20,000-character preview
   survive unchanged. Non-UTF-8 and over-1-MB CSVs are rejected explicitly.
   Attaching alone does not persist; sending does.
2. The chat handler verifies workspace access, saves the complete original through
   the existing append-only archive, and then parses/checks it. It never checks a
   truncated preview in place of the original. Older clients must reattach their
   file if the complete original is absent.
3. The existing engine fetches supported official tariff sources, computes duties
   deterministically and performs its bounded previous/current rule comparison.
   Importer declarations come from CSV fields, not the model. Missing codes,
   values, scope and qualification facts are not inferred.
4. Government evidence and the final result commit before a successful report is
   claimed. Invalid inputs retain their original CSV and a failed-check record.
   Failed/interrupted checks retain evidence when possible and never become a
   fabricated successful calculation. Failure to save the terminal status leaves
   an explicitly incomplete record.
5. Chat streams real check-stage updates, then shows a deterministic report with
   product counts, duty or an unresolved total, candidate review groups, the first
   missing-fact action, and an exact saved-record link. This report is persisted
   separately before optional AI explanation. A file-only message requires **no
   model completion**, and can work even when the hosted model is unavailable.
6. Subsequent conversations load the latest three checks from the same workspace,
   including every parsed product group and explicit missing facts. Original-field
   excerpts prefer SKU/entry identifiers mentioned in the question. Excerpts are
   capped at twenty rows/6,000 characters per check, fields at 200 characters.
   Detailed report context has a 30,000-character threshold; larger reports fall
   back to all product groups with detailed evidence left in the saved record.
   Omission/truncation is disclosed, never presented as complete recall.

The chat accepts one CSV per message and up to five total attachments, with a
bounded request body. Named product CSVs may still use the existing catalogue
importer; historical ledgers do not repeatedly overwrite catalogue products with
old entry values. Parsed live-check products remain available in the saved check
even if no named catalogue product can be imported. Supplied classifications do
not silently become approved legal classifications.

## Code

- `app/api/files/extract/route.ts`: complete original versus preview; size/UTF-8
  validation. Discovery contract updated with optional `originalCsv` and 413.
- `app/api/chat/csv-check.ts`: authenticated orchestration, existing archive and
  engine, deterministic report, bounded tenant-scoped saved context. No new `lib/`
  module or database schema was introduced.
- `app/api/chat/route.ts`: bounded intake, streamed stages, durable report before
  optional explanation, saved-check context on future turns.
- `components/chat/chat-panel.tsx`: preserve original field, render stage updates.
- `components/tariff/check-history.tsx`: `?check=<id>` opens the exact record.
- `scripts/test-chat-csv.test.ts`: extraction, orchestration and actual chat-route
  tests with isolated provider/storage/engine fixtures. `npm run test:chat-csv`.

Request paths use the authenticated Supabase client and existing tenant RLS,
never worker/admin keys. The earlier archive-integrity and database-permission
tests remain applicable. A read-only query against the configured project
confirmed the archive/event tables and authenticated read/RPC privileges exist;
it did not read or alter customer records.

## Verification

- Full existing suite: **922 passed, 0 failed**.
- Final focused CSV/history/archive/remedy suite: **55 passed, 0 failed**.
- Existing attachment/provider/extraction regression subset: **24 passed**.
- TypeScript and `git diff --check`: passed.
- Final production webpack build in an isolated checkout: passed, using dummy
  public configuration and no provider/admin keys.
- Browser fixtures on the isolated production app verified real file extraction,
  transmission of the complete CSV including CRLF, stage/result rendering,
  completion, mobile layout without horizontal overflow, and exact saved-record
  reopening. The first deep-link assertion waited in the originating chat tab;
  existing Markdown links open a new tab. Selecting the actual opened record and
  intercepting fixture responses at context scope verified the flow. This was a
  harness correction, not a hidden application fix.
- No paid model call, live customer upload, fresh authenticated government-check
  persistence run, or real-customer legal-accuracy validation was performed for
  this connection. New integration tests exercise the actual orchestration/route
  against fixture dependencies; prior audits document the underlying live engine
  and archive verification separately.
- An initial build command briefly started in the shared checkout and was stopped;
  final builds used the isolated copy. The existing localhost:3000 process remained
  running and its homepage responded successfully.

Local screenshots are ignored under `output/playwright/`; no auth state or real
customer data was added to public assets.

## Remaining limits

This connects **on-demand CSV tariff checking**, not every compliance track or a
background monitoring subscription. Unsupported tariff rules and conditional
facts still withhold totals. A publication or candidate code match is not confirmed
legal applicability. Historical entry values are repriced under today's rules,
not silently annualized or treated as a refund audit. Saved context is bounded;
complete originals/evidence remain in Check history. Corrected facts need a new
check/upload; ordinary follow-up questions read stored results. **October 20
follow-up:** explicit update requests now trigger a fresh saved-CSV recheck; see
[verification](2026-10-20-chat-news-refresh.md). They remain distinct from ordinary
questions and do not silently activate background monitoring. Existing dependency
security findings are unchanged.
