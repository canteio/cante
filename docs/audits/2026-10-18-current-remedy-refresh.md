# Current Section 232/301 refresh

October 18, 2026. Local working-tree implementation and verification; no deployment.

## Behavior

Today's live-check, single-calculator, bulk-calculator and business-impact evaluations
fetch current USITC consolidated Chapter 99 notes and duty headings. China coverage
also has to agree with the separately published China tariff reference. Historical
dates retain their existing reviewed-data calculation path.

Supported metal Section 232, the four legacy China Section 301 lists and current
Note 52 country rules are compiled deterministically. Rates and code lists come
from fetched data. `config/tariff-remedy-contract.json` pins the operative wording
and minimum expected list sizes understood by the compiler. New wording, malformed
lists, conflicting mappings or unknown rate expressions require further verification.
These guards are mechanical checks of supported language, not independent legal
approval or a claim that every trade-remedy provision is implemented.

Every calculation request shares one fresh remedy snapshot and fresh per-code HTS
lookups. There is no cross-request remedy cache or stale-data fallback. Release
checks bracket the fetches and calculation. Fetches are bounded by size and timeout.
Exports retain source bodies, SHA-256 hashes and timestamps; the China PDF is retained
as base64 with its original-byte hash. Monetary ad valorem arithmetic uses exact
decimal ratios and half-up cent rounding, including combined-rate components that
subtract rounded base duty rather than applying a full additional threshold.

Official sources:

- [Current release](https://hts.usitc.gov/reststop/currentRelease).
- [Consolidated Chapter 99 notes](https://hts.usitc.gov/reststop/getChapterNotes?doc=99).
- [Chapter 99 headings and rates](https://hts.usitc.gov/reststop/exportList?from=9901&to=9999&format=JSON&styles=false).
- [Current China tariff reference](https://hts.usitc.gov/reststop/file?filename=China%20Tariffs&release=currentRelease).

Federal Register and CBP CSMS listings remain unapplied review leads. This change
refreshes rules when a calculation/check runs. It adds no schedule, model call,
delivery channel or connection to the still-disconnected monitoring worker.

## Shipment facts and intake

The live page has two optional confirmations: ordinary commercial treatment and
absence of other-sector Section 232 treatment. Neither is preselected. New files
reset both; changing a confirmation invalidates the results. CSV facts take
precedence over these defaults. The template includes the accepted columns:

| Column | Meaning |
|---|---|
| `standard_commercial` | Ordinary commercial entry with no special Chapter 98, donation, informational-material or other exclusion claim |
| `other_232_heading` | Explicit `none`, or the applicable exact Chapter 99 heading; other sectors currently remain subject to further review |
| `metal_weight_percent` | Applicable listed metal's percentage of the article's weight; 0–100 |
| `us_metal_qualification` | Whether all applicable metals meet the specified U.S. origin requirements |
| `uk_metal_qualification` | Whether the applicable UK metal origin requirements are met |
| `special_232_claim` | Whether a special quota/exclusion claim is made |
| `equipment_use` | Qualifying exclusive agricultural/industrial equipment manufacturing use |
| `motorcycle_use` | Qualifying U.S. motorcycle manufacturing use |

Boolean fields accept true/false or yes/no. Leave unknown facts blank. Cante does
not infer weight, qualification or end use from a product name. Conflicting facts
within a historical SKU/HTS/origin group are rejected. Conditional article,
civil-aircraft and pharmaceutical exclusions need evidence and a supported rule;
there is no pretend CSV field that resolves these cases.

## Verification

All government examples below used revision `2026HTSRev21`, freshly fetched during
verification. Shipment values and qualifications are explicitly hypothetical.

`npm run verify:remedies` exercised the actual stack engine without model calls or
customer-data writes:

| Input on $10,000 customs value | Result |
|---|---:|
| China motor, 8501.31.40.00 | $4,150 |
| China bearing, 8482.10.50.16, 90% listed metal, ordinary qualification | $5,900 |
| Same bearing, 10% listed metal | $4,650 |
| Same bearing, 90% listed metal, qualifying U.S. metal | $4,400 |
| Japan motor, 8501.31.40.00 | $1,250 |
| Bearing without metal weight | Unresolved; null total |

The actual selected Section 232 heading controls the Note 52 exclusion. A generic
metal match is insufficient. Tests cover the exact 15% threshold, UK facts,
zero-rate heading validation, changed legal wording/rates, independent China-map
agreement, source failure, parsing and exact cent rounding.

- 56 focused refresh/live-check/rates/arithmetic tests passed.
- 118 existing stack, route, bulk, Section 232 and business-impact regressions passed.
- TypeScript and an isolated production webpack build passed.
- A temporary isolated authenticated workspace exercised real request handlers and
  RLS. The hosted test process had no worker/admin or model API keys. The two-row
  live upload returned $4,150 + $5,900 = $10,050 with zero unresolved components for
  those supplied facts. Single and bulk calculator routes also returned expected
  totals; bulk rows shared one remedy snapshot.
- Actual desktop/mobile browser uploads, streamed progress and evidence downloads
  passed. Export hashes were checked, including original PDF bytes. The mobile
  page had no horizontal overflow. Existing local analytics requests logged errors.
- The supplied 600-entry import history uploaded through the real authenticated
  browser/API path. With the two explicit hypothetical importer confirmations,
  50 groups passed base arithmetic: 15 groups calculated, 25 needed metal weight,
  and 10 required conditional-exclusion scope review. The combined total remained
  null. The original browser assertion incorrectly expected 25 complete groups;
  inspection established the additional ten conditional-scope holds, which were
  preserved. The resulting UI was corrected to distinguish unsupported scope
  review from facts that can actually be supplied in CSV. A final browser replay
  of the downloaded real report verified 15 ready / 25 facts / 10 review labels
  and that conditional review does not advertise an unsupported CSV field.
- Temporary QA workspace/user deletion was verified; its server was stopped.
  The existing localhost development server and real customer records were retained.

Ignored local evidence is under `raw/tariff-rule-update/`, including worked cases,
HTTP results, downloaded reports and screenshots. A bounded public-government
fixture and provenance are tracked in `scripts/test-fixtures/tariff-remedies/`.
Reproduce offline tests with `npm run test:remedies`; the live verification command
performs fresh official fetches and can fail when sources or supported law change.

## Remaining boundaries

Other Section 232 sectors, conditional exclusions, newer unsupported China headings,
Column 2/Russian combinations, special claims, mobile industrial equipment and
AD/CVD are not comprehensively implemented. Absence from a metal list does not
prove absence of automotive, truck, timber, semiconductor or pharmaceutical duties.
New actions not yet incorporated into the consolidated USITC publication are not
automatically applied merely because a government feed lists them.

Historical CSV values are repriced today and grouped by SKU/HTS/origin, with rounding
per group. This is not a past-entry liability audit, annual forecast, refund claim
or comparison with paid duty. Historical quantities are retained but not used to
invent missing units for quantity-dependent rates. A complete calculated stack
still carries the engine's unevaluated-scope caveats; it is not a guarantee of
complete legal liability.
