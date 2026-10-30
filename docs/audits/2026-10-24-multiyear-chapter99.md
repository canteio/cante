# Historical years and Chapter 99 expansion

Working-tree implementation, October 24–25, 2026. This extends the existing audit
workflow and deterministic stacking engine. It does not establish universal
historical legal coverage, human approval, or production deployment.

## Implemented

- The historical China-list compiler accepts dated 2018–2026 editions. A rule
  printed before its effective date activates on the legal date. The original
  actions and entry date control; publication and capture dates do not activate
  a duty early. Before-effect claims are identified without charging that duty.
- The exclusion compiler reads older retained Section 301 definitions and their
  original CBP implementation windows. It handles repeated-letter note sections,
  nested Roman groups, product numbers without spaces, explicit statistical-code
  changes, and explicitly numbered/dated partial renewals. A partial renewal never
  extends every product under a heading. Product qualification still needs a
  dated, evidence-backed decision. Duplicate or inconsistent product definitions
  remain outside the supported scope and are counted visibly.
- CBP implementation originals establish the supported 2025 China fentanyl and
  reciprocal duty intervals, extensions, changes and independent stacking.
  Selected non-China reciprocal treatments are supported, including published
  combined EU rates. Some country arrangements still require separate contracts.
- The supported 2026 intervals distinguish IEEPA collection through February 23,
  Section 122 from February 24 through July 23, and the new Note 52 country duties
  from July 24. These are historical entry-charge comparisons; later court/refund
  eligibility is not determined by the audit.
- Complete HTS-only exemption tables are checked automatically for reciprocal
  heading 9903.01.32, Section 122 heading 9903.03.03, and Note 52 heading
  9903.05.86. HTS mentions in descriptive/end-use clauses are not treated as
  unconditional exemptions. Mixed heading/subheading/statistical-code table
  cells retain their original boundaries.
- Published combined-rate pairs use exact decimal threshold comparisons. A
  below-threshold combined heading replaces the ordinary base, rather than
  adding a second full percentage. This avoids double charging and cent-rounding
  errors. Specific/compound base rates need their own equivalent-rate support.
- A dated General-column PDF reader supplies Chapter 99 heading references from
  pinned originals. Special and Column 2 percentages cannot become General rates.
  This request-local projection is never published as a complete HTS chapter.
- Ordinary estimates can handle goods outside the China lists when the required
  scope is established. Unclaimed Chapter 9902 reductions remain disclosed
  research leads; a Section 301 qualification decision is not a claim under every
  other referenced provision. Known unsupported metal scope still withholds a
  combined total. Pre-existing primary China metal support remains in place.
- Import review has an explicit optional declaration for 2025–2026 full-value
  program estimates. Older saved options default to no such declaration.
  Entry-specific evidence decisions can override a declaration; a false or missing
  required fact does not generate a complete total. This declaration does not
  approve rules or infer origin, metal content, end use or positive qualification.
- The May–June 2019 List 3 transition requires an explicit transit-clearance fact;
  a normal import declaration does not resolve reduced transit treatment.

The existing ordinary annual-data path for 2000–2017 remains. Its supported
methods and country-note conditions have not become universal Chapter 99 coverage.
The engine is `historical-audit-v7`; v1–v6 results remain readable and immutable.

## Bounded processing and data access

Audits pin up to 512 immutable source versions and retain the release registry.
The trusted worker processes up to 25 contiguous lines from the same calendar
month at a time and saves progress after each group. It continues between bounded
requests; the client permits at most six continuation requests and retains the
existing shared database admission quotas.

The execution cache is request-local: 64 MB of verified originals, 32 MB of text
and 4 MB of source metadata. Existing per-group legal-text, annual-data, PDF/page
and archive-expansion bounds remain. Sources from irrelevant later years are not
read for older groups. Each entry retains its used sources plus its edition
originals, instead of duplicating all unrelated global notices.
Only guidance needed for the requested program interval is decoded, and annual
archives are skipped when a supported exact-code rate is already established.
Original downloads have a 45-second attempt deadline and one transient-read retry
inside the enclosing worker deadline. Permission, missing-object, size and hash
failures do not receive that retry. The retained original remains authoritative.

The reproducibility fingerprint pins original input hash, mapping, explicit
options, rule/source IDs, decisions, catalogue links and engine version. Immutable
source rows and original/stored-byte hashes are checked during execution. Cached
bytes have already passed that verification; hashes do not create legal approval.
A worker execution proof is still required before stored results can be shown as
verified calculations.

Two migrations are applied:

- `20261024162000_cbp_official_reference_urls.sql` adds only CBP's official
  USDHSCBP attachment/bulletin paths to the original archive's URL constraint.
- `20261024210000_bounded_multiyear_audit_references.sql` increases the bounded
  pinned-reference array and preserves the existing refresh authorization.

No tables, tenant-access policies, global review appointments, schedules, delivery
settings or worker credentials were created or loosened. A live query confirmed
RLS on the three audit tables, no anonymous audit read, and the 512-reference
constraint. One CBP implementation chart and eleven CBP guidance originals are
retained. These are government evidence, not approved rule bundles.

## Verification

- Focused parser/engine tests cover independent dated totals, full-value and
  combined duties, HTS-only exemptions, missing facts, partial renewals,
  misleading adjacent columns, date boundaries, malformed input, source failures,
  future-effective rules, and original document identity.
- The existing 931-test regression passed. TypeScript and an isolated website
  production build pass. The actual worker bundle passes signed dispatch,
  tenant-scope, proof-integrity and checkpoint-resume fixture tests.
- The final focused suite has 78 passing cases, including bounded download
  retries and export date semantics. The export and UI distinguish calculation
  coverage from a law's original effective date; a narrowed edition interval is
  never described as the law's original start date.
- The existing 120-line 2000–2014 ordinary fixture passes against actual retained
  originals: 90 supported calculations and 30 intentionally unsupported/review
  cases. The prior 120-line 2024 Chapter 99 fixture also retains its independent
  expected results, including metal stacking and qualified exclusions.
- A new 120-line fictional ledger spans 2019–2026. Its amounts were entered from
  independent hand formulas, not generated by the engine. All 115 supported lines
  match the expected amounts; five deliberately unpublished statistical codes
  remain without totals. The fully reviewed fixture totals are USD 9,230 potential
  overpayment and USD 450 potential underpayment. These are fictional test amounts.
  A fresh read-only source run passed all 120 expectations and exports using 70
  pinned versions in 188 seconds. It made no model calls or writes. Earlier runs
  exposed two invalid negative-paid fixture amounts and intermittent downloads;
  the inputs and bounded source reads were corrected before this successful run.
- Four additional read-only original-source goldens pass for Germany's 2025 EU
  combined treatment and the 2026 Germany/Japan/Korea combined treatments. These
  check that a low base rate is replaced by the combined rate without adding the
  base a second time. They do not validate every country's arrangements.

Real isolated Auth/database/worker acceptance passed the 120-line history ledger:
upload, column mapping, duplicate reuse, protected execution, all initial amounts,
120-line CSV, original-byte preservation and cross-tenant denials. The first
calculation yielded at 70 lines and resumed to a verified completion. A dated
fictional qualification for 2019 line 6 then recalculated expected duty from
USD 290 to USD 40, retained the original blank exclusion declaration, and kept the
prior verified result readable. Only this line was qualified in the live test;
its summary is therefore distinct from the fully reviewed read-only fixture.
The auto-created SKU associations are inactive and contain no invented current
origin, value or tariff facts. No model calls, human approvals or customer
workspace writes occurred.

Browser acceptance used a separate local hostname and the final isolated website
build with no service key. It passed sign-in, Audits navigation, upload/column
mapping with unchecked qualification declarations, summary, the reviewed 2019
finding and real source links. The CSV download contains calculation coverage
fields and no inferred original-law start date. The final summary screenshot is
explicitly labeled SYNTHETIC. Test identities are signed out, sessions revoked
and accounts banned after acceptance; their immutable fictional audit histories
remain. The existing development server and its browser session are untouched.
The harness logged a second sign-out failure after browser sign-out; a direct
Auth database check confirmed both new test accounts are banned with zero active
sessions. Both temporary servers and the test browser tab were then closed.

## Relevant code

- `app/api/tariff/references/`: existing archive/store and historical compiler;
  `section301-chart.ts`, `exclusion-history.ts`, `chapter99-table.ts`,
  `cbp-guidance.ts`, `program-scope.ts`, `program-history.ts`,
  `combined-heading.ts`.
- `app/api/audits/{model,compiled-reference,engine}.ts`: facts, dated rule
  compilation and shared deterministic calculations.
- `app/api/internal/tariff-audit/route.ts`: bounded processing, pinned inputs,
  continuation, proof and checkpoint handling.
- `components/audits/audit-workspace.tsx`: import declaration, readable fact
  decisions and automatic bounded continuation in the existing page.
- `scripts/backfill-{section301-exclusions,cbp-historical-guidance}.ts`:
  operator-only evidence capture; no customer writes or approvals.
- `scripts/test-{chapter99-history,historical-programs}.test.ts` and
  `scripts/test-historical-coverage.test.ts`: synthetic behavioral tests.
- `scripts/test-fixtures/historical-audits/chapter99-history-*` and
  `scripts/verify-chapter99-history.ts`: fictional entries, explicit expected
  results and read-only actual-source acceptance.
- `scripts/verify-audit-pilot-workflow.mjs --history-only`: isolated real
  Auth/database/worker upload-to-export acceptance, including tenant isolation.

## Remaining coverage boundaries

This does not finish pre-2018 temporary Chapter 9902 reductions, every exclusion
renewal or descriptive product definition, all 2025 country arrangements, modern
metal/derivative/content-value programs, other Section 232 sectors, AD/CVD cases,
Column 2 combinations, special entry types, every quantity/compound expression,
or admissibility questions. Missing legal instruments, source-layout changes and
shipment qualifications still require support or evidence. Boundary-day entries
need actual entry-time treatment and do not receive a guessed full-day rate.

These limits must stay visible. Passing fictional tests is not broker review,
financial accuracy for an unknown customer ledger, or proof of a working hosted
release. Website/worker deployment and the daily monitor target are unchanged.
