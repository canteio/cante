# Historical annual quantity duties — October 27, 2026

Local audit v16 work. The full historical completion goal remains IN PROGRESS.
Production, daily worker target, authentication, permissions, schema, dependencies
and shared human approvals are unchanged.

## Implemented

The existing annual historical path now supports the USITC code key's six
quantity equations, in addition to the existing Free/percentage path. It retains
both government quantity-code positions, including an empty first position;
matching uses separately supplied units, not the order of CSV quantity columns.
A component kilogram, proof liter, jewel or number is never inferred from a total
kilogram, liter or another quantity. Repeated conflicting quantities withhold
the total and are categorized as shipment-data corrections.

The retained [USITC code key](https://dataweb.usitc.gov/assets/content/annual-tariffs/td-codes.pdf)
and [field definitions](https://dataweb.usitc.gov/assets/content/annual-tariffs/td-fields.pdf)
establish each equation, the numeric field meanings and supported unit meanings.
Changed equations, unknown/ambiguous units and unsupported procedures do not gain
calculation support. Method T still needs the exact statistical-level procedures;
method 9/K/X and special claims are outside this addition.

For files with printed-rate text, the entire expression must corroborate all
numeric terms and unit meanings. Extra conditions or contradictory amounts are
not dropped. The 2000-era files have no printed-rate column at all; that explicit
schema absence differs from a present-but-empty field. Their documented numeric
fields can supply complete equations. Source inputs, formula terms, method,
printed text where present and field-definition identity remain in the snapshot.

The shared exact-duty helper now sums up to three complete terms as rational
values and rounds once to cents. Each formula remains one base-duty component,
so paid base/additional allocations are compared correctly. Dated shared stacking
instructions are resolved before the quantity arithmetic, including base-duty
exclusions; expired/conflicting instructions cannot be bypassed. Missing terms never
produce a partial expected total. The report and detail page retain every used
quantity; dated evidence corrections preserve original declarations and results.
The reference base-duty scenario also uses the reviewed quantities, preventing
a stale original-weight figure beside a corrected expected duty. An exact
excise-only footnote is supported because the upload explicitly limits
the comparison to customs duties. It does not calculate excise taxes. Other
footnotes continue to require their own historical interpretation.

The ordinary country contract and additional-duty boundaries remain required.
These formulas support dated ordinary Column 1 entries within 2000–2017; they do
not establish universal country coverage, preferences, classification, origin,
all Chapter 99 combinations or a right to a refund. Cante-validated reference
calculations remain distinct from human-approved rules.

## Data-quality finding

The 18-year source inventory exposed loss of precision in some 2016/2017 numeric
fields. For example, the same retained record prints 13.5 cents/kg + 6.3% + 1.9
cents/article but its numeric fields contain 0.13, 0.06 and 0.01. Selecting those
values would understate duty. The result now retains both representations,
withholds the total and requests the exact original HTS schedule. This addition
does not treat a detected conflict as solved legal coverage.

Across the 18 retained annual originals, the scan finds 25,706 quantity source
records intersecting their captured years. 18,117 meet the current formula,
unit, footnote and additional-duty contract. 2,415 need printed-formula/unit or
precision support; 5,174 have other footnotes. These are source-record counts,
including multiple intervals for some lines, not distinct products or completed
shipment calculations. Country and entry facts remain separate requirements.

## Verification

Twenty-one source-backed cases on fictional declarations cover
all six equations, count/content/second quantities, rounding, excise exclusion,
missing/conflicting quantities, dated evidence corrections, legacy 2000 records,
and preserved conflicts. Initial summary: 13 calculated, eight unresolved, USD
44.76 potential overpayment and USD 1.80 potential underpayment. Four fictional
evidence decisions yield 17 calculated, four unresolved, USD 140.60 overpayment
and USD 1.80 underpayment. Monetary directions are never netted.

- 115 focused tests, all 931 existing regressions, TypeScript and isolated
  website/worker builds pass. The final worker has 324 inputs, 3,824,294 bytes
  and no provider/delivery code. The mocked 120-line worker test separately
  passes tenant/signed dispatch, interruption/resume and bounded checkpoint
  transport recovery; mocked fixtures do not establish real database coverage.
- Real isolated Auth/database/actual-worker acceptance passes all 21 initial
  and reviewed goldens, CSV mapping (including fictional document references),
  duplicate reuse, original-file hash, prior-result integrity and report export.
  The second tenant receives 404 for detail/export and zero direct RLS result
  rows. Linked fictional products gain no invented current origin/value facts.
  No model calls, shared approvals or production schedules change.
- Browser review changes line nine's second quantity from 25 kg to 20 kg.
  Expected duty changes USD 68.28→67.60; the reference scenario now agrees at
  USD 67.60. The page shows the separately supplied 100 count/20 kg quantities
  and all four original source links. Protected reads verify current revision
  5 and prior revision 4, preserving original 25 kg and prior USD 68.28. The
  displayed revision is 6. Current totals are USD 141.28 potential overpayment
  and USD 1.80 potential underpayment.
- The browser-downloaded 21-line CSV retains original 25 kg, reviewed 20 kg,
  corrected expected/reference amounts, fictional evidence references, formula
  terms and original citations. All four unresolved amounts remain blank;
  conflicting source fields stay visible. Screenshot:
  `/tmp/cante-annual-quantity-audit-results.png`.
- Two earlier isolated workflow runs passed their arithmetic and tenant checks;
  subsequent review found the stacking-order and stale-reference-display issues
  described above. Both now have regression assertions and the final full run
  passes. The final browser session visibly signed out. Independent SQL confirms
  54 banned fixture accounts and zero sessions, including zero for this fixture.
  A redundant post-logout revocation warning is covered by that SQL check.
  Owned ports 3132/3133 closed; existing port 3000 remains running. No deployment
  occurred. A protected read also confirms prior v15 results remain readable.

Receipts: `/tmp/cante-annual-quantity-focused-final.log`,
`/tmp/cante-annual-quantity-regression-final.log`,
`/tmp/cante-annual-quantity-tsc-final.log`,
`/tmp/cante-annual-quantity-source-final.log`,
`/tmp/cante-annual-quantity-scope-final.log`,
`/tmp/cante-annual-quantity-live-acceptance-final2.log`,
`/tmp/cante-annual-quantity-browser-proof.log` and
`/tmp/cante-annual-quantity-cleanup-verification.log`.

## Existing files and boundaries

Changes reuse `annual-data.ts`, reference loading/caches, the ordinary compiler,
`engine.ts`, the existing exact arithmetic helper and audit UI/export. A bounded
text cache avoids repeated code-key/GN3 decoding; ordinary PDF readers are closed
in `finally`. No new engine service, `lib/` module or dependency is introduced.
Audit v1–v15 results remain readable; new results identify v16.

The [full ledger](../plans/historical-coverage-completion.md) stays open for other
Section 232 sectors and conditional metals, dated countries/Column 2/preferences,
AD/CVD/assessment, remaining exclusions, quantity procedures and special entries.
Next work includes exact original-schedule support for the conflicting annual
records, rather than silently accepting rounded source data.
