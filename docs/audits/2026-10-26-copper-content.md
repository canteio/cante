# Historical copper content and stacking — October 26, 2026

Local audit engine v12 work. Full historical coverage remains IN PROGRESS. No
production deployment, daily worker target, customer record, human approval,
permission, schema or dependency change is part of this work.

## Implemented scope

The existing earlier-metal compiler now covers the initial August 1, 2025–April
5, 2026 copper regime within an explicit source contract. It checks the complete
80-code Note 36 table, four dated introductory variants, the original rate,
allocation and automobile priority clauses, CBP instruction and both published
9903.78.01/.02 rate rows. It does not infer shipment-specific exception clearance
or qualifying origin from those codes. A changed/absent contract withholds totals.

Source originals:

- [Proclamation 10962, Federal Register 2025-14893](https://www.govinfo.gov/content/pkg/FR-2025-08-05/pdf/2025-14893.pdf), clauses 1, 4 and 5; retained source `858df4af-af7c-4bc4-98df-d0d2f7e1ae32`.
- [CBP CSMS 65794272](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/3ebf0e0); retained source `6f663681-0d98-4028-9fe5-26d4b648ba29`.
- Dated consolidated USITC Note 36 and the existing original steel/aluminum,
  country, China Section 301 and Section 122 sources pinned with each audit.

The supported calculation charges the evidenced copper portion; the non-copper
portion retains independently applicable duties. Mixed aluminum/copper products
use separate content values and deduct only charged portions for reciprocal or
Section 122 allocation. A copper-only charge does not inherit the earlier
steel/aluminum exemption from Canada/Mexico border duties. An explicit documented
full-value copper assessment can run without pretending that an unknown copper
content value is known. Zero copper leaves the other duties in place.

An exact content-valued steel/aluminum rate expression is accepted only for its
named metal and assessment basis. Unknown prose fails closed. The basic-edition
page header is recognized explicitly. The intervening Rev23 EU-aircraft exception
paragraphs are retained under separate exact contracts. The August 1–6 continuing
reciprocal rate does not acquire a fictitious August 1 start cutoff; its original
seven-day extension is still required.

An evidenced zero-duty content portion now shows its known assessed value rather
than incorrectly saying that value is unknown. Genuinely missing values stay null;
a zero rate never creates a missing-fact requirement by itself.

Copper kilograms have their own CSV/review field and component quantity. Product
quantity is never reused as copper kilograms. Ad valorem monetary audits may run
without the filing weight, but the component explicitly says that the filing
quantity has not been established. This is not customs-entry preparation.

Existing immutable v1–v11 results remain readable. v12 creates new results; it
never edits old declarations or computed snapshots. These narrow source compilers
are Cante-validated estimates, not independent human legal approval.

## Verification completed so far

- All 21 retained Note 36 editions intersecting the initial copper period match
  the complete 80-code scope and companion steel/aluminum scope contracts. This
  establishes structural extraction, not every code/country monetary treatment.
- `verify-historical-copper.ts`: 18 hand-calculated, fictional shipment cases
  against actual retained originals match their expected outcomes. Sixteen
  calculate; pre-cutoff treatment and an uncleared exception remain unresolved.
- Fictional examples at USD 1,000: China copper-content case USD 900 in September
  2025, USD 800 in November and USD 700 in March 2026; mixed aluminum/copper case
  USD 936 in September; Canada copper-only USD 780 versus mixed-metal USD 476.
  These are test assertions under explicit fictional facts, not customer quotes.
- 106 focused tests pass. The first existing regression run passed all 931
  tests. After the zero-duty display fix, the repeat passed 930/931 with one
  database setup failure (`JWT issued at future`); all 11 tests in that module
  passed on targeted retry without any authentication change. The final full
  confirmation passes all 931 tests (zero failures). TypeScript,
  isolated website build, protected worker build and mocked worker tests pass.
  Worker bundle: 3,799,587 bytes, 324 inputs, no website/provider/delivery code.
- The prior twelve actual-source charged-metal allocation cases also pass after
  the copper scope guard was added.
- Real isolated Auth/database/worker acceptance passed the 18-entry fixture; the
  original CSV, earlier versions, exports and tenant denials were verified. The
  initial export assertion incorrectly expected a camel-case internal field,
  while original input preserves its snake-case CSV header. This test assertion
  was corrected; the full run passed. The browser subsequently exposed the
  zero-duty value display issue described above; a fresh build and real workflow
  passed after its correction.
- Final isolated production website build: `cante-history-build-9PdWWK`. The
  18-entry audit `720cc1c5-0e52-4bb1-a319-e4e24511c666` verifies all source goldens,
  evidence decisions, protected worker results, original-byte download, duplicate
  reuse, cross-company detail/export 404 and direct result RLS returning no rows.
  Inactive SKU associations contain no invented current origin, value or inputs.
- Browser display revision 19 initially shows 16 calculated, two unresolved,
  eleven differences, USD 600 overpayment and USD 250 underpayment. A dated
  correction changes the first fictional copper value USD 800→600 and kilograms
  25→20. Display revision 20 shows duty USD 900→820 and overpayment USD 680;
  underpayment remains USD 250. The charged portion is USD 600, the uncharged
  portion USD 400, and the independently payable duties remain separate.
- Protected database history verifies revisions 18/19 (display adds one), prior
  expected duty USD 900 and new USD 820. The original USD 800/25 kg remains in
  both records. Browser CSV `historical-audit (13).csv` contains all 18 lines,
  the corrected components, raw values, decisions, dated sources and blank
  unsupported totals. Screenshot `/tmp/cante-copper-audit-results.png` was viewed.
- Browser signed out and temporary tabs/QA servers are closed. The harness logs
  a redundant session-revocation failure after browser global logout. An
  independent live SQL check confirms 34 banned audit-fixture accounts with zero
  sessions, and this final fixture specifically banned with zero sessions.
  Main development processes 24933/24938 on port 3000 remain running.

## Remaining scope

This work does not close the broad [completion ledger](../plans/historical-coverage-completion.md).
Auto/civil-aircraft copper exceptions, preferential or special-entry claims and
other unmodeled qualifications require their own dated treatment. India/metal
allocation, U.S.-metal exemptions, first-day 2025 inclusion amendments, other 232
sectors, broader AD/CVD/final assessments, Column 2/preferences, temporary
reductions and remaining transit/FTZ treatment are still unfinished.
