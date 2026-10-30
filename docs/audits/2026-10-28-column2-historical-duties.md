# Historical Column 2 duties

October 28, 2026 · audit v23 · full historical coverage remains in progress.

## Implemented

The existing annual compiler now retains separate Column 2 method, ad valorem,
specific and other-duty fields, their printed text and field-presence markers.
The original MFN fields/rates remain unchanged. Column 2 replaces the base tariff
column when the validated dated General Note 3 selects it; it is not stacked on
MFN. Source selection, country transitions, quantities and corrections use the
existing immutable audit/reference/review workflow.

The original government [field definitions](https://dataweb.usitc.gov/assets/content/annual-tariffs/td-fields.pdf)
explicitly distinguish Column 2's numeric fields. The
[computation code key](https://dataweb.usitc.gov/assets/content/annual-tariffs/td-codes.pdf)
applies to rate-type-code fields, including Column 2. Both retained documents are
required, with their matching documented quantity meanings. Current documentation
explains the file format; the original dated annual record and country law supply
the historical rate and eligibility. Today's tariff rates are never substituted.

Methods 0–7 reuse existing exact arithmetic. Percentages above 100% are supported;
quantity positions and content/weight/count units remain explicit and separate.
A compound formula is added exactly before one cent rounding. Shared reviewed
stacking still applies. Missing units, conflicting quantities, missing fields,
changed rate text, unsupported methods and additional legal conditions do not
silently become zero or the MFN rate.

The same-year original-schedule corroborator can reconcile separately retained
Column 2 precision in the known 2016/2017 source format. Complete printed annual
and applicable original-column formulas must agree. Numeric extraction values stay
visible; only the exact documented two-decimal loss is reconciled. Conflicting
originals withhold the result. No convenient edition/rate is selected.

The existing Chapter 91 Statistical Note 1 compiler now also uses complete original
Column 2 article formulas and allocates each charge to its exact reported component.
All declared components, separate customs values, quantities and complete article
total must reconcile. General-column formulas and sentinel numeric fields cannot
supply Column 2. Contemporaneous original publication windows remain coverage
bounds; a later statistical table does not backfill an uncovered date.

Both sides of the retained VN/AF/RS-ME/LA NTR transitions use the correct column.
The compiled interval is bounded to the entry's side of the original legal start.
Publication and capture dates do not replace operative dates. Origin evidence
corrections are dated and preserve original declarations/prior results.

These are labeled conditional Cante-validated customs-duty estimates on declared
classification, legal origin and lawful ordinary-entry scope. They do not determine
sanctions, import authorization, admissibility, classification, legal origin,
preference qualification, final legal liability or refund entitlement.

## Integration

- `app/api/tariff/references/annual-data.ts`: original Column 2 data, independent
  field contract, ephemeral column projection, shared formula/corroboration paths.
  The projection is never persisted over MFN data.
- `app/api/tariff/references/store.ts`: scoped original-column evidence, request
  cache, complete source IDs and visible gaps; existing byte/page bounds remain.
- `app/api/audits/compiled-reference.ts`: dated column selection, one base measure,
  correct sources/coverage and explicit assumptions.
- `app/api/audits/engine.ts`: selected-column arithmetic/component reconciliation,
  missing-coverage reasons and no inapplicable MFN scenario on a Column 2 origin.
- `app/api/audits/model.ts`: v23; v1–v22 historical results remain readable.
- `app/api/audits/store.ts`: CSV adds `tariff_column`, retaining both original
  tariff fields, decisions, missing evidence, quantities, citations and raw input.
- `components/audits/audit-workspace.tsx`: selected column and retained MFN/Column 2
  rates appear within the existing finding. No new tab/configuration workflow.

No schema, grant, dependency, service, `lib/` module, global rule approval, customer
record, daily opt-in/target or deployment changes. The existing engine-refresh
migration remains required; website and protected worker must be released together
when deployment is authorized. Local acceptance does not update hosted behavior.

## Actual source inventory

A read-only scan accounts for 235,624 ordinary Chapter 01–97 records whose source
interval overlaps the captured 2000–2017 file year. Every archive has the separate
Column 2 headers; some records have empty values. Counts are repeated annual/
effective-date records, not distinct tariff laws or customer shipments.

| Source method | Records |
|---|---:|
| 0 | 11,738 |
| 1 | 24,122 |
| 2 | 682 |
| 3 | 50 |
| 4 | 23,489 |
| 5 | 2,661 |
| 6 | 221 |
| 7 | 168,311 |
| 9 | 996 |
| T | 2,360 |
| K | 256 |
| X | 171 |
| `?` | 19 |
| Empty method/numeric values | 548 |

5,946 records have an ad valorem fraction above one. 213,077 have a printed-rate
column; absence in legacy files differs from a present-but-empty value.
The numeric-fields-only baseline finds 207,620 formula/footnote contracts ready,
12,257 method/printed-formula/field/unit issues and 15,747 additional footnotes.
This inventory does not execute original-schedule/statistical corroboration,
country decisions or actual shipment checks. Those issue counts are not the
current engine's unresolved shipments or a count of missing laws.

Known remaining work includes 2017's 548 missing method/numeric records (some
retain complete printed rates), `?`/check records, other T/9/K/X procedures,
conditional notes/units, uncovered publication windows and later Column 2 law.
The wider ledger also retains preferences, temporary reductions, remaining metals/
other Section 232, broader AD/CVD/assessment and special-entry/cutoff cases.
The completed cases here do not close those broad scope requirements.

## Verification

`column2-workflow-entries.csv` contains 100 explicitly fictional declarations and
an independent expected-results fixture. It spans all 18 years, normal/Column 2
motor rates, every numeric method 0–7, a 155% rate, complete original watch-component
allocations, both sides of NTR changes, missing units, unsupported procedures,
origin conflicts and a preferential claim. 194 source versions are pinned.

| Stage | Calculated | Unresolved | Potential overpayment | Potential underpayment |
|---|---:|---:|---:|---:|
| Initial | 89 | 11 | USD 2,174.75 | USD 3,389.95 |
| Supplied FR→DE origin decision | 90 | 10 | USD 2,184.75 | USD 3,389.95 |
| Verified final browser JP→CU decision | 91 | 9 | USD 2,184.75 | USD 3,689.95 |

All 100 actual-source initial/reviewed goldens and CSV column checks pass read-only.
The prior 120 ordinary cases pass unchanged. The prior 100 ordinary-country cases
now calculate the eight newly supported Column 2 motor lines: 95/5 initially and
96/4 after supplied review; expected values change from null to USD 350 based on
the same retained 35% original, never from a generated numerical oracle. Prior
100-line watch-component source expectations remain unchanged.

95 focused cases (including eight Column 2 tests), 931 regressions, TypeScript,
isolated website/worker builds and actual bundled-worker fixture tests pass.
The worker fixture separately verifies signed dispatch, tenant scoping, output
proof, five bounded writes for 120 mixed-year groups and interruption/retry recovery.
Synthetic API fixtures are not real database or legal accuracy evidence.

The first real Auth/database/actual v22→v23 worker run passed unchanged-source
refresh, pending idempotency, all numerical expectations, evidence review/export,
original hashes and foreign HTTP/RPC/direct-row denial. Browser correction also
finished and its four protected result snapshots independently verify. Its bounded
20-minute UI hold expired during an interruption before the browser export;
servers stopped and SQL confirmed 74 banned fixtures, zero active fixtures/sessions.
That attempt is not claimed as a completed browser export. Fresh isolated fixture
workspaces are used for the final browser check; revoked credentials are not reused.

The fresh isolated run also passes all real workflow checks. Browser revision 4
confirms the original JP declaration and reviewed CU origin separately, applies
35% Column 2 to USD 1,000, and shows USD 350 expected duty / USD 300 potential
underpayment against USD 50 paid. The retained MFN rate remains 4%; it is not
added to or substituted for Column 2. No supplier address establishes origin.
The final downloaded CSV verifies all 100 rows, 91 calculated/9 blank unresolved
amounts, separate USD 2,184.75 overpayment / USD 3,689.95 underpayment, both sides
of the NTR boundary, a 155% duty and all four article-component allocations.

Independent read-only verification hashes all 400 output rows and four protected
aggregate proofs (engine v22 at revision 0; v23 at revisions 1–3). Earlier null
results and original declarations remain. Latest saved v16/v17/v20/v21/v22 fixture
results still verify unchanged. The final database hour/day counters both show
four admitted checks for the upgrade/review/browser sequence; no counters,
thresholds, concurrency rules or permissions were bypassed or reset.

The browser visibly signs out, owned tab 40 closes, and the harness revokes/bans
its identities. Independent SQL confirms 76 banned fixture accounts, zero active
fixture accounts and zero fixture sessions. A harmless admin revocation warning
follows already completed browser sign-out; SQL is the authority. Isolated ports
3132/3133 close; main dev PID24938 on 3000 remains untouched. No live v23 test
process remains. Full historical coverage stays in progress.

Final local build: `/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-watch-build-btGrZk`.
Worker: 3,883,887 bytes, 324 inputs. The actual retained v22 predecessor has SHA-256
`074fe8eaf853ddec5af8c996dff5901b65f15fa5776b452236b12c2bccdbb4bd`.
Final private harness artifacts are under
`/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-audit-pilot-tORujN`;
its credentials are revoked, never reuse them.

Private receipts:

- `/tmp/cante-column2-{source-goldens-final,formula-inventory,focused-complete,regression,tsc-complete,worker-tests,worker-build,website-build}.log`.
- `/tmp/cante-column2-prior-{ordinary,country,watch}-regression.log`.
- `/tmp/cante-column2-live-acceptance-final.log`,
  `/tmp/cante-column2-browser-proof-final.log`,
  `/tmp/cante-column2-export-proof.json`,
  `/tmp/cante-column2-quota-final.log`, `/tmp/cante-column2-cleanup-final.log`.
- `/tmp/cante-column2-audit-results.png` and
  `/tmp/cante-column2-corrected-origin.png`.

The first source-verifier attempt omitted the complete article group and correctly
returned unresolved for the watch movement; its test harness now passes all related
entries, matching the actual worker. This was not a substitute formula or a
production claim. The final source verifier also checks the new CSV column.

Next: recover missing annual Column 2 fields only from agreeing complete printed
rates and matching original schedules, account for remaining statistical/derived
procedures and conditional notes, and reject ambiguous pinned code/field-definition
versions rather than choosing the first. Existing inventory tests establish one
current code-key/field source each; that is not a general ambiguity guarantee.
Preferences, remaining metals/other 232, broader AD/CVD and special entries remain
open in the original completion ledger. No local fixture proves universal legal
accuracy, completed customer checks or deployed behavior.
