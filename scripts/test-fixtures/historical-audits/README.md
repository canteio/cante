# Historical audit functionality fixtures

## Dated restoration fixtures

`2017-change-record.txt` and `2017-restored-column2-cells.json` retain public USITC
original text/table cells for strict source-contract tests; they contain no customer
information. The earlier annual/Basic Column 2 blanks and the corrected Revision 1
55% rate remain separate. Only the explicit January 1, 2017 restoration supplies a
date. The N/A wood correction remains undated. Chemical July 1 annotations are
proved as source facts; calculation integration remains separate.

`restored-column2-workflow-entries.csv` and its expected JSON contain 100 fictional
ordinary declarations. The first 90 use the three published tile suffixes and
January/June/October dates. Independent Python Decimal ROUND_HALF_UP amounts apply
55% to customs values 1000.50..1001.39; paid amounts differ by +1.00, -1.00 or 0.00
in repeating groups. Ten deliberately incorrect/unsupported lines remain open.
Expected: 90 calculated, 10 open, 60 differences, USD 30.00 over and 30.00 under.
A fictional dated review changes suffix 05 to 11 while preserving the original and
the identical expected duty. This fixture does not establish lawful origin,
classification, admissibility, full coverage, customer savings or refund rights.


## Exact-cap fixtures

`exact-cap-entries.csv`, `exact-cap-rules.json` and `exact-cap-expected.json` are
explicitly fictional functionality tests. The rules are synthetic drafts with
null approval fields; production rejects them. The one-day caps range from 1%
to 100% over a fictional 200% measure, January 1–April 9, 2024. Expiry restores
the fictional uncapped rate; a date outside the entire coverage has no total.
Nothing asserts an actual tariff law or human approval.

Expected results were generated independently with Python Decimal ROUND_HALF_UP:
for entry i=1..100, customs value is 1000.50, expected cents are
`(100050 * i + 50) // 100`. Paid amounts add 1.00 for i%3=1, subtract 1.00 for
i%3=2 and equal expected otherwise. Expected summary: 100 calculated, 67 differences,
USD 34.00 overpayment and 33.00 underpayment. Test every imported/calculated/exported
line against the retained oracle. These tests do not validate legal accuracy.

## Component fixtures

`watch-component-workflow-entries.csv` and `watch-component-workflow-expected.json`
contain 100 fictional lines/36 article groups. They exercise original-source
2016/2017 watch/clock reporting, independent component counts, explicit absent
zeros/dutiable jewels, missing/duplicate components, invalid codes, dated review
corrections and a value/classification conflict. Initial results: 73 calculated,
27 unresolved, USD 17.49 potential overpayment and USD 0.36 potential underpayment.
Eleven provided decisions yield 89 calculated/11 unresolved. An additional browser
HTS/count correction yields 90/10 and USD 21.09/0.36. These are fictional amounts.
`watch-statistical-page-cells.json` separately retains labeled public USITC page
cells for source/parser tests. `verify:watch-components` checks the source-backed
goldens; `verify:watch-component-scope` counts original contracts, not shipments.
No fixture is customer evidence, human legal approval or proof of complete law.
[Verification and remaining scope](../../../docs/audits/2026-10-27-statistical-components.md).

`us-metal-workflow-entries.csv` and `us-metal-workflow-expected.json` add 23
fictional U.S.-metal cases: 18 expected calculations, five deliberate missing/
conflicting-evidence or invalid-statistical-code outcomes. They distinguish the
original whole reciprocal exception, later content allocation, independent China
and border duties, India and Section 122, including its first-day amendment.
Hand arithmetic predicts USD 1,255 potential overpayment and USD 740 potential
underpayment. These are fictional test amounts, not customer savings.
`us-metal-overlap-clauses.json` and `us-metal-june-original-clauses.txt` contain
labelled public source excerpts. `verify-historical-us-metals.ts` independently
checks retained dated originals; `verify-historical-us-metal-scope.ts` reports
the early April 2025 edition gap instead of treating its earlier start as proof.
Neither a passing test nor a source download is human legal approval.

All entries, products, suppliers, evidence references and review decisions here
are explicitly synthetic. The rules in `rules.json` are synthetic; the separate
original-source fixtures use actual retained government references. They establish software behavior,
not historical tariff accuracy, legal origin, customer exposure or refund rights.
Do not seed them into customer workspaces or publish them as legal coverage.

`entries.csv` contains twelve cohorts of ten: correct payments, overpayment,
underpayment, incorrect stacking arithmetic, unconfirmed origin discrepancies,
missed exclusions, invalid HTS, missing evidence, date transitions, absent history,
classification discrepancies, and leading-zero/specific/compound-duty precision.

`expected.json` specifies independent line results and gross totals: 75 calculable
lines, 45 unresolved, 50 monetary discrepancies, USD 4,375 potential overpayment
and USD 600 potential underpayment. Conditional origin scenarios are excluded.
`decisions.json` supplies test-only dated evidence decisions. `rules.json` carries
`synthetic: true`; normal workspace execution and approval reject it.

Run `npm run test:audits`. Build the isolated worker with
`npm run build:check-worker`, then run `npm run test:audit-worker` for signed
dispatch, original retention, missing-coverage behavior, checkpoint resume and
execution-proof verification against isolated REST fixtures. That worker test
does not approve synthetic rules or access a real database or model.


For an interactive check, open `/audit-test` on the local development server.
It reuses the ordinary Audits screens and server-side calculations with these
fictional rules explicitly changed to unapproved drafts. No manual rule approval
is needed in that isolated test. Workspace approvals stay enforced; no customer
records are read or written. The page/endpoint are disabled in production and on
Vercel. Use Download test CSV → upload → confirm → run → review → export.

## Original-source estimate fixture

`official-reference-entries.csv` contains 120 fictional motor import lines, declared
as 8501.31.4000 on February 15, 2024, plus deliberately unresolved cases.
`official-reference-expected.json` is an independent hand-formula oracle: $1,000
customs value, 4% ordinary base duty, plus 25% legacy Section 301 for China.
The dated actual schedule and original 2018 USTR action must be retained to run it.
No preference, exclusion, AD/CVD, Section 232 or other additional treatment is
claimed; that declaration must be explicit at intake. Vietnam is a declared legal
origin for this fictional fixture, not inferred from a supplier move.

Expected: 100 calculated lines, 20 unresolved, $2,900 potential overpayment and
$2,700 potential underpayment. Missing HTS, unavailable editions, origin evidence
conflicts and exclusion claims are deliberately withheld. These results test
source lookup and arithmetic, not complete legal applicability or refunds.

## Chapter 99 original-source fixture

`chapter99-entries.csv` has 120 fictional entry lines in twelve cohorts, with
independent amounts and dated fictional evidence decisions in
`chapter99-expected.json`. Government sources and tariff rates are real; the
products, supporting documents and qualification decisions are fictional. This
is functionality verification, not a broker-reviewed customer audit.

Cohorts cover ordinary China duties; 2024 .67/.69 exclusions with and without
claims/evidence; expired and unknown headings; a whole-code pulley exclusion;
primary steel stacking; aluminum with and without Russian-content evidence;
Russia-only headings declared on China-origin goods; and missing HTS.

Before decisions: 40 calculated, 80 unresolved, 20 differences, $100 potential
overpayment and $2,500 underpayment. After fictional qualification decisions:
80 calculated, 40 unresolved, 70 differences, $10,100/$3,500 respectively. Unknown,
expired and missing-fact cases deliberately do not get invented totals.

Run `npm run test:chapter99` for synthetic unit contracts, and
`npm run verify:chapter99` for read-only actual retained-source calculations and
CSV export checks. `npm run verify:audit-pilot-workflow -- --live <isolated-build>
--chapter99-only` additionally creates isolated fictional Auth workspaces and
retains their immutable audit history. It is an explicit acceptance operation,
not routine setup; the script revokes/bans its identities afterward.


## Change-day workflow fixture

`cutoff-workflow-entries.csv` contains nine explicitly fictional shipments.
`cutoff-workflow-expected.json` holds independently entered amounts and four
fictional dated timestamp decisions. Initially five lines calculate and four need
entry times/scope evidence; after decisions all nine calculate. Expected potential
overpayment changes from USD 3,780 to USD 6,420, with no underpayment. Two February
24 lines fall on opposite sides of the 00:01 Eastern replacement-duty start.

`npm run test:historical-cutoffs` tests synthetic contracts.
`npm run verify:historical-cutoffs` reads retained official originals. Its expected
fixture now contains nineteen selected calculations: the initial 2018 PDF/list
case was separately verified after the v9 extraction fix. The full nineteen-case
command has not been freshly rerun since that fix. Actual legal qualification and
broker-reviewed financial accuracy remain separate validation.

`npm run verify:audit-pilot-workflow -- --live <isolated-build> --cutoff-only`
is explicit live acceptance using isolated fictional Auth workspaces, actual
Supabase/worker, upload, mapping, evidence revisions, immutable originals, reports
and tenant denials. It retains audit history and revokes/bans its fixture identities;
it is not routine setup or permission to use customer data as fixtures.


## Earlier-metal workflow fixture

`metals-2025-workflow-entries.csv` contains 120 fictional entries. Independent
expected amounts and 39 fictional dated evidence decisions are in
`metals-2025-workflow-expected.json`. Eighty-one lines initially calculate, with
USD 57,510 potential overpayment; 39 require material/value/smelt evidence. All
120 calculate after those decisions: USD 73,203 overpayment and USD 4,497
underpayment, kept separate. Cases include China before/after the metal increase,
reciprocal allocation, UK, changed Canada/Mexico priority, aluminum and positive
Russian smelt/cast evidence. These are functionality fixtures, not customer data
or proof of complete legal or financial accuracy.

`verify:audit-pilot-workflow -- --live <isolated-build> --metals2025-only` performs
explicit isolated live acceptance. It is not routine setup. Original declarations,
prior calculations, exact SKU links, reports and tenant denials are checked;
fixture sessions are revoked and identities banned after completion.


## April–June 2026 metal transition fixture

`metals-april2026-workflow-entries.csv` contains sixteen explicitly fictional
entries across the April 6–June 7 regime and its six publication windows. The
expected-results JSON specifies all amounts independently: initially sixteen
need qualification decisions; afterwards sixteen calculate, with USD 600 potential
overpayment and USD 250 potential underpayment. These are separate estimates,
not netted amounts or refund entitlements. The earlier 120-entry fixtures remain.

Cases cover full-value metal rates, China stacking, qualified UK and cumulative
95% U.S.-metal treatment, combined 10%/15% rates, subthreshold applicable-metal
weight, a no-metal declaration and the original retroactive correction, and a
motorcycle-use exception that retains the independent Section 122 duty.
The published statistical code for the fictional elevator parts is 8431310060;
the unlisted 8431310000 suffix must never be invented as a fallback.

`npm run test:historical-metals` tests bounded synthetic mechanics and published
text extraction. `npm run verify:historical-metals-april2026` reads actual retained
government originals using fictional shipment facts, with no writes or approvals.
Neither constitutes independent broker/legal verification.

Explicit live acceptance:
`npm run verify:audit-pilot-workflow -- --live <isolated-build> --aprilmetals-only`.
It creates isolated fictional Auth workspaces, tests upload/map/review/export,
immutable inputs and prior runs, and cross-company denial, then revokes and bans
its test identities. It is not routine setup and must not use customer records.


## Charged-metal allocation fixture

`metal-allocation-workflow-entries.csv` contains thirteen fictional entries with
independently entered amounts and dated decisions in the adjacent expected JSON.
The twelve ordinary cases match the read-only actual-source verifier. A thirteenth
line deliberately supplies metal values totalling more than customs value; its
evidence decision corrects the allocation without changing the original CSV.
All thirteen initially require evidence. After decisions, the expected summary
is thirteen calculated lines, nine differences, USD 500 potential overpayment
and USD 200 potential underpayment.

Only portions actually covered by metal duty are deducted from reciprocal or
Section 122 assessment values. Other metal content stays in the remainder.
Missing unrelated metal columns need not be invented as zeros. Full-value
metal treatment and the original Section 122 partial-value clause are tested
separately, including both sides of its first-day cutoff.

`npm run verify:historical-metal-allocation` is read-only source verification.
`npm run verify:audit-pilot-workflow -- --live <isolated-build> --allocation-only`
is explicit isolated real Auth/database/worker acceptance, not routine setup.
Keep all fixtures labelled synthetic; no customer records, human approvals or
production schedules are changed by this workflow. Passing fictional cases is
not independent legal or broker validation.

Copper v12 fixtures: `copper-note36-2025.txt` and the two copper metal-note
excerpts retain public USITC Note 16/19/36 text (2025 Rev17 and Rev22).
`copper-original-clauses-2025.txt` retains clauses 1/4/5 of proclamation 10962,
Federal Register 2025-14893; omitted material is marked with a synthetic boundary.
They test exact scope/wording contracts; fabricated notices/identities in unit
tests are not legal proof. `verify-historical-copper-scope.ts` independently
checks all 21 retained originals intersecting August 2025–April 5, 2026.

`copper-workflow-entries.csv` is an 18-entry fictional focused ledger. Its
`copper-workflow-expected.json` is a hand-calculated fixture (USD 1,000 values),
including China date changes, Vietnam/UK, Canada/Mexico border duties, aluminum
coexistence, explicit full-value assessment, zero copper, missing copper valuation
and missing filing kilograms. Two entries deliberately remain unresolved:
pre-cutoff treatment and an uncleared copper exception. Decisions are fictional
shipment evidence, never shared rule approval. Passing these tests is not proof
of legal/financial accuracy or universal copper or Section 232 coverage.

India/metal v13: `india-note2z-2025.txt` is a public USITC Note 2(z) excerpt.
The unit tests combine it with fictional source identities and shipment evidence;
they never adopt a CBP ruling's classification or specific factual holding.
`india-metal-workflow-entries.csv` has 16 fictional lines, with hand-calculated
expectations in `india-metal-workflow-expected.json`: steel/aluminum/copper,
mixed content, full-value assessment, zero copper, both cutoff instants, later
Section 122 treatment, and two deliberately unresolved missing-fact/time cases.
A zero-copper claimed exemption and an obsolete claimed heading are flagged even
when the complete monetary calculation is available. The original declarations
and earlier results must survive evidence revisions. Actual-source and real
isolated workflow checks are separate from these functionality fixtures.

April-start v15: `april-2025-original-clauses.txt` contains marked public original
clauses from Federal Register 2025-06063. The fourteen fictional lines in
`april-start-workflow-entries.csv` and hand-calculated
`april-start-workflow-expected.json` cover the original April 5 cutoff, April 5–8
U.S.-metal exceptions, independent China duties, valid/obsolete semiconductor
suffixes, a time correction and two intentionally unresolved cases. Initial
totals are five calculated/nine unresolved, USD 200 overpayment and USD 100
underpayment; fourteen fictional evidence decisions yield twelve calculated/two
unresolved, USD 500 overpayment and USD 550 underpayment. Browser correction of
line nine across the cutoff subsequently reduces underpayment to USD 450.
These amounts are fixture expectations, never customer exposure or refund proof.

`npm run verify:historical-april-start` checks retained originals read-only.
Explicit isolated real acceptance uses `--aprilstart-only`; optional
`--checkpoint-fault` simulates one lost response after a committed checkpoint
only in that named fixture. Neither option is routine production setup. Shared
rule approval, customer data and production schedules remain unchanged.

Annual quantity v16: `annual-quantity-code-key.txt` and
`annual-quantity-fields.txt` retain marked public USITC code/field excerpts.
Source identities in unit tests are fictional. The 21 fictional declarations in
`annual-quantity-workflow-entries.csv` cover methods 1–6, two distinct quantities,
component quantities, exact rounding, excise-only notes, missing/conflicting
quantities, dated corrections, legacy 2000 formats and intentionally conflicting
2016/2017 source fields. `annual-quantity-workflow-expected.json` contains hand
arithmetic: initially 13 calculated/eight unresolved; four fictional evidence
corrections yield 17 calculated/four unresolved. Initial over/underpayment is
USD 44.76/1.80; reviewed amounts are USD 140.60/1.80, shown separately. These are
functionality expectations on declared classifications/origins, never customer
exposure, independent legal validation or guaranteed refunds. Document references
and decisions are explicitly fictional; no customer documents are included.

`npm run verify:annual-quantities` checks retained originals read-only;
`npm run verify:annual-quantity-scope` inventories formula records across the
18 retained 2000–2017 originals. Counts are source records, not unique products
or completed audits. Explicit real isolated acceptance uses `--quantity-only`.
It writes only named fictional fixtures, then revokes and bans their accounts;
never use it as routine setup or substitute customer data.


Older component v21: `legacy-watch-workflow-entries.csv` contains 100 explicitly
fictional lines spanning 2000–2017; `legacy-watch-workflow-expected.json` keeps
independent arithmetic and evidence decisions. Initial 75 calculated/25 unresolved
become 91/9 after eleven supplied decisions, with USD 19.09 potential overpayment
and USD 0.36 underpayment. The final browser classification/count correction
should produce 92/8 and USD 22.69/0.36 while retaining the original declaration.
These are fixture expectations, not customer exposure or refund evidence.

`legacy-watch-{2000,2003,2004}-page-cells.json`, header-only cells and archive
excerpts are labeled public source parser fixtures. `legacy-watch-source-issues.json`
is an observational inventory, not a golden rate oracle: 14,000 narrow formula
contracts out of 14,064 repeated edition/component records across 48 originals;
64 source/date issues remain explicit. `verify:legacy-watch-scope` intentionally
exits with failure for these known issues. `verify:legacy-watch-components` checks
the 100 hand-calculated source cases read-only. Broader coverage remains unfinished.
Explicit `--watch-only --legacy-watch --engine-upgrade` acceptance writes only
isolated fictional workspaces and revokes/bans their identities afterward.


Ordinary country v22: `ordinary-country-workflow-entries.csv` has 100 explicitly
fictional declarations spanning 2000–2017 and 48 named ordinary origins. The
expected fixture includes both sides of the four original NTR country actions
(Vietnam, Afghanistan, Serbia/Montenegro and Laos), a claimed NAFTA preference,
Column 2 and special-entry cases, and two contradictory-origin lines. Initial
87 calculated/13 unresolved become 88/12 after the supplied dated FR→DE decision;
the final browser-only MX→CA correction should produce 89/11. Independent
fixture overpayment/underpayment totals are USD 150/145, 160/145 and 170/145.
These are fictional functional tests, not customer savings or legal approval.

`ordinary-country-clauses.json` retains public dated General Note 3(b) excerpts;
`ordinary-country-action-texts.json` retains complete public Federal Register
page text for contract tests. Synthetic wrappers/decisions are labeled. A text
hash guards the expected contract and never supplies fetch/approval authority.
`npm run verify:ordinary-countries` uses actual retained originals read-only;
explicit `--ordinary-country-only --engine-upgrade` acceptance writes only isolated
fictional workspaces and revokes/bans their identities at completion. Column 2,
preference qualification and special-entry calculation remain separate scopes.


Column 2 v23: `column2-workflow-entries.csv` contains 100 fictional declarations
across all 18 years, normal/Column 2 motor treatment, methods 0–7, a 155% rate,
complete original watch-component allocations, NTR boundaries, missing units,
unsupported procedures, a preference and origin conflicts. Independent hand
arithmetic is in `column2-workflow-expected.json`: 89/11 initially, 90/10 after
supplied review, 91/9 after the browser origin decision. Final fictional over/
underpayment is USD 2,184.75/3,689.95, not customer exposure or refund evidence.
Original lawful entry/classification/origin are declared assumptions.

`verify:column2` reads actual retained originals and checks CSV `tariff_column`;
`verify:column2-scope` inventories annual records, without original-schedule
corroboration or a shipment coverage claim. Explicit `--column2-only --engine-upgrade`
acceptance uses an actual retained v22 worker then v23, writes only named isolated
fictional workspaces and revokes/bans identities afterward. A bounded expired UI
hold is not a completed browser export; the final fresh run completed its export.

The older ordinary-country fixture now uses v23 expected results: eight formerly
null Column 2 motor lines calculate USD 350 from the same dated 35% originals,
changing initial/reviewed counts to 95/5 and 96/4 and underpayment to USD 2,600.
Earlier v22 saved database results remain immutable; dated v22 documentation
retains its original observed outcomes.

## Missing 2017 Column 2 calculation fields

`printed-column2-workflow-entries.csv` contains 100 fictional declarations;
`printed-column2-workflow-expected.json` retains independent hand equations and
expected cents. Eighteen lines exercise actual retained Free, 33 1/3%, square-
and cubic-metre, litre, compound/above-100%, wood/tile and Chapter 29 rates where
all four original calculation fields are empty. The originals remain empty;
complete agreeing same-year printed rates supply the computation. An intentionally
unpublished `0301930200` code remains unresolved: published statistical codes are
`0301930210` and `0301930290`, not an inferred `00` suffix.

Other lines retain 2000–2017 column selection, quantity/components, dated NTR
transitions, preference/missing-fact issues and evidence-backed origin revisions.
Initial: 89 calculated/11 unresolved, USD 262.50 potential overpayment and
2,071.00 underpayment. After the fictional DE evidence decision: 90/10 and
272.50/2,071.00. A separate browser CU origin decision on the last line yields
91/9 and 272.50/2,371.00. These are functionality fixtures, not legal approval,
verified country of origin, admissibility, actual exposure or refund entitlement.

Read-only: `node --import tsx scripts/verify-ordinary-pilot.ts --printed-column2`.
Real isolated acceptance additionally uses `--printed-column2-only --engine-upgrade`
with `verify-audit-pilot-workflow.mjs`; it requires the actual retained v23 worker,
creates explicitly fictional Auth workspaces and revokes/bans them afterward.
Never run it as ordinary setup or against a customer's records.

`verify-missing-column2.ts` inventories the 548 source records separately from
shipment calculations: 520 have agreeing recovered formulas across the 838
observed exact-code cases. The other 28 records require further source/scope work.
The scan is not a complete statistical-code catalogue or proof of legal coverage.
The wood/tile boundary and wood-unit cell excerpts are public originals with
source URL/content hash; hashes prove integrity, never legal approval.


## Column-specific temporary-heading notes (v25)

`scoped-column2-workflow-entries.csv`/`-expected.json` retain 100 fictional lines
and independent hand equations. Three cases exercise original General-only 9902
references with separate Column 2 rates. Initial: 89 calculated/11 open, USD
262.50/2,071.01 over/underpayment; dated DE evidence gives 90/10 and 272.50/2,071.01.
The browser weight correction on line 55 preserves 25 kg and uses 20 kg:
1000 × 51% + 20 × 0.154 = USD 513.08, difference 10.77; aggregate 273.27/2,071.01.
This fixture does not make the prior fixture's browser origin decision.

Read-only: `node --import tsx scripts/verify-ordinary-pilot.ts --scoped-column2`.
Real isolated acceptance uses `--scoped-column2-only --engine-upgrade` and the
actual preserved v24 bundle. It writes only explicitly fictional workspaces,
then revokes/bans their identities. Never use customer records as test fixtures.
`annual-general-note-cells.json` contains public original cells/widths and source
identity for positive and ambiguity tests. The source-formula scan now recovers
533/548 records, 856/887 observed cases; 15 still require work. Passing synthetic
functionality tests do not prove legal accuracy, actual savings or refund rights.


## Original table boundaries (v26)

`boundary-column2-workflow-entries.csv`/`-expected.json` contain 100 fictional
entries and independent cents. The exact published 3705000000 and 4421918800
rows test a description at x110.72 and the final table rate at y41.953.
Their Column 2 rates are 25%/35%, with original MFN separately Free. Public
photo/paddle cell excerpts test the boundaries, suffix separation and footer
rejection. Initial 89 calculated/11 open, USD 262.50/2,071.01; dated DE evidence
adds one calculation and USD 10 potential overpayment. Browser evidence corrects
line 55 from 3705000000 to 4421918800, retaining its original and changing duty
USD 250→350: final 90/10, USD 262.50/2,161.01. These are fictional amounts, not
legal approval, classification/origin verification, customer savings or refunds.

Read-only: `node --import tsx scripts/verify-ordinary-pilot.ts --boundary-column2`.
Real isolated acceptance uses `--boundary-column2-only --engine-upgrade` and the
actual preserved v25 worker; it retains only explicitly fictional history and
revokes/bans its identities. Never use a customer's records as test fixtures.
The full missing-field scan now has observed codes for all 548 records and
recovers 535 source formulas (858/889 observed cases); 13 need further work.


## Dated statistical codes (v29)

`dated-codes-workflow-entries.csv` / `-expected.json` contain100 explicitly
fictional entries with independent Decimal/half-up amounts. All six published
29181700/29313900 codes exercise MFN/Column2 before/after July1,2017; negative
cases include wrong-date/unknown suffixes and missing or wrong required units.
84 calculate/16 remain open. The browser correction keeps original2918170001
and uses documented2918170000 for June30: duty401.74,difference98.26. Final
85/15,USD126.26over/28.00under. These are fictional estimates, never customer
savings, classification verification, human legal approval or refund rights.

`2017-annotated-codes-cells.json` retains public original page cells and source
identity. Source codes stay as actually printed in each edition; no aliasing.
Read-only source verification: `node --import tsx scripts/verify-ordinary-pilot.ts
--dated-codes`. Real isolated acceptance adds `--dated-codes-only --engine-upgrade`
to `verify-audit-pilot-workflow.mjs` and requires the actual preserved v28worker.
It creates only named fictional workspaces and revokes/bans identities afterward;
never run against customer records or as routine setup.


## Complete-article rate references (v30)

`2017-related-article-cells.json` retains public original page cells and annual
rows. `related-article-workflow-entries.csv` / `-expected.json` contain100 fictional
entries, separate declared article codes and evidence decisions, with independent
Python Decimal half-up amounts. Initially100 open; reviewed84/16,USD28over/21under.
No fixture decision approves a shared law, classification or refund entitlement.

Read-only source verifier: `node --import tsx scripts/verify-related-article.ts`.
Real isolated acceptance uses `--related-article-only` with the existing pilot
harness. It reviews only three relationships, preserving all initial nulls;
browser then supplies line85's missing article9005100040. Original accessory
9620001500/blank related code remain; expected600.80,difference1.00. Final real
fixture4/96,USD2over/1under, not the84-line read-only oracle. Identities are revoked
and banned afterward. Never use customer records as routine fixtures.


## Mexico named deposits and combined duties (v31)

`adcvd-mexico-public.json` contains selected public original messages with header/
body URLs and original hashes; it is not a complete case-history fixture.
`mexico-deposit-workflow-entries.csv` / `-expected.json` contain100 fictional
entries,dated evidence decisions and an independent Decimal half-up oracle.
Nine profiles exercise named exporters and before/after2025/2026 deposit changes,
independent50% steel,baseFree and documented country-program overlap exemptions.
Initial100open; reviewed81/19,USD27each over/under. Open controls include missing/
wrong parties,root-only/unknown cases,wrong origin,final-assessment stage,missing
scope/instruction evidence,preferences,special entries and invalid input.

`npm run test:adcvd` tests parser/source contracts. Read-only actual-source check:
`npm run verify:historical-adcvd`. Real isolated pilot acceptance uses
`--mexico-deposit-only --engine-upgrade`,actual preservedv30 worker and no model.
It reviews only3cases plus a pending row85 decision,then upgrades31 with unchanged
sources/facts. Browser supplies row85's missing exact exporter and renews3ADfacts:
expected821.60,deposit320.93,steel500.67,diff1.00. Original blank stays. Real final
4/96,USD2over/1under is distinct from81-reviewed read-only testing. Identities are
revoked/banned afterward; customer records are never disposable fixtures.
These are functionality tests,not legal qualification,actual savings or refunds.

## Evidence correction regression (v32)

`mexico-evidence-workflow-entries.csv` / `-expected.json` retain100 fictional
entries and explicit expected results. Read-only verifier:
`node --import tsx scripts/verify-mexico-deposits.ts --evidence-corrections`.
81reviewed calculations become80 after hypothetical row1HTS correction without
renewed AD facts,then81 after restoration+4facts. Guarded export keeps original
7214200000,applied7207110000 and blank expected duty.

Real isolated acceptance: `--mexico-evidence-only --engine-upgrade` uses actual
preserved31 then32,only first3 reviewed plus pending85. Old31calculates3;32withholds
row1;browser restores its classification+4facts,ending3/97. Expected820.91 is
320.66deposit+500.25steel. This is not the81-reviewed oracle or real savings.
Old outputs,declared inputs and decisions stay. Auth fixtures are revoked/banned;
never use customer records as disposable fixtures. No shared approval is made.

## Canadian AD/CVD deposits (v33)

`adcvd-canada-public.json` holds selected actual public CBP instruction bodies
and headers for parser regressions. It is not a complete case archive or approval.
The runtime requires its separately retained complete public indexes and every
deposit original. Paired rows require the exact supplied producer and exporter;
all-others and unspecified producer fallback are not inferred.

`canada-deposit-workflow-entries.csv` / `-expected.json` contain 100 fictional
declarations and dated evidence decisions. Reproduce them with
`python3 scripts/generate-canada-audit-fixture.py`, using Decimal half-up rounding
for each component. Profiles cover amended named AD and CVD rates, independently
stacked Canada border duties and explicit producer/exporter exclusions. Controls
include missing/wrong parties, unknown/root-only cases, final assessment, missing
qualification, unsupported preferences/entry procedures and invalid inputs.

Read-only actual-source verification: `npm run verify:historical-canada`.
Initial 100 are open; fictional reviewed decisions yield 81 calculated/19 open,
USD 27 each potential over/underpayment. All amounts and CSV fields are checked.
This is not evidence of legal qualification, actual savings or refund entitlement.

Real isolated acceptance uses `--canada-deposit-only --engine-upgrade`, preserving
the actual v32 worker before building v33. Only three cases and a pending line85
decision are reviewed: old32 stays null; new33 computes three. Browser supplies
line85's missing exporter and renews three AD/CVD facts, targeting four calculated
lines with unchanged original declarations. Do not confuse this staged workflow
with the 81-reviewed read-only oracle. Retain results and revoke/ban isolated
fixture identities afterward; customer records are never disposable test data.

## Wood duties and original cubic units (v34)

`wood-workflow-entries.csv` / `-expected.json`:100 fictional declarations,
28 dated country/product profiles,81 explicitly qualified calculations and19
incomplete controls. Reproduce with `scripts/generate-wood-audit-fixture.py`.
Independent Decimal component rounding covers wood with separate Canada deposits,
China301/fentanyl, country exceptions, cabinet-usefalse, preceding-minute entries,
Korea/Taiwan agreement cutoffs and the postponed2026 increases. No claim of
actual shipment qualification, savings or legal/financial completeness is made.

`wood-note37-public.json`, `wood-supporting-public.json`,
`eu-reciprocal-public-rows.json`, `china-list3-04-public-row.json` and
`wood-unit-2025-page-cells.json` are actual retained public-source excerpts with
source identity. Excerpts are parser fixtures, not substitutes for complete
runtime originals or human approvals. The cubic-unit fixture preserves exponent3
and footnote2/; it must not become an unconditional `$1.70/m` calculation.

Read-only: `npm run verify:historical-wood`. The optional `--replay` requires an
exact-input local source snapshot from the fresh read. It checks all100 amounts,
component amounts, CSV output and reclassification evidence invalidation.
Real isolated acceptance: `--wood-only --engine-upgrade`; preserve actual33
before building34. Old33 has27 incomplete totals, explicitly recorded in
`wood-v33-observed-baseline.json` as observed software behavior, not correct
legal duties. Preserve those originals;34unreviewed entries staynull,then3 reviewed
lines compute. Browser supplies line85 cabinet-use evidence, targeting4calculated.
That saved acceptance is separate from the81-reviewed read-only oracle. Retain
all prior results; revoke/ban the isolated fixture identities after browser checks.
