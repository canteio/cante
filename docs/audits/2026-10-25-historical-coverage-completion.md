# Historical coverage completion — October 25, 2026

Active implementation, audit engine v8. Local changes are not deployed. The
[completion ledger](../plans/historical-coverage-completion.md) remains open.
This record distinguishes verified additions from the remaining work.

## Implemented and locally checked

- Shipment mapping: timestamps with explicit valid offsets, entry types,
  manufacturer/exporter, AD/CVD cases and payment stage, metal/U.S./dutiable
  values, metal weight, and second/third quantities. Old saved mappings remain
  readable. Original declarations survive dated evidence corrections.
- Shared exact engine: evidence-backed value bases, matching quantity selection,
  conflicting-quantity rejection, and content credit caps retaining fractional
  cents until payable duty rounding. Generic snapshots cannot silently absorb
  preferential claims, company cases or special entry types.
- All EU origins, Switzerland/Liechtenstein, Japanese and Korean combined
  arrangements, India's additional duty/termination and August 1–6 extension.
  Twelve selected read-only actual-source goldens passed.
- June 2026 consolidated metal text: eleven complete lists, validated operative
  paragraphs, full-value rates, weight thresholds, U.S./UK qualification,
  equipment/combined rates and supported overlap exemptions. Changed text does
  not establish a negative metal-scope proof. Five selected actual-source metal
  goldens passed; broader historical dates are not claimed.
- CBP's current anonymous public AD/CVD read service, complete bounded case-index
  validation, immutable original headers/bodies and a narrow company-deposit
  grammar. One public example case retains its 289-message index and twelve
  cash-deposit message header/body pairs (25 sources). Scope/court/party/case
  completeness requires explicit dated evidence. Deactivated case numbers do
  not inherit old rates. Cash deposits are distinguished from final assessments.
- The additional AD/Section 301/metal example passed independent arithmetic:
  25% + 50% + 28.28% on a fictional USD 1,000 shipment = USD 1,032.80. This uses
  fictional shipment qualification, not a real customer's entitlement.

Thirty additional original CSMS guidance captures and the 25 AD/CVD sources were
retained using operator-only publishing. No customer records, legal approvals,
reviewer appointments, schema permissions, schedules or delivery settings changed.

## Verification

TypeScript, 119 focused tests, 931 existing regression tests, isolated website
build, trusted-worker build and worker fixture tests passed. The worker fixture
uses mocked REST responses; it is separate from actual database acceptance.

The existing 120-line 2019–2026 original-source regression and four combined-rate
cases still pass: 115 calculable lines and five intentionally invalid HTS lines.
A new 120-line fictional ledger spans twelve country/metal/deposit scenarios.
Read-only actual-source acceptance passes all expected reviewed amounts, exact
payment differences and CSV output. Forty rows initially withhold totals until
required shipment evidence is supplied; all 120 calculate after the fixture's
explicitly fictional evidence decisions. These results do not establish legal
accuracy for arbitrary customer shipments.

Real isolated Auth/database/worker acceptance passed the 120-line upload, mapping,
immutable duplicate upload, initial calculation, forty dated evidence decisions,
recalculation, report and original-file hashes. The reviewed result has 120/120
calculations, USD 76,000 potential overpayment and USD 328 potential underpayment
on the fictional ledger. Cross-company HTTP detail/export reads and direct result
reads were denied. Twelve inactive SKU associations contain no invented current
origin, price or tariff facts.

Browser acceptance verified the saved report, underpayment filter, AD/301/metal
components, payment-stage disclosure and CSV download. A timestamp correction
through the real review form created revision 42, automatically recalculated,
kept the expected USD 1,032.80 on that fictional line and appeared in the exported
review evidence. Earlier declarations and saved versions remain. Screenshot:
`/tmp/cante-coverage-audit-results.png`; private execution artifacts are outside
the repository. The fixture account was signed out in the browser; the harness
finished and banned both fixture identities. A redundant revocation call after
browser logout reported failure; the live aggregate database check confirms zero
sessions for banned audit fixtures. Both temporary servers stopped.

The first live attempt omitted the fixture’s explicit program-exception
declaration and correctly withheld totals; the harness configuration was fixed.
The next attempt exposed review writes charged to the file-upload allowance
(20/hour). Reviews now use the existing shared calculation allowance (60/hour),
with the same authentication, tenant checks, 16 KB body limit and database quota
enforcement. The successful run verified forty real review writes. No global
quota or database access rule changed.

## Unfinished scope / concrete source conflicts

The full completion ledger remains applicable: earlier modern metals and country
arrangements, mobile equipment, other Section 232 sectors, Column 2, broader
AD/CVD grammars and final assessments, preferences, temporary reductions,
exclusion renewals and entry/transit/warehouse/FTZ boundaries still need work.

In particular, the retained June 2026 consolidated Section 122 paragraph prints
9903.82.04 twice where later text uses 9903.82.02 plus the .04–.26 range. Cante
currently withholds that affected overlap instead of silently correcting it.
Mobile-equipment combined/content treatment also needs consistent source coverage.
Motorcycle heading 9903.82.13 does not receive the Section 122 overlap exemption.
Source capture alone does not resolve either issue.

The latest production website and configured daily worker target are unchanged.

## Follow-up after browser verification

Per-component China 301 citations were narrowed to the actual 301 note/actions,
so unrelated metal/country/AD sources no longer clutter that component. Overlap
exemptions now explain which independently established metal treatment removes
which additional program. Earlier auto-extracted observations sit in a labeled
collapsed disclosure rather than appearing as calculation rules. Duplicate
company cases under the same AD/CVD order cannot charge one line's full value
twice. These follow-up changes passed focused checks, refreshed website/worker builds and the subsequent live browser acceptance.


## October 26 Canada/Mexico and review form acceptance

Nine additional read-only official-source goldens pass ordinary non-preferential
Canada/Mexico border duties, reciprocal exemptions, IEEPA termination and the new
2026 Note 52 rates. The published later rates are 10% for both countries; the old
35%/25% border rates are not carried forward. Energy, potash, USMCA, transshipment
and special treatment require separate evidence and are not inferred.

A second real isolated Auth/database/worker run passed nine fictional entries,
five evidence reviews, immutable originals/versions, CSV export and tenant denials.
Initially four lines calculated; after evidence, all nine calculated, showing
USD 6,180 potential overpayment and USD 32.80 potential underpayment. These are
fictional fixtures, not customer findings or legal accuracy certification.
Browser acceptance confirmed the report, border components, narrower citations,
CSV and a review form with three relevant fact selectors; other qualifications
remain accessible in a collapsed disclosure. Known facts explicitly say they are
kept unless changed. Both fixture identities were signed out/banned, execution
finished, temporary servers stopped, and the aggregate database query confirmed
zero sessions for banned audit fixture accounts. Screenshots are outside the repo:
`/tmp/cante-border-review-form.png`, `/tmp/cante-border-audit-results.png`.

Official-reference metadata network failures are now distinguished from absent
records rather than being mislabeled as missing historical law. No migrations,
permissions, customer data, legal approvals, schedules or deployment changed.


## October 26 exact entry-time continuation

The deterministic path now compares actual instants in America/New_York against
explicit original 00:00/00:01 clauses. Date-only entries, inconsistent dates,
publication/ACE clocks, changed wording and unsupported preceding-minute rules
cannot establish the new treatment. Selected original China 301 actions retain
proved legal cutoff times; old date-only contracts do not gain that authority
from a supplied timestamp. Non-China entries do not inherit a China-only cutoff.

Program snapshots pin the supplied timestamp and original cutoff references;
calculation rejects a snapshot compiled for a different instant. CSV facts retain
the applied timestamp. IEEPA termination at 00:00 and Section 122 start at 00:01
are distinct. India's additional-duty termination uses its own 00:01 clause.

The February 24 entry-date HTS edition predates the new Section 122 note. Only
that date may pin the first February 25 consolidation's exact 122 table, alongside
the retained original proclamation proving the earlier effective date, 10% rate,
stacking and cutoff. The shipment's base rate and other programs still use its
entry-date edition. No generic later/current schedule substitution is allowed.

Required program qualifications now condition components and base-replacement
instructions as well as coverage, so missing or false qualification cannot show
an unsupported charge as applied. Totals already withheld in these cases.

A newly exercised August 23, 2018 motor row remains unresolved because the exact
statistical row is outside the old PDF layout parser. The published annual 8-digit
rate and a correct change time are insufficient to invent the 10-digit lookup.
This is a concrete remaining source-extraction gap, separate from cutoff proof.

The 119 focused tests, TypeScript, 931 existing regression tests, refreshed
isolated website/worker builds and mocked worker tests pass. A stricter entry-only
cutoff parser also matches 22 retained original clauses; FTZ/publication/ACE clocks
cannot supply the entry cutoff. Read-only acceptance passes eighteen selected
2025–2026 calculations plus the explicitly unresolved 2018 PDF lookup. The prior
120-line original-source regression and four combined-rate cases still pass.

Real isolated Auth/database/worker acceptance passes the nine-line change-day
ledger, four dated corrections, preservation of declarations and prior results,
export and tenant denials. Five initial lines calculate; all nine calculate after
the fictional evidence decisions, with USD 6,420 potential overpayment. Browser correction/export acceptance also passed: moving fictional line 5 from
00:00:59 to 00:01 Eastern created revision 6, changed expected duty from USD 290
to USD 390 and the ledger estimate from USD 6,420 to USD 6,320. CSV retains both
timestamps and the original declaration. Screenshot:
`/tmp/cante-cutoff-audit-results.png` (explicitly synthetic data). The fixture
browser was signed out and closed, the harness finished, both identities were
banned, and temporary servers stopped. Redundant revocation after browser logout
again reported failure; the live aggregate query independently confirms zero
sessions for banned audit fixtures. The existing port 3000 server is untouched.

Acceptance used isolated build `cante-history-build-nBgpQP`; the subsequent
entry-clause-only guard passed its 40 focused checks, 22 original clauses, the
full 119-test focused set, worker fixtures and refreshed isolated build
`cante-history-build-Tz5flL`. No production deployment, daily target, legal
approvals, tenant permissions or schema changed.
