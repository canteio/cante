# Older statistical component schedules

October 27, 2026 · audit engine v21 · full historical coverage remains in progress.

## Implemented scope

The existing Chapter 91 component calculation path now uses retained original
schedules across 2000–2017. This extends v20's 2016/2017 support; it does not claim
all duties, countries or shipment dates are covered.

The authorized public backfill added 43 legacy edition records corresponding to
42 unique physical Chapter 91 PDFs for 2000–2015, plus two 2015 registry originals.
Four 2016/2017 originals were already retained: 48 unique Chapter 91 originals in
total. The publisher explicitly links the same PDF from both 2001 editions;
identical contiguous publication windows can share that original only when both
retained index links prove it. Archive pages 7, 8 and 9, raw edition indexes and
registry/details evidence remain pinned. No guessed PDF path or ignored release
parameter establishes an edition.

All 48 complete Statistical Note 1 reporting tables establish 293 component codes
each: 14,064 repeated edition/component records. Of these, 14,000 establish the
narrow formula contract at the sampled publication date; 64 remain unresolved.
These counts are source records, not distinct laws, verified shipments or legal
approvals. The inventory command intentionally exits unsuccessfully while those
64 issues exist; it is not an all-coverage passing check.

For 2000/2001, an annual file without printed rate text may use the complete
contemporaneous General-column formula, while retaining annual effective-date
bounds. It cannot borrow a later source. For a code established in Statistical
Note 1 whose ordinary General row cannot be projected, a complete dated annual
formula may supply the rate; the note projection explicitly has an empty General
rate and cannot invent one. Available conflicting General formulas still withhold
the calculation. Annual numeric sentinels never become rates.

PDF reading order tolerates only one point of printer baseline variation. Known
headers can contain internal whitespace; footnotes, column boundaries and whole
formula operators remain checked. Verified blank pages require bounded drawing-
operator inspection and reject image/vector content. Complete reporting contracts
are compared by their published meaning after each source's full table succeeds.

## Exact remaining source issues

Forty unresolved records repeat four eight-digit legal lines in specified editions:

- 2000–2003: 91011940 has missing formula operators/text in the retained originals.
- 2000/2001: 91091140 is missing a plus operator in the retained formula.
- Both 2005 editions: 91069055's annual text omits a battery charge present in General.
- 2009 Supplement 1 Revision 1: 91012940 has malformed/conflicting General text.

The other 24 are codes in the 2012 Basic publication without an applicable annual
interval at that publication date. This does not mean 24 universally missing laws:
later sources cover applicable later intervals. The public observational fixture
`legacy-watch-source-issues.json` records exact edition/code issues. It is not an
expected-rate oracle or approval. Missing operators and conflicting charges need
authoritative contemporaneous clarification; later convenient rates are insufficient.
A separate rendered-page inspection confirms the duplicated wording/operator in
the actual [2009 original, page 12](https://www.usitc.gov/sites/default/files/publications/docs/tata/hts/bychapter/0911c91.pdf); this instance is not merely a text-extraction error.

Retained original publication windows also leave these component-coverage gaps
(start inclusive, end exclusive):

| Year | Dates without a retained contemporaneous component original |
|---|---|
| 2007 | Jan 1–Feb 3 |
| 2012 | Jan 1–Feb 2 |
| 2015 | Jan 1–Jan 26; Jun 30–Sep 10; Dec 31–Jan 1, 2016 |
| 2016 | Jan 1–May 17; Jun 30–Nov 17; Dec 30–Jan 1, 2017 |
| 2017 | Jan 1–Feb 9; Jun 30–Oct 30; Dec 21–Jan 1, 2018 |

These are retained-source availability bounds, not assertions about when tariff
law changed. Continuous publication windows in other years do not establish every
shipment's qualification or all historical law. Ordinary countries beyond the
existing supported list, Column 2/preferences, conditional notes, other T/9/K/X
methods, combined-unit equivalents and the wider metals/AD/CVD/special-entry
ledger remain unfinished.

## Code and operations

- `scripts/backfill-legacy-annual-components.ts`: dry by default; explicit bounded
  government-original capture using actual archive/index links.
- `scripts/backfill-annual-schedule-chapters.ts`: 2015 registry identity support.
- `app/api/tariff/references/ordinary-contract.ts`: raw legacy identity proof and
  contiguous identical-file windows; original parent IDs remain pinned.
- `pdf-rates.ts`, `annual-data.ts`, `store.ts` in that directory: reporting tables,
  formula reconciliation, dated source selection and request-scoped caches.
- `app/api/audits/{model,compiled-reference,engine}.ts`: engine v21, readable older
  proofs and exact shared calculations with explicit component evidence.
- `components/audits/audit-workspace.tsx`: note-only evidence is labeled separately
  from a printed General rate in the existing review interface.

No schema, grant, reviewer appointment, dependency or new `lib/` module was added
in v21. The v20 calculation-refresh migration remains required. No deployment,
customer import, daily opt-in, delivery setting or automatic legal approval changed.
Release the website and protected worker together when deployment is authorized.

## Verification

`legacy-watch-workflow-entries.csv` and its independent expected-results JSON contain
100 fictional lines across all 18 years, with deliberately incomplete components,
conflicting declarations, paid-duty mistakes and dated evidence corrections.
Source-page fixtures are separately labeled public excerpts. Fictional evidence
references never establish real shipment facts or refund entitlement.

The source goldens pass 75 calculated/25 unresolved initially and 91/9 after eleven
supplied evidence decisions, with USD 19.09 potential overpayment and USD 0.36
potential underpayment. The existing 100-line component fixture also passes under
v21, including the two formerly uncovered 2014 lines. The 21 annual quantity cases
and 14 modern-source regression cases pass unchanged.

92 focused tests and 931 regression tests pass; TypeScript, isolated website and
actual worker builds pass. Mocked-worker checks are recorded separately from real
Auth/database/worker checks. A first launcher failed its generated JavaScript
before calculation; syntax is now checked before creating identities. A subsequent
completed real run passed actual v20→v21 execution, same-source refresh idempotency,
prior-result retention, export and company denials. Its temporary browser hold
expired cleanly; its identities were revoked/banned. The fresh latest-build run also passed and exited successfully. The browser
created a dated classification/count correction, recalculated and downloaded
the CSV. Independent database readback verified all 400 output records against
four protected run hashes: revisions 0/1/12/13 use v20/v21/v21/v21. Original
HTS 9109103010 and count 10 remain; the reviewed calculation uses 9109104010 and
20 NO for June 15, 2016 only. The published formula is USD 0.22 × 20 + 3.2% ×
USD 1,000 = USD 36.40, with USD 3.60 potential overpayment.

| Stage | Calculated | Unresolved | Potential overpayment | Potential underpayment |
|---|---:|---:|---:|---:|
| Initial v21 | 75 | 25 | USD 19.09 | USD 0.36 |
| Eleven supplied evidence decisions | 91 | 9 | USD 19.09 | USD 0.36 |
| Browser classification/count correction | 92 | 8 | USD 22.69 | USD 0.36 |

The final eight lines belong to deliberately incomplete and duplicate-component
groups; none has an invented expected amount or financial difference in the CSV.
Export checks verify all 100 lines, 92 calculated/8 blank expected amounts, exact
sums, original fields, corrected facts, components, citations and dated reviews.
The latest saved results of prior v16/v17/v20 fictional audits still pass their
protected output hashes. Original uploads and older run proofs remain retained.
These tests do not establish complete historical coverage or independent legal
accuracy.

The browser visibly signed out; owned tabs 35/36 closed. Final independent SQL
confirms 68 banned fixture accounts, zero active fixture accounts and zero
sessions. The test harness logged one failed administrative sign-out after the
browser had already revoked that session; zero-session SQL is the cleanup check.
Test ports 3132/3133 closed and the existing main PID 24938/port 3000 remained
running. No live v21 test process remains.

## Private receipts

Public originals and provenance are in Supabase; raw originals are also ignored
under `raw/tariff-references/older-components/`. No credentials/customer data belong
in tracked evidence. Local verification logs use `/tmp/cante-legacy-watch-*`;
source inventory is `/tmp/cante-legacy-watch-scope.json`. These temporary receipts
are observations from this revision, not deployment or independent legal validation.


Final local artifacts: `/tmp/cante-legacy-watch-{live-acceptance-complete,browser-proof,
export-proof,cleanup-verification}.log`; screenshot
`/tmp/cante-legacy-watch-audit-results.png`. Actual isolated website build:
`/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-watch-build-I0P0kg`.
Final fictional test artifacts remain at
`/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-audit-pilot-z9oE7J`;
credentials are revoked/banned. Never reuse these as customer fixtures.
