# US Import Data Pipeline — CBP Ocean Manifest Data

Live-verified 13 September 2026. This document tracks the research and
build-out of a Cante-native alternative to paid import-data resellers
(ImportGenius, Panjiva, Volza). The underlying data is public U.S. government
data; the resellers' business model is repackaging it, not owning it.

## The legal basis

- **19 CFR 4.7a** governs the *content* of the inward Cargo Declaration
  (CBP Form 1302) that every ocean carrier must file: shipper, consignee,
  vessel/voyage, port of lading/unlading, cargo description, weight,
  container/B/L numbers.
- **19 CFR 103.31** governs *disclosure* of that data. Two facts matter:
  1. `(a)/(3)`: "All the information appearing on the cargo declaration
     (CBP Form 1302) of the inward vessel manifest may be copied and
     published." Press and, by extension via CBP's public data programs,
     other requesters can obtain full inward manifest content — this is the
     legal root that makes ImportYeti/ImportGenius/Panjiva/Volza possible at
     all.
  2. `(d)`: any importer/consignee (or, since 2019, any shipper) can file a
     **confidentiality certification** with CBP's Vessel Manifest Program
     Manager. Once granted, that party's name/address is redacted from all
     future public releases. This is why "some data is missing" for large or
     privacy-conscious importers — it is not a pipeline bug, it is a legal
     opt-out baked into the source data itself. Cante's docs and UI must
     reflect this as an inherent coverage gap, not a defect.

## Two concrete free/cheap ingestion paths

### Path A — CBP FOIA bulk manifest data (what ImportYeti/ImportGenius actually use)
- `19 CFR 103.31(e)`: CBP historically sold "all AMS manifest transactions in
  the last 24 hours" on a subscription basis (originally CD-ROM, now
  electronic delivery) through the National Finance Center / CBP Technology
  Support Center. ImportYeti states outright it requested "all 70,000,000
  BOLs" as a bulk **Freedom of Information Act (FOIA)** request and rebuilt
  their product from that.
- Process: submit a FOIA request via CBP's **SecureRelease** portal
  (`https://www.cbp.gov/site-policy-notices/foia/records`) asking for the
  AMS ocean manifest data set (or a rolling subscription to it) under
  `19 CFR 103.31`. There is a government production-cost fee (historically a
  few hundred dollars/month for the daily feed) — far below Panjiva/Volza
  seat pricing, and Cante would own the raw data rather than reselling
  someone else's normalized copy.
  - CBP FOIA Reading Room (already-released records, check before filing a
    new request): `https://www.cbp.gov/newsroom/accountability-and-transparency/foia-reading-room`
  - FOIA request portal: `https://www.cbp.gov/site-policy-notices/foia/records`
  - Confidentiality-redaction rules that will already apply to anything CBP
    releases: `19 CFR 103.31(d)`, filed via the Vessel Manifest
    Confidentiality Online Application on cbp.gov.
- Status: **researched, not implemented.** This requires an actual FOIA
  filing and an ongoing paid production-cost subscription, so it is a
  business decision for J, not something to automate silently. Flagging here
  so it's tracked, not executing it.

### Path B — Structured re-derivation from CBP CAMIR record layouts (build our own normalizer)
- CBP publishes the exact fixed-width record layouts carriers must use to
  file (and that CBP echoes back) via the Automated Manifest System:
  - `ImportOcean_IG_CAMIR_Automated Mfst Dwnld` (M01/P01/H01 record layout —
    vessel, port, cargo fields): cbp.gov/sites/default/files/2025-09/...
  - `ImportOcean_IG_CAMIR_Mfst_with SecurityFiling` (adds ISF shipper/
    consignee fields): cbp.gov/sites/default/files/2025-02/...
- These are public technical specs (no login), and are the actual byte-level
  schema of the data CBP would hand over under Path A, or that any AMS
  participant already receives. Building the parser against these record
  layouts now (before the data-access question is settled) means Cante is
  not blocked waiting on a FOIA turnaround — the ingestion/normalization code
  can be written and tested against sample/synthetic records today, then
  pointed at a real feed later.
- Status: **scaffolded this run** — see `pipelines/import-manifest/`.

## Explicitly out of scope for now

- Air AMS (air waybill) data has a separate, less-open disclosure regime and
  is not covered by this scaffold.
- Any live scraping of ImportYeti/ImportGenius/Panjiva is out — those are
  paid/ToS-restricted derivative products; Cante goes to the primary CBP
  source instead.

## The officially sanctioned way to get Chinese/Indonesian company names ("foreign-shipper mirror")

Added 2026-09-14. Cante ran a full 20-country legal review of customs-data
disclosure regimes (see gbrain `cante/company-plan`) and confirmed: **China**
and **Indonesia** do NOT have any legal public company-level customs data
source of their own.

- China: GACC (the customs authority) only ever publishes enterprise-TYPE
  aggregates (state-owned / foreign-invested / private-owned breakdowns),
  never individual company names or shipment records.
- Indonesia: no official government portal publishing company-level customs
  or shipment data exists at all, despite marketing claims from resellers
  implying otherwise.

Scraping either country's customs system to work around that would be
illegal there, and Cante will not do it — full stop, do not attempt this.

**The legal alternative is the US CBP pipeline this repo already builds.**
Every US inward ocean manifest discloses the foreign SHIPPER name and
address (the exporting factory/company) directly alongside the US
consignee, and that disclosure is public under the exact same
`19 CFR 103.31(a)(3)` rule documented above — it is the same record, same
legal basis, no separate authorization needed. So instead of trying to read
China's or Indonesia's customs data (illegal / doesn't exist), Cante reads
the US side of the same transaction, which is legal, and asks "which
Chinese/Indonesian company shipped this into the US?" — a mirror image of
the same fact, sourced entirely from public US government data.

Implementation, this run:

- `schema/shipments.ts` — added `shipperCountryCode` (ISO 3166-1 alpha-2) as
  a first-class indexed/queryable column, so a query like "Chinese companies
  shipping baby products into the US" is a plain
  `WHERE shipper_country_code = 'CN'` instead of a free-text LIKE scan over
  `shipperAddress`.
- `fetch/fetch-manifests.ts` — added `deriveShipperCountryCode()`, a small
  explicit token-lookup over the free-text shipper address (deliberately not
  a geocoding call — CAMIR address text is inconsistent enough that a wrong
  automated guess would misattribute a company's country, which is worse
  than leaving the field null). Covers CN/ID today; extend the lookup table
  as more countries become relevant to the ICP.
- Tests: `fetch/fetch-manifests.test.ts` covers CN match, ID match, no-match,
  and null-input cases.

This does not require the FOIA bulk-data decision below to be resolved
first — `shipperCountryCode` populates from whatever shipper-address text
the eventual data source provides, live feed or FOIA delivery alike.

## Implementation update — 14 September 2026

**Steps 4–5 are implemented in this repository; step 1's automated public
shipment feed remains blocked.** The worker can consume an authorized normalized
JSON delivery today. CPSC recalls use a real free government API. Nothing in
this change files FOIA, buys data or creates synthetic "live" shipments.

### Free-source investigation

- **ImportYeti / keyless search:** its [API getting-started guide](https://docs.importyeti.com/docs/getting-started)
  requires an API key and credits for company queries. Its
  [data-use policy](https://www.importyeti.com/policies/data-use) distinguishes
  purchased API/subscription data from the free website and says continuous
  full-database delivery requires a separate agreement. A human-accessible
  search page is not evidence of a permitted keyless automated shipment feed.
  No undocumented endpoints, CAPTCHA bypass or reseller scraping were used.
- **Census AES / USA Trade Online:** the
  [Census trade tools description](https://www.census.gov/content/dam/Census/topics/business-and-economy/flyers/Trade_Data_Tools_flyer_v6.pdf)
  describes free statistical trade tools. Census's
  [trade security guidelines](https://www.census.gov/foreign-trade/reference/guides/ftdsecurity2019.pdf)
  explain confidentiality of identifiable records. These aggregate datasets
  cannot answer "which named importer received this shipment" and are not
  substituted for shipment data here.
- **CBP public portals:** no recurring free shipment feed was established.
  Direct reading-room access returned HTTP 403 in this research session, so
  this is not a claim that every released attachment has been inventoried.
  Public technical layouts describe a format, not access to the actual
  manifests. The FOIA/data-delivery choice remains with J; the historical
  fee estimates above are not a verified current price or subscription offer.
- **CPSC:** the [official API documentation](https://www.cpsc.gov/s3fs-public/RecallRetrievalWebServicesProgrammersGuide20180917.pdf)
  exposes recall dates, product descriptions and importer names. This is the
  free live source used for the recall half, **not shipment records**. The
  scheduled adapter requests a rolling 180-day window and preserves named
  importers instead of the older alert adapter's 30-record summary cap.
  Direct live fetch verification failed in this restricted environment;
  the adapter is tested using representative official-schema responses.

This establishes a data-access blocker, not proof that no free record could
exist anywhere. A future source must demonstrate shipment-level provenance,
permission for automated reuse and an actual accessible endpoint/delivery
before it can be called live.

### What was built

- `loadRawManifestText()` now loads a configured local CAMIR file. The existing
  M01/P01 header parser remains tested; complete B/L/party/cargo decoding is
  still absent and must be implemented against an actual delivery if needed.
- `monitor/sources.ts` validates authorized normalized shipment exports and
  fetches CPSC recalls. Synthetic exports carry `sample_fixture` and cannot
  produce importer discoveries. Missing access is recorded as blocked.
- `scripts/refresh-import-monitor.ts` is the in-repo scheduled worker, exposed
  as `npm run imports:refresh`. It persists each refresh, retains evidence
  through outages, tracks source freshness and detects new importer/recall
  pairs without re-announcing each new bill of lading.
- `lib/db/schema.ts` and the new Supabase migration persist a tenant-scoped,
  atomic snapshot of shipment rows, recalls, matches and discovery history.
  The existing standalone shipment schema supplies the row shape. This is a
  bounded 5,000-shipment workspace store, not a national archive index.
- `/import-monitor` and `/api/import-monitor` expose authenticated search,
  evidence links, recent activity, named-importer versus commodity-candidate
  filters, pagination and explicit coverage warnings. Shared commodity words
  alone do not establish that a specific importer was recalled.

See [pipeline setup and contract](../pipelines/import-manifest/README.md) for
migration commands, environment variables, the daily cron template, sample
format, API parameters, failure codes and test coverage.

### Human next steps

1. J decides how to obtain an authorized shipment source; no fee or filing has
   been authorized or attempted. A licensed normalized export can use the
   implemented adapter immediately. Raw CAMIR delivery requires the remaining
   shipment decoder after its real format is available.
2. The worker operator restores the SQLite native dependency or selects the
   existing Supabase backend, applies the matching migration, configures the
   existing customer ID and source path, and runs `npm run imports:refresh`.
3. Verify the CPSC request on the network-enabled worker, then install the
   checked-in cron example with the correct absolute paths. The schedule is
   provided but was not installed on the host by this development session.

Until shipment access is resolved, automation refreshes recalls and reports
shipment coverage as blocked; it cannot surface verified active importer leads
from an absent shipment feed.
