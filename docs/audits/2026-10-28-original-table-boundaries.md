# Historical original-table boundaries

October 28, 2026 · audit v26 · local acceptance complete; broad coverage unfinished.

Two observed-code gaps were reader errors. In the actual 2017 Chapter 37
original, the description of 3705.00.00 begins at x=110.72, outside the former
x≥111 description boundary. In Chapter 44, the final 4421.91.88 row prints its
rate at y=41.953, below the former last-row cutoff of 42. The rates and exact
statistical suffixes are present in both retained same-year originals.

The existing reader uses a shared x=110 description boundary and a bounded last
row floor of 30 PDF points. Suffix/description and footnote column boundaries stay
consistent. Inter-row boundaries, complete header/year/chapter checks, endnote
handling, unknown-note guards and byte/page budgets remain. Missing General text
does not become Free; footer text and suffix-column prose do not become rates or
descriptions. Nothing creates a guessed statistical suffix or current-rate fallback.

The exact original rows now support declared-scope Column 2 estimates:
3705000000, 25%; 4421918800, 35%. Their original MFN rates remain separately Free.
The annual four-field blanks remain blank; agreeing printed originals supply the
complete formulas, with dates, source versions and assumptions retained.

## Coverage accounting and remaining work

Fresh read-only scanning accounts for all 548 records in the known 2017 annual
four-empty-field defect. All now have observed exact published codes. 535 records
recover all observed formulas, 858 of 889 record/code/date cases; none are partly
recovered. These are source-formula records, not distinct laws, completed customer
shipments or independently verified legal classifications.

Thirteen records remain: seven derived-rate rows needing referenced juice/parent
classification and shipment facts; two blank printed annual rates; two Chapter 29
statistical-code/edition cases; 22029928's additional 9904 reference; and 85299054's
edition/date inconsistency. The 22029928 original says `See subheadings
9904.04.50-9904.05.01.` It is not an excise-only note or a General-only 9902
temporary reduction. No unsupported additional duty is silently waived.

Retained registry/details prove Basic availability February 9–June 30, 2017 and
Revision 1 availability October 30–December 21, 2017. These availability windows
are not legal effective dates and leave real publication-window gaps. The Basic
85299054 row has Column 2 35%, but the later original prints 85299053 instead;
the dated annual record cannot be reconciled by selecting a convenient edition.
More original/legal-date evidence is required. The broader countries, preferences,
metals/other 232, AD/CVD and special-entry ledger remains open.

An independent synthetic arithmetic diagnostic also identifies a separate next
fix in the existing approved-rule cap path: converting cap 0.29 with floating
point multiplication produces `28.999999999999996%`, which exact duty parsing
rejects. Exact 29% of USD 1,000.50 is USD 290.15. This is not a missing-law claim,
an approved real 29% rule or a completed fix; it requires exact cap conversion,
comparison and targeted stacking tests. Preserve v26 before changing arithmetic.

## Verification

119 focused tests, 931 regressions, TypeScript, isolated website/worker builds and
the actual protected-worker test pass. Public original-cell tests cover both
boundary rows, column separation and footer rejection. The new 100-line fictional
fixture matches independent arithmetic and exports. Prior 100-line scoped-note/
component and modern 120-line source fixtures pass. This tests functionality and
bounded source contracts, not legal accuracy or customer savings.

Real isolated Auth/database acceptance uses the actual v25 worker, then v26 with
unchanged pinned source IDs. Duplicate upload/refresh is idempotent; foreign-tenant
read, export and refresh are denied. Dated evidence decisions preserve originals.
In the browser, a fictional classification correction changes 3705000000 to the
actually published 4421918800, changing expected duty USD 250→350. Original HTS,
SKU/product association, prior null/value results, citations and all four raw
empty source fields remain. Every line of the downloaded 100-row CSV matches
the independent oracle; four protected output hashes verify. Eight earlier saved
result sets (v16/v17/v20/v21/v22/v23/v24/v25) verify unchanged.

Final fictional ledger: 90 calculated/10 intentionally open, USD 262.50 potential
overpayment and 2,161.01 underpayment. Four check admissions; quotas unchanged.
Browser sign-out succeeds; subsequent cleanup has the already-observed token
warning. Independent SQL confirms 82 banned fixture accounts, zero active fixture
accounts and zero sessions. Owned tab 43 and ports 3132/3133 close; main
PID24938/3000 remains. No deployment, customer data, schema, grants, dependency,
new lib module, daily target or global legal approval changed.

## Private receipts

- Audit `fb5cb61a-52b6-480c-8296-046ccf5f1788`: revisions 0=v25, 1/2/3=v26.
- Build `/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-watch-build-OYxdjX`.
- Artifacts `/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-audit-pilot-vbK1pW`;
  credentials revoked/banned; never reuse as customer records.
- `/tmp/cante-v26-{focused-final,regression,tsc-final,worker-build,worker-tests,
  website-build,boundary-source-goldens,scoped-regression,watch-regression,
  modern-regression,full-source-inventory,live-acceptance,browser-proof,
  export-proof,cleanup,quota,edition-dates,cap-diagnostic}.log`.
- `/tmp/cante-missing-column2-recovery-inventory.json`: final 548-record scan.
- `/tmp/cante-v26-corrected-classification.png`,
  `/tmp/cante-v26-classification-calculation.png`.
  Download `~/Downloads/historical-audit (25).csv`.

This is a verified local extension. Continue the
[full coverage ledger](../plans/historical-coverage-completion.md); website and
worker deployment remain separate and require authorization.
