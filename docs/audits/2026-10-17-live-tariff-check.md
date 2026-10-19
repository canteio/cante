# Live official-data and arithmetic verification — October 17, 2026

## Result

The live engine does **not** establish complete current duty for the 50-product
example. This is a discovered readiness gap, not a passing end-to-end liability
calculation. The fictional change selector is no longer the default test page.

Actual final run completed October 18, 2026 at 03:57:59 UTC (October 17 Eastern):

- 50 fictional product/value/origin inputs, 10 distinct published HTS codes.
- USITC revision `2026HTSRev21`, verified unchanged before/after fetching.
- 23 official source requests, all successful: release checks, exact/ancestor HTS
  lookups, Federal Register tariff listings, current CBP CSMS feed.
- 50/50 plain base-duty calculations passed a separate BigInt decimal check
  against the fetched rate text; no mismatch.
- 50/50 complete duty totals withheld by the actual production calculation engine.
- Shared causes: accepted Section 232 data predates the June 8 amendment and
  cannot establish current consolidated applicability; Section 301 action
  effective July 24 still needs rate/exemption treatment.
- 52 real read-only database requests; zero customer writes, model calls or delivery.
  Verification rejects other hosts and database mutations before they execute.

The raw local evidence is gitignored at
`raw/live-tariff-check/2026-10-18T03-57-59-487Z.json`.
Source bodies and hashes preserve the data used. HTS hashes describe serialized
parsed JSON, not the original HTTP bytes. Other captured source hashes describe
the decoded response text. No competitor assets are involved.

## Implemented

`/tariff/demo` now uploads CSV or loads the same 50 example products, pulls live
USITC rates with `cache: no-store` and bypasses the one-hour process cache, then
passes that exact fetched row into the existing stack engine. No demo baseline
rate or fake regulation is used. Example quantities, classifications, origins and
prices remain fictional and are labelled as such.

The page shows independent base arithmetic separately from the full-duty result,
including unresolved reasons. First check establishes a baseline. A repeated
check in the same mounted browser view compares base duties only, on identical
product/value/origin inputs and stable verified schedule revisions. It never
claims a complete regulation-change comparison from a schedule revision alone.
Baselines are not persisted across reloads. A new CSV invalidates earlier results
before the asynchronous read. A failed refresh clears the current result.

Recent official publications are fetched and linked as review leads, not
interpreted legal amendments or computed rate changes. The Federal Register scan
is a bounded keyword query (first 100 documents in 30 days); the CBP feed is rolling.
Neither establishes exhaustive legal coverage. Exports retain all fetched listings.

The previous artificial arithmetic workflow remains at `/tariff/demo/simulation`
for reproducible fixture testing. It is explicitly separate from the live check.

## Reproduce

```sh
npm run verify:live-check
npm run test:live-check
```

The live verifier makes real government and read-only reference-database calls.
It fails on missing source data, unstable revision or failed arithmetic checks;
it still reports unresolved legal totals rather than changing them to zero.

Browser route authentication remains enforced. No real customer CSV or account
was used in the verification. Do not equate the CLI live run or browser fixtures
with a fresh authenticated production HTTP calculation.

## Next blocking work

Obtain and verify a current consolidated Section 232 applicability snapshot,
including the June amendment and subsequent actions. Author/review the applicable
Section 301 rates and exemptions against controlling government texts. Then rerun
the same live verifier and independently validate complete worked shipment cases,
including exclusions, quantity-based rates and origin qualifications. Do not
approve a legal rule merely to turn this report green.

## Additional verification

- 25 targeted tests pass: CSV validation, independent decimal arithmetic,
  fresh-cache bypass, fetch failure without fallback, exact-row matching,
  inherited quantity units, authenticated handler, streamed failure and byte limit.
- 70 existing stack-engine and single/bulk request tests pass.
- TypeScript passes. The final isolated production webpack build passed after
  adding per-source and per-check capture bounds.
- Playwright browser fixtures replayed the actual captured government report:
  50 rows, first-baseline disclosure, repeat base comparison, per-product formula,
  failed-refresh invalidation and replacement-file invalidation. Desktop and
  390px mobile screenshots were inspected; no horizontal mobile overflow.
- Browser requests were intercepted for UI verification. The actual live result
  comes from the CLI run above, not from that interception. The isolated local
  production server emitted the existing unavailable Vercel Analytics script
  warning; no live-check application error was observed.
- Localhost:3000 was preserved. No deployment or database mutation was performed.

## Import-history upload fix

The operator's `imports.csv` failed the original product-only 100-row parser.
The intake now recognizes the ledger headers before applying the product-count
limit: up to 6,000 historical entry rows, grouped into at most 100 SKU/HTS/origin
combinations. Duplicate entry/line identities and invalid dates are rejected;
all original entry fields, dates and paid amounts are retained in the report.

Historical customs values are repriced at today's rates and explicitly never
labelled annual forecasts, past liability, refunds or underpayments. Paid duty
is separate. Quantity fields remain preserved but are not used as a verified
assessment quantity/unit in this grouped historical check. Group-level rounding
is disclosed. Repeated source checks compare the same historical values only.

The actual 600-line fixture produced 50 groups, 50 passing independent base checks,
23 successful official requests and zero writes/model calls. Complete totals
remained unresolved. Evidence: `raw/live-tariff-check/2026-10-18T04-05-53-645Z.json`.
Ten focused tests pass, including the actual file through the HTTP intake handler,
600-entry preservation, paid-duty aggregation, duplicate identities, date validation
and mixed origins. TypeScript passes.

The import-history revision also passed an isolated production build and browser
upload fixture using the actual imports.csv plus the captured live report. The
page displayed 600 entries grouped into 50 rows, historical-value labels and paid
duty separately. The browser replay is UI evidence, not a fresh HTTP live fetch.
