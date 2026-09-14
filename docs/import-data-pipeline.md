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

## Next steps (future runs)

1. Decide whether to actually file the CBP FOIA/SecureRelease bulk request
   (business decision, needs J's sign-off — has an ongoing cost).
2. Flesh out `pipelines/import-manifest/fetch/` with a real parser for the
   M01/P01/H01 CAMIR record layout once a sample data file is available.
3. Wire the schema in `pipelines/import-manifest/schema/` into
   `lib/db/schema.ts` as first-class Drizzle tables once the data source is
   confirmed.
4. Add a Cante adapter entry to `free-trade-data-apis.md` once this graduates
   past "researched, not implemented."
