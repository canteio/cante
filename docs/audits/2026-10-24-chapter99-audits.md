# Historical Chapter 99 audit expansion — October 24, 2026

This is a bounded addition to the existing audit engine and review interface.
It does not establish universal Chapter 99 coverage or a customer refund right.

## Implemented

- Validate and preserve declared Chapter 99 codes, including undotted uploads,
  duplicates and multiple semicolon-separated headings. Unknown treatment blocks
  the total instead of disappearing from the calculation.
- Match supported 2024 Section 301 exclusion definitions in headings 9903.88.67,
  .68 and .69 against exact statistical HTS, the original extension instruments,
  the published heading window and the target China-duty heading. A code match
  produces an evidence lead, never automatic product qualification.
- Let a company reviewer choose the published product definition, retain evidence
  references, and confirm dated qualification inside the finding. This creates a
  revision; original declarations and prior protected results remain immutable.
- Apply a qualified exclusion to its corresponding Section 301 duty only. Base
  duty and independently applicable metal duties remain in the shared deterministic
  calculation. Unqualified claims retain the China duty and show the mismatch.
- Calculate supported 2024 China-origin primary steel (9903.80.01) and aluminum
  (9903.85.01) from dated notes and the original proclamations. Aluminum additionally
  requires an evidence-backed decision ruling out Russian smelt/cast treatment.
  Missing primary-metal contracts cannot fall back to base plus Section 301.
- Recognize the precise published Russia-only scope of 9903.90.08/.09. A referenced
  heading is not automatically an applicable duty. Changed descriptions, unknown
  headings and Russian-origin cases do not acquire coverage through this shortcut.
- Show declared, evaluated, not-applicable and pending headings in each finding;
  export treatment, assessed exclusion and selected product definition with the
  existing original fields, amounts, missing evidence and citations.

No new database tables, permissions, dependencies, services or per-shipment model
calls are required. Existing authenticated review events store the extra decision
fields. Engine version `historical-audit-v6` retains readers for v1–v5 results.

## Sources and coverage

A pre-existing List 4A source typo was also corrected: the February 2020 USTR
reduction is [2020-00904](https://www.govinfo.gov/content/pkg/FR-2020-01-22/pdf/2020-00904.pdf),
not the neighboring airport notice 2020-00934. The airport PDF contains adjacent
tariff text, which had allowed the text/date check to pass with an irrelevant
citation. Future compilation now selects the correct, already-retained original;
a regression rejects the wrong identity even with identical borrowed rate text.
Earlier immutable evidence/results are preserved. The full real-source fixture
was rerun after this correction and all independent amounts still matched.

The four modifying originals are 2023-28770, 2024-11904, 2018-05477 and 2018-05478.
They are retained as official evidence, not newly human-approved rules. Known
original actions can now be selected even when content deduplication previously
attached their immutable source row to a different HTS edition. Edition-specific
rates and notes retain their own release restrictions.

The new compiler is `historical-chapter99-v1`. It uses the original exclusion
extension windows, not capture dates or current rates. Date-only entries on
supported exclusion cutoff days remain unresolved until their legal time treatment
can be established. Descriptions with historical classification transitions are
kept as unsupported scopes instead of treating every mentioned code as eligible.

Direct original-text verification found these definition counts:

| Edition | Inspected | Supported layout | Needs interpretation |
|---|---:|---:|---:|
| 2024HTSRev1 | 218 | 181 | 37 |
| 2024HTSRev3 | 312 | 257 | 55 |

These count definitions across the relevant notes, including repeated definitions
in successive headings, not unique goods or complete Chapter 99 coverage. Each
supported product still needs qualification evidence. Parsing failures are retained
in a visible coverage ledger. The end of note 20 is explicitly bounded before
note 21 so unrelated numbered lists cannot become exclusion definitions.

The action backfill retained the required originals. Its run also reported an
unrelated archive-directory page 9 layout failure; that run is not a successful
complete-archive scan. No customer import, legal approval or schedule was written
by source capture.

## Code paths

- `app/api/tariff/references/chapter99-contract.ts`: bounded source contracts,
  exclusion definitions, primary metal scope and country-specific heading checks.
- `app/api/tariff/references/store.ts`: immutable source selection and dated lookups.
- `app/api/audits/{model,input,compiled-reference,engine,store}.ts`: decisions,
  deterministic components, declared-code accounting, versions and CSV exports.
- `components/audits/audit-workspace.tsx`: in-place scope/evidence review and
  automatic recalculation after confirmed facts.
- `scripts/test-chapter99.test.ts`, `scripts/verify-chapter99.ts` and
  `scripts/test-fixtures/historical-audits/chapter99-*`: synthetic unit contracts
  and independent original-source amount fixtures.

## Verification

`npm run test:chapter99` exercises syntax, evidence/date/product-definition guards,
unknown claims, rejected qualification, independent metal stacking, Russian
aluminum facts, exact country restrictions, and missing metal contracts. The
focused audit/reference suites pass 66 tests; the main regression suite passes
931 tests. TypeScript, the isolated production website build, and the actual
worker bundle dispatch/proof/checkpoint test also pass.

`npm run verify:chapter99` is read-only against actual retained government
originals. Its 120 explicitly fictional entries cover twelve cohorts. Independent
hand-formula goldens establish:

| Stage | Calculated | Unresolved | Differences | Potential overpayment | Potential underpayment |
|---|---:|---:|---:|---:|---:|
| Before evidence decisions | 40 | 80 | 20 | $100 | $2,500 |
| After fictional evidence decisions | 80 | 40 | 70 | $10,100 | $3,500 |

Every expected amount, difference and exported row matched. An additional
fictional evidence-backed CN-to-VN correction preserves a declared China-duty
heading, identifies it as inapplicable, and calculates $40 against $290 paid
($250 potential difference). Origin is reviewed, not inferred from location. The unresolved cohorts
intentionally include expired exclusions, unknown headings, missing HTS, and
unproven aluminum qualifications. The report pins 24 sources, makes zero model
calls, writes no tenant data and creates no legal approvals. Passing synthetic
declarations against official rates is not independent broker/legal validation.

The real Supabase/Auth acceptance harness additionally exercised upload, column
mapping, validation, exact-SKU association, duplicate-upload reuse, protected
worker execution, original-file download, CSV export and cross-company denial.
Its Chapter 99 evidence decision created a new calculation ($40 expected, $250
potential difference) while the original claim and prior null result remained
readable through the earlier protected run. New catalogue links remained inactive
with no invented current origin, HTS or value. The ordinary and four-list Section
301 fixtures also passed their 120-line full-workflow regressions.

One test assertion initially expected the current reader to display an earlier
result automatically after a review. The actual contract correctly withholds
current totals until recalculation and exposes old results through explicit
version selection; the assertion was corrected. Browser verification also exposed
Next.js normalizing `127.0.0.1` to `localhost` in middleware, causing the deliberate
same-origin protection to reject the alternate hostname. A temporary custom
server bound an isolated `.localhost` hostname for browser acceptance; the
production protection was not relaxed and the existing dev server was untouched.

Browser acceptance then selected the exact published motor definition, supplied
explicitly fictional specifications/qualification evidence, and saved the review.
Automatic recalculation changed the line from $290 expected to $40, with a $250
potential difference. Its downloaded 120-row CSV preserved the original empty
claim and exported the new .67 heading/definition separately. All three protected
versions were read back: the earlier line values remain $290/$290 and the latest
is $40. Test sessions were signed out, the fixture account is banned with zero
remaining Auth sessions, and temporary servers/tabs were stopped. An extra admin
revocation reported an already-ended session; the read-only session check
confirmed zero remaining sessions. The original development server remained up.

## Release boundary and remaining limits

These changes require the updated trusted-worker bundle as well as the website.
No production deployment, daily-monitor Vault target or customer account was
changed by this task. Local acceptance and build results do not establish that
the public website is running this revision.

This does not complete other exclusion headings/years, 2025–2026 regimes,
non-China metal arrangements, derivatives, quotas, Commerce exclusions, AD/CVD,
preferences or arbitrary Chapter 99 legal prose. Missing origin, classification,
entry-time or qualification facts remain explicit review requirements.
