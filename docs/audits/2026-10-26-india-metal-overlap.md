# Historical India and metal overlap — October 26, 2026

Local audit v13 work; full historical coverage remains IN PROGRESS. No deployment,
daily target, permission, schema, new dependency or human approval change.

## Scope and implementation

The original [CBP notice, Federal Register 2025-16419](https://www.govinfo.gov/content/pkg/FR-2025-08-27/pdf/2025-16419.pdf),
dated Note 2(z)(iii)–(ix), [CSMS 66027027](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/3ef7e13)
and [termination CSMS 67702087](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/4090d47)
now establish supported India/steel, aluminum and copper overlap. The compiler
requires exact operative clauses and published 9903.01.87 treatment. It deducts
only portions actually charged under the supported Section 232 headings. Both
the reciprocal duty and the additional India duty retain their independent rates
on the remaining value. Full-value metal assessment exempts its whole assessed
value; zero copper does not invent an India metal exemption.

The existing public original notice is source
`37e3e6e6-9480-4a17-a3ba-e5e5b5fcd887`. One new public original,
[CBP N356087](https://rulings.cbp.gov/api/getdoc/ny/2025/N356087.pdf), was retained as
source `6750efd4-b3bc-4691-8bcb-b0a728423e12`, original SHA-256
`782826f62eb0eac5bcf97e9e762df7c83c015aec45cf87136a224c18238dd13c`.
It corroborates content-line allocation. Its classification, merchandise and
specific factual holding are not applied to another shipment. Its issue date is
not used as the legal effective date. The original enactment and dated notes
establish the interval. This is a Cante-validated source compiler, not human
legal approval or a binding ruling for a customer's goods.

The source-capture allowlist permits only public original ruling PDF paths on
`rulings.cbp.gov`; queries, fragments, unrelated paths, alternate hosts and ports
are rejected. The existing SQL government-host constraint already permits that
source. No database migration or access expansion was needed. Selection pins the
small corroborating original for relevant dates, including an origin revision;
execution reads it only for the relevant India group. Existing immutable source
hashes, byte/time budgets and tenant boundaries remain.

The shared engine supports 00:01 Eastern start/end instants. The minute before
the new India duty starts uses its original enacted start proof; it is not a
current-rate substitution. The minute before termination retains the earlier
duty with a timestamp-bound reference. The after-cutoff result terminates the
obsolete headings while retaining other duties. A date without the necessary
entry time remains unresolved. Result coverage intervals are not displayed as
inferred legal effective dates.

## Findings and interface

Partial exemption 9903.01.87 is explained separately from payable monetary
components. The report shows the value still subject to the India duty and its
sources. A declared exemption can be accounted for without falsely exempting
the whole import. An evidenced zero-copper claim and an obsolete post-termination
claim produce heading-discrepancy findings while the supported money calculation
remains available. The table shows those nonfinancial findings even where there
is no paid-duty difference. Non-China findings retain relevant referenced or
declared China headings without displaying dozens of unrelated remedies.

Prior v1–v12 snapshots remain readable; new runs use v13. Original declarations,
evidence decisions, source versions and prior verified results stay immutable.
No separate engine or new `lib/` module was added.

## Verification

- All 16 retained editions intersecting August 27, 2025–February 7, 2026 pass the
  five exact metal-clause contracts and companion steel/aluminum scope checks.
  This is structural evidence, not every rate/qualification combination.
- Sixteen actual-source cases on fictional entries match hand-calculated results:
  fourteen calculate and two deliberately withhold totals for missing exception
  evidence or missing boundary time. Supported examples at USD 1,000 include
  steel USD 500, copper USD 530 and mixed aluminum/copper USD 526.
- The same fictional steel content input produces USD 450/500 across the start
  cutoff and USD 500/450 across termination. Independent later Section 122
  treatment is also checked. These are test assertions, not customer savings.
- The original implementation passed 128 focused tests, all 931 existing
  regression tests, TypeScript, isolated
  website build, trusted worker build and mocked worker tests pass. Worker bundle:
  3,805,689 bytes, 324 inputs; no website/provider/delivery code.
- The first real worker run exposed a 300-page lookup failure when a month
  contained multiple large chapters. Individual source cases had missed this.
  The failure retained originals and correctly withheld totals. The process
  terminated and its fixture identities were cleaned up; no success is claimed.
- Internal work groups now use the evidence-corrected chapter plus month, retain
  entry order, and save checkpoints between groups. PDF readers are released in
  `finally`. A request-scoped 4 MB cache retains only positive exact-code rows,
  keyed by immutable original ID/hash/code; failed/missing lookups are not cached
  as legal absence. No page/byte/time/admission bound was raised. The single
  customer CSV upload remains unchanged.
- 129 focused tests and grouped actual-source cases pass after that repair;
  fresh website/worker builds, TypeScript, mocked worker checks and all sixteen
  cached/grouped source cases pass. The repeat regression passed 930/931; one
  real database fixture setup returned `JWT issued at future`. Its complete
  ten-test file passed on retry. This is consistent with the reported
  [Supabase opaque-key issue](https://github.com/supabase/supabase/issues/50651),
  but its infrastructure root cause was not independently established here.
  Authentication was not changed. This repeat is not reported as an entirely
  green full-suite run.
- The repaired build then passed real isolated Auth/database/worker acceptance:
  CSV upload, column mapping, idempotency, sixteen evidence decisions, immutable
  originals and prior results, raw-file hash, report/export and tenant denials.
  Fourteen lines calculated; two deliberately lacked exception evidence or an
  actual boundary timestamp. The fictional initial totals were USD 500 potential
  overpayment and USD 250 potential underpayment. No model calls or shared rule
  approvals were made. This is workflow evidence, not legal validation.
- Browser review corrected one fictional entry from 00:00:59 to 00:01:00 Eastern
  on August 27. Expected duty changed USD 450→500; potential underpayment became
  USD 300. Protected database checks verified both timestamps, original values,
  prior calculation, partial exemption and current result. The finding now shows
  both the uploaded time and calculation time in Eastern time. Nonfinancial
  obsolete-heading findings remain visible even with zero duty difference.
- The downloaded sixteen-line CSV verified the USD 500 result, negative USD 50
  paid-minus-expected amount, original/reviewed timestamps, partial exemption,
  obsolete-heading finding, v13 version and blank unsupported totals. Screenshot:
  `/tmp/cante-india-audit-results.png`; browser export:
  `~/Downloads/historical-audit (14).csv` (local fictional artifacts).
- Backend acceptance used isolated build `cante-history-build-LZYQw9`; the final
  timestamp-display-only build `cante-history-build-IWIX9x` also passed build and
  TypeScript, and used the same local worker for browser review/export. No
  deployment or daily worker target changed.
- Browser logout visibly completed. Harness cleanup exited successfully; its
  redundant session-revocation warning followed browser logout. An independent
  live aggregate query confirmed 38 banned fictional audit accounts, zero
  sessions for them, and the final browser account banned with zero sessions.
  The three owned preview ports 3132–3134 closed; existing main development
  processes on port 3000 remain running.

Local logs include `/tmp/cante-india-live-acceptance-final.log`,
`/tmp/cante-india-browser-proof.log`,
`/tmp/cante-india-cleanup-verification.log`,
`/tmp/cante-india-all-focused-final.log`,
`/tmp/cante-india-regression-final.log` and
`/tmp/cante-india-regression-auth-retry.log`. The earlier failed real run remains
recorded in `/tmp/cante-india-live-acceptance.log` and
`/tmp/cante-india-worker-gap.log` rather than being relabelled successful.

## Remaining scope

The next U.S.-metal investigation found a necessary distinction: qualifying
9903.81.92/9903.85.09 treatment has zero additional metal duty, but a numerical
zero alone does not establish another program's exemption. The exact dated
heading must qualify. [Federal Register 2025-06063](https://www.govinfo.gov/content/pkg/FR-2025-04-07/pdf/2025-06063.pdf)
originally names those headings in Note 2(v)'s reciprocal exceptions;
[2025-15819, Annex II](https://www.govinfo.gov/content/pkg/FR-2025-08-19/pdf/2025-15819.pdf)
changes the operative text to declared-metal versus non-metal portions from
August 18, 2025 at 00:01 Eastern. Retained later notes include both zero-duty
headings in that content allocation. The earlier/transition intervals need
independent contracts; the current compiler still withholds this path. Do not
extend the v13 charged-portions-only logic to these qualifications by merely
removing its guard. India also explicitly names those headings; Section 122
requires its separate operative treatment. This is a research finding, not an
implemented or verified U.S.-metal expansion. The live FAQ returned 403; a
third-party mirror was not accepted as authoritative proof.

The [full coverage ledger](../plans/historical-coverage-completion.md) stays open.
India's ordinary and supported partial-metal paths do not establish every
conditional metal heading, Russian-content overlap, preferential claim, other
Section 232 sector, transit/FTZ/warehouse regime or final AD/CVD assessment.
Those require their own dated source/qualification contracts; none becomes zero
or a guessed total because these tests pass.
