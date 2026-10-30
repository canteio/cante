# Exact caps and calculation baselines

October 28, 2026 · historical audit v27 · verified locally; full coverage unfinished.

The v26 follow-up defect is fixed: converting a fractional cap of `0.29` with
binary multiplication produced `28.999999999999996%`, which the exact historical
parser rejected. The existing duty-expression module now compares pure ad
valorem rates and caps as rational values and preserves the selected snapshot's
decimal cap. Retained numeric stacking instructions use the same helper. Specific
or compound equivalence is not inferred from a percentage cap.

Current calculations now evaluate complete compound expressions exactly before
rounding once. Separate duty components and portfolio differences combine integer
cents. Combined-rate components subtract rounded base duty from the rounded
combined target, with the existing zero floor. A fictional 50% combined rate on
USD 1,000.50 with a 17% base therefore yields 170.09 base plus 330.16 additional,
total 500.25. Multiplying the floating-point difference can instead yield 500.26.
These percentages are arithmetic fixtures, not newly established tariff law.

Applicable missing, negative, nonfinite or above-one caps require review. The
alcohol/232 overlap branch no longer treats a null cap as full inclusion. Exact
results that cannot survive the existing numeric output boundary are withheld.
The independent plain-base verifier separately reads decimal cents and does not
claim a pass for invalid values, unrounded engine amounts or unsafe outputs.

## Saved checks and release compatibility

Fresh monitoring results carry `exact-duty-arithmetic-v2`. A change in calculation
method establishes a fresh numerical baseline; it does not become a regulatory
change or dollar-impact notice. The website rejects completion from a worker
without the current method marker. Old attestations and historical outputs remain
readable and unmodified, but older/unknown monitoring arithmetic cannot supply
current chat costs or current product calculations. The dashboard requests a
refresh. Existing worker authentication, approval and tenant boundaries remain.

Release the corresponding website and worker together. Local builds and tests do
not establish that either hosted deployment was updated. No deployment or daily
monitor target was changed in this work.

## Verification

- 222 focused tests pass: exact arithmetic, stacking, audit import/calculation/CSV,
  workspace comparison, chat context, dispatch compatibility and live checks.
- 938 library regressions and 214 historical regressions pass. These sets overlap
  the focused tests; their counts are not added together.
- TypeScript, isolated production website builds and final worker build pass.
  Actual bundled-worker REST fixtures verify parsing, protected completion,
  checkpoint recovery and tenant scope. All 120 deliberately uncovered fixture
  rows stay unresolved; this worker test does not validate legal rates.
- Scheduler authentication/admission and idle-without-fetch tests pass. They do
  not activate a schedule or prove a real daily customer check.

`exact-cap-entries.csv`, `exact-cap-rules.json` and `exact-cap-expected.json` contain
100 fictional dated entries, synthetic **draft** rules and an independent Python
Decimal half-up oracle. Every calculated and exported amount matches: 100
calculated, 67 discrepancies, USD 34.00 overpayment and 33.00 underpayment. Tests
also cover expiry, absent coverage, invalid caps, mixed fractions and compound
caps requiring review. Production rejects these synthetic rules. No human
approval is simulated in a real workspace; no network/model call is used by this
fixture calculation. Passing it establishes functionality, not legal accuracy.

Separate live acceptance uses two isolated fictional Auth workspaces, the actual
retained v26 worker followed by v27, real Supabase and existing official sources.
Upload/mapping/idempotency, same-source engine refresh, dated origin review,
export and foreign-tenant API/RPC denials pass. The browser records a fictional
dated classification correction: original `3705000000` remains, while the reviewed
calculation uses `4421918800`, USD 250.00 becomes 350.00, and the paid-minus-expected
difference becomes -90.00. The original product link and four empty source fields
remain. All 100 downloaded CSV amounts match their independent expected results.

Four protected revisions verify (v26, then three v27 results); nine older saved
result sets still verify. Final fictional ledger: 90 calculated, ten unresolved,
USD 262.50 potential overpayment and 2,161.01 potential underpayment. The ten open
lines are visible limits, not a claim of complete historical support.

After browser sign-out, the cleanup reports a token-revocation HTTP 400. Independent
SQL confirms all 84 audit-pilot fixture identities are banned, zero are active and
zero fixture sessions remain. The owned tab and ports 3132/3133 close; the existing
development server, PID 24938 on port 3000, remains live. No customer fixtures,
permissions, schema, quotas, dependencies, shared approvals or schedules changed.

Private local verification artifacts:

- `/tmp/cante-v27-{focused-complete,regression-final,historical-regression-final,tsc-verified,worker-tests-final,daily-worker,live-acceptance,browser-proof,export-proof,cleanup}.log`.
- `/tmp/cante-v27-browser-proof.json` and `/tmp/cante-v27-corrected-audit.png`.
- Isolated acceptance build `cante-watch-build-QQGtSX`; final build
  `cante-watch-build-pNzJRU` under the system temporary directory. Final build
  additionally includes the exact comparison display and independent verifier.
- Acceptance worker retained at `output/watch-v27-acceptance-worker/api/check.mjs`,
  SHA256 `4d5d1bfaf1872d3b8d5ee786f1250333733da4230ac3899953748ef93c6132c1`.
- Final bundled worker at `output/check-worker/api/check.mjs`, separately verified
  with isolated REST fixtures, SHA256
  `cd4509ac3f4812e3dbad76c7bca5b4ae927d9ec5a0cb2ec90026a59ab1ad7b5a`.

## Remaining work

This revision fixes arithmetic and baseline integrity; it adds no new legal
scope. The v26 original-source inventory remains 535/548 records and 858/889
observed code/date cases, not a new v27 full scan. Thirteen source records remain:
seven derived parent/juice formulas, two blank printed annual rates, two Chapter
29 statistical-edition cases, the additional 9904 reference for `22029928`, and
the edition mismatch for `85299054`. Publication-window gaps are not resolved by
choosing a convenient edition.

The full [completion ledger](../plans/historical-coverage-completion.md) remains
open: country/preferences, remaining metals and other 232 sectors, case-specific
AD/CVD, conditional exclusions, remaining quantity/derived formulas and special
entry/cutoff treatment. These tests do not establish comprehensive coverage or
readiness for every customer shipment.
