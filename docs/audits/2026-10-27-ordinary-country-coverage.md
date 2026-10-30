# Older ordinary-country coverage and dated NTR changes

October 27, 2026 · audit engine v22 · full historical coverage remains in progress.

## Implemented scope

The existing 2000–2017 ordinary-duty compiler now recognizes 48 named declared
origins, including Canada, Mexico, all 27 current EU members, Switzerland and
Liechtenstein. EU membership is not used to grant a preference: each country is
assessed independently under the dated General Note 3 and explicit ordinary-scope
declaration. This is a bounded country vocabulary, not worldwide origin coverage
or verification of a shipment's legal origin/historical reporting code.

The complete retained Column 2 country list and its known footnote must match.
Unknown additions, missing listed countries, duplicate entries, ambiguous headings
and changed footnote wording withhold the country contract. The 2007 footnote is
physically after the following Column 1 text; its exact complete cross-reference
is checked rather than discarded. All 25 retained General Notes originals across
18 years establish the current contract. Only 43/44/45/47/48 origins are eligible
in the respective baseline lists; explicit in-year actions then resolve the named
country transitions. Earlier results are never rewritten.

Four immutable Federal Register originals were captured in Supabase and connected:

| Declared origin | Normal Column 1 treatment begins | Original publication |
|---|---|---|
| Vietnam | December 10, 2001 | [01-30961, December 17, 2001](https://www.govinfo.gov/content/pkg/FR-2001-12-17/pdf/01-30961.pdf) |
| Afghanistan | June 6, 2002 | [Proclamation 7553 / 02-11487, May 7, 2002](https://www.govinfo.gov/content/pkg/FR-2002-05-07/pdf/02-11487.pdf) |
| Serbia and Montenegro | December 4, 2003 | [Public Notice 4526 / 03-28438, November 13, 2003](https://www.govinfo.gov/content/pkg/FR-2003-11-13/pdf/03-28438.pdf) |
| Laos | February 4, 2005 | [05-2723, February 11, 2005](https://www.govinfo.gov/content/pkg/FR-2005-02-11/pdf/05-2723.pdf) |

Afghanistan's date is thirty calendar days after publication; Serbia/Montenegro's
notice identifies notification to Congress and the resulting restoration date.
Vietnam and Laos start before their notices' publication dates. Capture, signing
and publication timestamps do not replace these operative dates. Original-page
renders were inspected separately from the text tests.

A transition-year estimate requires one exact original notice, its operative
clauses and the complete normalized page-text contract. Extra/changed wording
cannot retain an old contract merely because one familiar sentence remains.
The text hash guards contract content; it does not establish government-fetch
provenance, independent legal approval or worker execution authority. Source
originals are separately hash-verified; protected worker attestations establish
execution. These remain labeled Cante-validated reference estimates.

The compiler intersects the annual rate's legal interval with the appropriate
side of the country transition. Sources for all relevant transition years are
pinned at upload/refresh, so an evidence-backed origin correction can use its
required original. Each result cites only its applicable sources. Original
country lists, declared entries, source versions and earlier calculation runs
remain available. No supplier location or preferential qualification is inferred.
Historical CS/YU codes and other countries/territories remain separate coverage.

## Implementation

- `app/api/tariff/references/ordinary-contract.ts`: complete country-list/footnote
  contract; bounded name vocabulary; original-notice contracts; dated per-entry
  country decisions.
- `app/api/tariff/references/store.ts`: year-scoped original selection, request-
  scoped original/text caches, visible failed country evidence and cited source IDs.
- `app/api/audits/compiled-reference.ts`: reuses the shared calculation engine,
  includes operative sources and bounds the compiled rate interval.
- `app/api/audits/engine.ts`: specific country/column review reasons; missing or
  unsupported treatment never becomes a zero or today's rate.
- `components/audits/audit-workspace.tsx`: country-change date and original notice
  appear within the existing finding; inapplicable MFN scenarios are hidden for
  country-review findings. No new navigation or configuration workflow.
- `app/api/audits/model.ts`: v22; earlier v1–v21 results remain readable.
- `scripts/backfill-ordinary-tariff-notes.ts --country-actions`: dry by default;
  explicit `--write` captures the four originals without approvals or tenant writes.
- `scripts/verify-ordinary-pilot.ts --country`: real-source goldens and CSV checks.
  The existing default 120-entry negative/positive fixture remains supported.

No new service, dependency, `lib/` module, schema, grant, reviewer appointment,
daily target or deployment is introduced. The existing scoped engine-refresh
migration remains required. Website and protected worker must be released together
when deployment is authorized; the current builds are local acceptance evidence.

## Exact procedure inventory

The read-only annual inventory now preserves all special computation-method
records in `/tmp/cante-annual-procedure-inventory.json` instead of reporting only
methods 1–6. Across retained 2000–2017 originals it finds 3,964 repeated annual/
effective-date source records:

| Method | Source records | Chapters |
|---|---:|---|
| T: statistical-level procedure | 2,434 | 26: 122; 90: 9; 91: 2,230; 93: 73 |
| 9: derived-duty procedure | 1,006 | 21, 22, 58, 61, 62, 82, 90, 91, 96 |
| K: special sugar procedure | 256 | 17 |
| X: other special procedure | 268 | 17, 78, 90, 91 |

The respective unique eight-digit lines number 103/51/15/12; codes can change
method across records. These are not shipment outcomes or independent legal
rules. The Chapter 91 records are not directly comparable to v21's 14,064 repeated
edition/component contracts, and must not be subtracted from them.

The quality pass accounts for all 278,074 retained records: 235,645 ordinary
chapter records and 42,429 Chapter 98/99 records; 21 ordinary records lie outside
their captured file year. No invalid/reversed intervals or unknown method codes
occur in this inventory. This source-record accounting is not legal coverage.

The numeric-fields-only methods 1–6 baseline remains 25,706 records: 18,117
formula contracts, 2,415 printed-formula/unit/precision issues and 5,174 other
footnotes. This scan does not run the later original-schedule corroboration,
therefore those baseline counts are not a current engine-wide unresolved total.

## Verification and limits

The 100-line fictional fixture spans all 18 years, the 48 named origins, both
sides of each original NTR transition, preferential claims, origin discrepancies
and deliberately unsupported countries/columns. All real-source expectations
match, using 55 pinned sources and no model calls or tenant writes.

| Stage | Calculated | Unresolved | Potential overpayment | Potential underpayment |
|---|---:|---:|---:|---:|
| Initial v22 | 87 | 13 | USD 150.00 | USD 145.00 |
| Supplied dated origin decision | 88 | 12 | USD 160.00 | USD 145.00 |
| Browser dated origin correction | 89 | 11 | USD 170.00 | USD 145.00 |

87 focused tests (including cache/checkpoint cases), 931 regressions, TypeScript and isolated website/worker builds
pass. Mocked-worker authentication/checkpoint tests are separate from the real
Auth/database/actual-worker test. The existing 120-entry ordinary source fixture
passes unchanged. A temporary verifier assertion initially rejected its intentionally
invalid rows; the assertion now applies only to the new valid-input fixture.

The real old-v21→v22 upgrade passes on unchanged pinned source IDs, with the old
null result retained and the new Canada duty USD 40.00. Repeated pending refresh
is a no-op; foreign-company HTTP refresh and direct RPC are denied. Final browser
origin correction/export and independent cleanup are recorded below.

The source fixture intentionally leaves pre-NTR Column 2 calculations open,
plus US/Puerto Rico special-entry treatment and a claimed NAFTA preference.
Other origins, historic code aliases, Column 2 computation, preference qualification,
remaining T/9/K/X procedures, conditional units/notes, other Section 232, broader
AD/CVD and special entries remain in the full completion ledger. Existing historical
Chapter 91 source-quality/publication-window gaps are not closed by this work.

Next concrete calculation work: retain `col2_rate_type_code`, `col2_ad_val_rate`,
`col2_specific_rate` and `col2_other_rate` from the annual originals; verify their
published field definitions; select Column 2 without overwriting MFN data; reuse
exact shared arithmetic and show the selected column in findings/reports. Higher
Column 2 percentages and compound/statistical procedures need explicit treatment.
A country-status proof alone does not establish a complete Column 2 calculation.

Private receipts use `/tmp/cante-ordinary-country-ntr-*`. Source originals and
hashes are in Supabase; raw captures remain ignored under
`raw/tariff-references/ordinary/`. No customer evidence or credentials are included
in tracked documentation.


## Mixed-year processing correction

The first real browser run exposed a 429 admission limit after the final review
had saved. Three logical audits had each needed a continuation, consuming all
six existing hourly user checks. That attempt did not produce a final browser
calculation/export and is not counted as completed acceptance. Its fixture
accounts were banned and independent SQL found zero sessions before the rerun.

The worker now saves at most 25 new lines per checkpoint, or after 30 seconds,
and flushes unsaved lines before a timed continuation. Its raw annual-row cache
is request-scoped, selects only declared legal lines (all their intervals), keys
by immutable source/hash/year and retains at most 4 MB. Missing/changed codes
expand the scope; oversized subsets compute without a partial cache. No tenant
facts or computed duties are shared between requests. Conflicting intervals still
block calculation. The mocked actual worker proves five writes for 120 alternating-
year source groups, retained original entries, interruption recovery and the
existing single guarded retry after a lost successful checkpoint response.
Database admission thresholds, concurrency limits and authorization are unchanged.
This reduces avoidable continuations; it does not remove legitimate usage limits.


## Final real workflow and browser evidence

The final isolated website build is
`/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-watch-build-BVigkB`.
The actual worker is 3,877,657 bytes with 324 bundled inputs; the retained old v21
worker actually executes the first run. The final harness artifacts are private
under `/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-audit-pilot-8WM83Y`.
Only deliberately fictional Auth workspaces and entries were written.

Actual upload/mapping/idempotency, 55 unchanged pinned sources, v21→v22 refresh,
all 100 expected values, dated FR→DE evidence review, exports, original-file hash,
foreign-company HTTP/RPC/direct-row denials and inactive product associations pass.
The browser then saves a separately dated MX→CA origin decision with fictional
production/transformation evidence references. Expected duty becomes USD 40.00
and potential overpayment USD 10.00; original MX and the three previous null
results remain. The final 100-row CSV contains 89 calculated/11 blank unresolved
amounts, USD 170.00 potential overpayment and USD 145.00 underpayment. No blank
amount becomes zero or a guaranteed refund.

The browser also shows Vietnam's legal start December 10, 2001 separately from
its December 17 notice publication, with the original notice among four cited
sources. Read-only verification checks all 400 result-row hashes and four protected
aggregate proofs (revision 0 engine v21; revisions 1–3 engine v22). Latest saved
v16/v17/v20/v21 fixture result hashes still verify unchanged.

The database records five total check admissions for this whole upgrade/review/
browser sequence (two in the old worker, three v22 calculations). This run crosses
an hourly boundary, so the day counter is used for the total; it does not claim
that all requests occurred within one hour. No counters or policies were reset,
increased or bypassed. This is fewer than the prior attempt's seven required
admissions; it is not proof every possible 500-line job needs one request.

The browser visibly signs out and owned tab 38 closes. Harness finally revokes/
bans its identities; subsequent independent SQL confirms 72 banned fixture
accounts, zero active fixture accounts and zero remaining fixture sessions. A harmless admin revocation warning can occur after
browser sign-out already revoked the fixture token. The SQL check is authoritative.
Only owned ports 3132/3133 are stopped; the user's existing main dev PID24938 on
3000 is preserved. No production/Preview deployment or daily target is changed.

Final receipts:

- `/tmp/cante-v22-batched-{focused,regression,tsc,worker-tests}.log`
  and `/tmp/cante-v22-worker-batched-build.log`.
- `/tmp/cante-v22-batched-website-build.log` and
  `/tmp/cante-v22-batched-live-acceptance.log`.
- `/tmp/cante-v22-browser-proof.log`, `/tmp/cante-v22-export-proof.json`,
  `/tmp/cante-v22-final-quota.log`, `/tmp/cante-v22-cleanup-verification.log`.
- `/tmp/cante-ordinary-country-audit-results.png`,
  `/tmp/cante-v22-corrected-origin.png`, `/tmp/cante-v22-country-date-evidence.png`.

These are local acceptance receipts using real retained sources and fictional
shipments. They establish neither universal legal accuracy nor hosted readiness.
The broad completion ledger remains open; Column 2 and the other named gaps above
still require implementation and their own actual-source/workflow verification.
