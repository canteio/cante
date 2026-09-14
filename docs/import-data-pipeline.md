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
