# Annual rate reconciliation — October 27, 2026

Audit v17 continuation. Full historical coverage remains IN PROGRESS. No app
or worker deployment, schedule target, schema, permission, dependency or human
approval changed. This work **does** retain new public government originals in
the linked Supabase project; it is not solely a local-source-code change.

## Implemented

The 2016/2017 annual files can truncate numeric duty fields to two decimal
places while retaining a more precise complete printed formula. The existing
annual path now corroborates that formula against pinned same-year original
chapter PDFs, rather than choosing a rounded field. It retains the original
numeric values, every reconciled value, the full printed formulas, PDF pages,
original hashes, source identities and the reason for reconciliation.

For example, the retained annual record for 65050008 prints 13.5 cents/kg +
6.3% + 1.9 cents/article but numeric fields contain 0.13, 0.06 and 0.01.
The original General column, distinct from Special and Column 2, agrees with
that complete formula. On explicitly fictional USD 1,000, 100 articles and
25 kg declarations, the exact sum is USD 68.28. This does not independently
classify a product, determine legal origin or establish refund eligibility.

The annual row's original effective dates, bounded to its captured year,
remain the applicability basis. A same-year schedule's availability start must
fall within that row. Publication availability never supplies a legal start
date; a later PDF cannot substitute a different rate. Every applicable pinned
candidate must agree with the entire annual printed expression. Conflicting
candidates, unparsed notes, unknown units, missing provenance, other years,
invalid dates and arbitrary numeric discrepancies keep the total unresolved.
Only equal values or the exact known two-decimal truncation can reconcile.
Quantity methods 1–6 and plain percentage method 7 use the same exact arithmetic.

The original publisher names are chapter98, Chapter99, basicCorrections2 and
NTE; they are not invented year aliases. The original archive page, raw release
registry and matching edition details bind each original chapter URL. Parent
originals are pinned even when the latest-source catalogue hides older registry
versions. The modern registry retains its normalized release metadata.

The audit engine version is historical-audit-v17; earlier versions remain
readable. Cante-validated historical-ordinary-annual-v2 is distinct from human
approval. Detail pages expose precision/original schedules in a collapsed
explanation, and CSV exports retain the complete calculation/evidence snapshot.

## Government originals retained

The operator-only backfill follows the actual
[USITC archive links](https://www.usitc.gov/harmonized_tariff_information/hts/archive/list?page=7),
[release registry](https://hts.usitc.gov/reststop/releaseList) and edition details.
There are 96 chapter originals per edition, excluding reserved chapter 77:
384 files total across the two 2016 and two 2017 editions. This capture covers
ordinary chapters 01–97; Chapter 98/99 treatment needs its separate coverage.
Independent read-only SQL confirms these counts. This is raw evidence capture, not publication of
384 complete projected schedules, approved legal rules or shipment outcomes.

All 384 provenance identities pass the read-only verifier against six parent
originals. There are 151 object-backed and 233 inline chapter originals. Four
object-backed Chapter 84 samples pass original/stored hashes, full chapter
year/sequence and exact published-code/General-column extraction, including their
section-preface pages. This does not test every formula in every file.

The initial capture rejected 84 files with section-preface pages. A bounded
12-page section-prefix reader now verifies their printed year/chapter identity;
the resumed capture reports all 384 originals and no failures. New captures
use the existing private official-reference object bucket regardless of size,
retaining both stored/original hashes. Earlier immutable inline originals were
preserved. No customer import records were used as source fixtures.

## Verification

- 84 focused tests, all 931 existing regressions, TypeScript and isolated website
  and worker builds pass. The worker has 324 inputs and 3,837,414 bytes, with no
  provider/delivery code. The separate mocked worker test passes signed dispatch,
  tenant scoping, interruption/resume and checkpoint transport recovery; it is
  not a real-database test.
- All 21 read-only source-backed cases pass, including two previously unresolved
  precision conflicts now calculating USD 68.28 with both original schedules and
  unchanged numeric fields. Initial results: 15 calculated, six unresolved, USD
  108.20 potential overpayment and USD 1.80 potential underpayment. Four fictional
  evidence corrections yield 19 calculated, two unresolved, USD 204.04 potential
  overpayment and USD 1.80 potential underpayment. The remaining two cases are
  unsupported statistical procedure T and an unsupported preference claim.
- Fourteen modern April source cases also pass, checking that the newly retained
  raw registries do not break the existing dated modern-metal path.
- Real isolated Auth/database/actual-worker acceptance passes CSV mapping,
  document references, duplicate reuse, original-file hash, all initial/reviewed
  goldens, preserved prior results and report export. Another tenant gets 404
  for detail/export and zero direct RLS result rows. Fictional product links
  acquire no invented current origin or reference-value facts. No model calls
  or shared approvals were created.
- Browser correction on the newly supported 2016 line changes its second quantity
  from 25 kg to 20 kg. Expected duty and the reference scenario both become
  USD 67.60, from USD 68.28. Protected reads verify current revision 5/prior 4
  (displayed revision 6), unchanged original 25 kg and all three retained/exact
  numeric fields. The totals become USD 204.72 potential overpayment and USD
  1.80 potential underpayment. The previous v16 audit remains readable and
  retains its original unresolved precision cases; it was not silently rerun.
- The browser-downloaded 21-line CSV retains original 25 kg, used 20 kg, corrected
  calculation/scenario, both schedule originals, all reconciled fields and the
  fictional correction reference. Its two unresolved amounts remain blank.
  Screenshot: /tmp/cante-annual-schedule-audit-results.png.
- The browser visibly signed out and its owned tab closed. Independent SQL
  confirms 56 banned fixture accounts and zero sessions, including the latest
  fixture. A redundant post-logout revocation warning is covered by that SQL
  check. Owned ports 3132/3133 are closed; existing PID 24938/port 3000 remains.
  No app or worker deployment occurred.

The earlier 18-year inventory in the v16 record is a dated baseline; it has not
been reclassified in full by this addition. Do not subtract two successful
fixture entries from source-record counts or call these files complete legal
coverage. Other quantity procedures, conditional notes, additional-duty paths,
other Section 232 sectors, preferences/Column 2, broader AD/CVD and special
entries remain in the completion ledger.

Receipts: /tmp/cante-annual-schedule-capture-resume.log,
/tmp/cante-annual-schedule-source-counts.log,
/tmp/cante-annual-schedule-source-verification.log,
/tmp/cante-annual-schedule-tests.log, /tmp/cante-annual-schedule-regression.log,
/tmp/cante-annual-schedule-tsc.log, /tmp/cante-annual-schedule-build.log,
/tmp/cante-annual-schedule-worker-build.log,
/tmp/cante-annual-schedule-worker-tests.log.

Additional receipts: /tmp/cante-annual-schedule-modern-source-regression.log,
/tmp/cante-annual-schedule-live-acceptance.log,
/tmp/cante-annual-schedule-browser-proof.log,
/tmp/cante-annual-schedule-export-proof.log,
/tmp/cante-annual-schedule-cleanup-verification.log.

Provenance/storage receipts: /tmp/cante-annual-schedule-provenance-verification.log
and /tmp/cante-annual-schedule-external-proof.log. Final TypeScript receipt:
/tmp/cante-annual-schedule-tsc-final.log. Repeat with npm run verify:annual-schedules;
this is read-only and creates no customer record or approval.
