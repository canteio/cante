# Historical April start and checkpoint recovery — October 26, 2026

Local audit v15 work. Full historical coverage remains IN PROGRESS. Production,
the daily worker target, schema, permissions, dependencies and shared human rule
approvals are unchanged.

## Original first-week law

The retained [Federal Register 2025-06063 original](https://www.govinfo.gov/content/pkg/FR-2025-04-07/pdf/2025-06063.pdf)
establishes the April 5, 2025 00:01 Eastern creation of the reciprocal headings.
The exact original creation clause and complete 1,039-code exemption table now
have a deterministic contract. Four known printing-footer tokens (2014, 2025,
4705, 4790) are excluded only after the entire original clause matches; they
never become HTS headings. Changed or incomplete text does not gain this support.

The original table matches the independent April 9 consolidated table exactly.
That later file is comparison evidence; its commodity rates are not applied to
earlier entries. The original source is the already retained immutable version
`73e2dc0e-39f4-4eba-92bd-6996e857a5d8`; no new source capture was needed.

Actual inspection found that the early edition already has a usable reciprocal
table under an older note layout. The missing first-week paths were the original
U.S.-metal exception clauses and precise start treatment. Existing usable data
remains in use; the original-table fallback handles a missing supported note.
The original law supplies the missing zero-duty U.S.-metal clauses and explicitly
proves the preceding-minute treatment. New U.S.-metal references use compiler v6;
original-table fallback references use program compiler v2 when selected.

The same fictional USD 1,000, four-percent-base entry calculates USD 40 at
00:00:59 Eastern and USD 140 at 00:01:00. A missing actual time stays unresolved,
with a shipment-data finding requesting its timezone and dated evidence. It is
not reported as merely missing law. Evidence corrections preserve the original.

The original-table tests exposed a separate exact-code issue: obsolete
8542.31.0001 cannot replace its published statistical successors. A valid suffix
still references 9903.91.05. Its exact dated published description is expressly
China-only, so non-China findings now account for it as inapplicable. Changed
wording or China origin does not obtain that negative result. China calculations
for this heading still require their own complete dated scope. No origin is
inferred from a supplier address, and no new flat semiconductor rate is applied.

## Checkpoint recovery

The v14 failures were observed at a progress save with an empty database error
code. Their precise transport cause was not established. A new helper in the
existing audit store repeats an identical checkpoint write once for a transport
failure or an empty-code server error. It retains audit, tenant, revision and
lease predicates and additionally requires the run to remain analyzing. It uses
the same deadline and disables hidden SDK retries for this write.

There is no retry for authentication, quota or validation failure, or a changed
revision/lease. Calculations, claims, approvals and the final commit are not
repeated by this helper. Repeating a checkpoint after a committed-but-lost
response is idempotent; the final result still requires its protected database
attestation. Existing byte, time, admission and record bounds remain.

The test-only live harness can simulate a lost response after a real committed
checkpoint. Its interception is confined to the isolated worker process and the
explicitly named synthetic fixture. It records matching payload/guard hashes
without request credentials or shipment payloads. Normal production execution
contains no fault-injection path.

## Verification

- 156 focused tests, all 931 existing regressions, TypeScript and isolated website/
  worker builds pass. The mocked 120-line worker test verifies both interruption/
  resume and one lost-response recovery with a single final commit. These mocked
  checks are separate from real Supabase acceptance.
- Fourteen actual-source cases match independent hand arithmetic on fictional
  declarations: original dated source binding, first-second cutoffs, ordinary
  base, U.S.-metal exceptions, independent China duties, HTS-only exemptions,
  missing-time correction, an unknown time and an obsolete statistical suffix.
- The 31-edition structural scan now validates the early original fallback and
  all subsequent exact U.S.-metal overlap contracts. This is not proof of every
  classification, rate, qualification or legal conclusion in those editions.
- The first real run passed saved calculations, all fourteen evidence decisions,
  expected results and verified prior versions. Its test failed on an overly
  specific export assertion expecting the fallback compiler when an existing
  valid table had been used. The check now verifies actual exported source,
  cutoff, exemption and version evidence. This was a test assertion failure,
  not a failed duty calculation; its original log remains.
- The corrected real isolated Auth/database/worker run passed upload, mapping,
  duplicate reuse, fourteen evidence decisions, export and prior-result integrity.
  The reviewed fixture has twelve calculated lines and two deliberately unresolved
  lines; potential overpayment is USD 500 and underpayment USD 550, kept separate.
  The second tenant receives 404 for detail/export and zero direct RLS rows.
  Fourteen linked fictional products acquire no invented current shipment facts.
  No model calls or shared rule approvals occur.
- A real checkpoint was committed, its response replaced by one simulated 503,
  and the identical tenant/revision/lease-scoped payload replayed once successfully.
  This proves recovery for that failure mode, not the precise cause of v14's
  interruptions or protection against every possible database outage.
- Browser review then corrected line nine from 00:01:00 to 00:00:59 Eastern,
  changing expected duty USD 140→40. The page displays both times. Protected
  database reads verify current revision 15 and prior revision 14; the original
  timestamp and prior USD 140 calculation remain intact. The displayed revision
  is 16. Current totals are USD 500 potential overpayment and USD 450 potential
  underpayment, with six monetary differences. The browser-downloaded CSV retains
  all fourteen lines, both times, source/version evidence and blank unresolved
  amounts. Screenshot: `/tmp/cante-april-start-audit-results.png`.
- Browser logout visibly completed. Independent SQL confirms 48 banned fixture
  accounts and zero sessions, including zero for this final fixture. The harness
  reports a redundant revocation warning after logout; SQL confirms cleanup.
  Owned ports 3132/3133 closed; existing port 3000 remained running.

Receipts: `/tmp/cante-april-start-all-focused.log`,
`/tmp/cante-april-start-regression.log`, `/tmp/cante-april-start-source-final.log`,
`/tmp/cante-april-start-scope-verification.log`,
`/tmp/cante-april-start-live-acceptance-final.log`,
`/tmp/cante-april-start-browser-proof.log` and
`/tmp/cante-april-start-cleanup-verification.log`.

The [full completion ledger](../plans/historical-coverage-completion.md) remains
open: other Section 232 sectors, remaining conditional metal exceptions,
preferences/Column 2, broader AD/CVD/assessment and special-entry/transit rules
still require their own source and qualification contracts. This work does not
establish universal historical coverage or guaranteed refunds.
