# Historical statistical components and calculation upgrades

October 27, 2026 · audit engine v20 · full historical coverage remains in progress.

## Implemented scope

The existing annual-duty path now calculates supported Chapter 91 watch/clock
components from retained 2016/2017 USITC originals. It reads Statistical Note 1,
its complete reporting tables and the whole printed General-column formula.
All 17 reporting patterns and 293 published component codes in each of four
editions pass the source contract: 1,172 edition/component records, not 1,172
distinct laws or completed shipments. Annual numeric sentinel fields remain
unchanged and are never treated as duty rates.

An explicit article group must contain every named component exactly once,
including quantity/value zero for absent components. Separate component values
must equal the declared complete article value. Counts are independent across
components: two batteries per watch is valid. Contradictory quantities on the
same line, missing units, ambiguous total jewel counts and incomplete groups
withhold the expected total. Dutiable jewels require an explicit supplied count;
no exemption quantity or conversion is guessed.

The annual record supplies the whole-article formula's historical date interval.
The component table also needs one contemporaneously retained publication window;
this is a coverage bound, never an inferred legal effective date. Later originals
only corroborate identical text. They do not fill earlier uncovered dates.

A narrow classification check compares explicit complete AC-only movement
value/count with a price bracket only when the annual description and originals
agree. A conflicting classification remains a review finding; Cante never guesses
a replacement code. Other classification, origin and qualification criteria still
require evidence. The compiler is a labeled reference estimate, not human approval.

The PDF parser also retains complete table rows near the bottom of the page.
Original public cells reproduced truncated words and a missed Free row; the
same column/boundary contracts still apply. Prior annual and modern-source
regressions passed after this change.

## Shared services and interface

- `app/api/tariff/references/pdf-rates.ts`: source table projection and component
  reporting contracts, including exact published ten-digit codes.
- `annual-data.ts`, `store.ts` in the same directory: whole-formula agreement,
  source identities, effective dates, contemporary windows and invalid-code issues.
- `app/api/audits/{shipment,input,model,compiled-reference,engine,readiness,store}.ts`:
  explicit component/quantity inputs, exact arithmetic, group reconciliation,
  classification discrepancies, findings and CSV output.
- `app/api/internal/tariff-audit/route.ts`: whole-audit corrected component context
  across bounded checkpoints. Original declarations stay immutable.
- `components/audits/audit-workspace.tsx`: reporting evidence, component value sums
  and dated quantity/classification corrections within the existing review form.

No new tariff engine, dependency, `lib/` module or application tab was added.

## Existing-audit upgrades

The old refresh RPC only compared source/rule IDs. Improved software could not
recalculate an existing completed audit when those IDs stayed the same.

Migration `20261027194112_historical_audit_engine_refresh.sql` is applied. It adds
nullable request-version metadata to existing review events and the authenticated
`refresh_historical_audit_support` RPC. The website supplies its own engine constant;
the browser cannot select the version through the HTTP body. The RPC checks tenant
write membership before locking, reuses the existing approved-rule/source bounds,
creates one new revision, and leaves every prior proof/result unchanged. Repeating
a pending request is a no-op. The actual protected execution version wins over
request metadata; requesting support is not proof it executed or that law changed.
The legacy RPC and strict decision JSON format remain compatible.

Rollback SQL and actual HTTP tests verify tenant/viewer/anonymous restrictions,
pending idempotency, downgrade rejection, invalid source/bundle rejection and
original-result retention. No global reviewer appointment or legal approval changed.
No table was added; explicit EXECUTE is limited to authenticated callers, with
tenant authorization inside the function. Supabase advisors add the expected
authenticated SECURITY DEFINER warning for this scoped mutation RPC. Earlier
warnings, including disabled leaked-password protection, remain unchanged. The
warning is reviewed, not reported as a clean security scan. See the
[function-execution advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Verification

`watch-component-workflow-entries.csv` and its independent expected-results JSON
contain 100 fictional entry lines in 36 explicitly linked article groups. Public
page cells are separately labeled. Real retained sources are used in the source
and local real-database checks; fictional declarations are not customer evidence.

| Stage | Calculated | Unresolved | Potential overpayment | Potential underpayment |
|---|---:|---:|---:|---:|
| Initial v20 | 73 | 27 | USD 17.49 | USD 0.36 |
| Eleven supplied evidence decisions | 89 | 11 | USD 17.49 | USD 0.36 |
| Browser classification/count correction | 90 | 10 | USD 21.09 | USD 0.36 |

The remaining ten are three missing-component lines, five duplicate-component
lines, and two deliberately uncovered 2014 lines. These are not asserted to be
the only gaps in Cante or in a customer ledger.

The actual retained v19 worker first completed the fictional audit. The website
then refreshed the same rules/sources once and the actual v20 worker reran it.
The old v19 USD 32.75 result remains retained. V20 correctly withheld the total
because the supplied value contradicted the declared movement price bracket.
The browser review explicitly corrected HTS 9109103010 to 9109104010 and 10 to
20 units for June 15, 2016. The original code/count and prior null v20 result
remain. The published corrected formula is USD 0.22 × 20 + 3.2% × USD 1,000 =
USD 36.40, compared with USD 40 paid: USD 3.60 potential overpayment.

The browser CSV download has all 100 lines, dated decisions, original fields,
component sums, sources and exact engine version. All ten unresolved lines have
blank expected/difference cells. Protected readback verified all four execution
hashes and unchanged retained v16/v17 snapshots. Foreign reads, export and refresh
were denied. New audit-only products have no invented current origin/value/rates.

- 84 focused tests, TypeScript, website/worker builds and mocked worker checks pass.
- All 100 actual-source fixture results and 1,172 original component contracts pass.
- The final full regression passes 931/931. An earlier run passed 930/931 with a
  database fixture setup error, `JWT issued at future`; that five-test module and
  the full rerun passed. Its underlying clock issue is not claimed fixed.
- One earlier build failed in the unchanged font loader; subsequent clean builds
  passed. One archive read failed; a later scoped probe and source regressions
  passed. Neither is described as a proved permanent repair.
- Browser sign-out was visibly confirmed. The harness then logged one session
  revocation warning; independent cleanup SQL, rather than that log, establishes
  the final session state. Test accounts remain banned and historical fixtures
  retained. Temporary browser/server resources were closed; port 3000 stayed live.

Private local receipts: `/tmp/cante-watch-{live-acceptance-final,browser-proof,
export-proof,cleanup-verification,engine-refresh-live-test,advisors-after}.log`,
`/tmp/cante-watch-focused-final100.log`, `/tmp/cante-watch-regression-retry.log`,
`/tmp/cante-watch-component-{scope,source}-final.log`, and
`/tmp/cante-watch-audit-results.png`. Despite the focused log's filename, its
actual TAP total is 84. Credentials and raw private exports are not tracked.

## Still unfinished

Earlier Chapter 91 years and uncovered publication windows need their own
original reporting tables. Method T in other chapters, procedures 9/K/X,
conditional notes and combined-rate equivalents need separate contracts.
Conditional metals/other Section 232, wider dated countries/Column 2/preferences,
broader AD/CVD and special entries remain in the
[active completion ledger](../plans/historical-coverage-completion.md).

This work has not deployed the website or worker, changed the daily monitor
target or established full historical coverage or customer refund accuracy.
