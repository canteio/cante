# Prusa public catalogue and trade research

Collected October 11–12, 2026. No LLM calls, customer imports, login, paid endpoints,
challenge bypass or private customs access.

## Catalogue scope

The official English sellable-product sitemap lists **1,304 URLs**. Every URL was
attempted. **1,222 public product pages** were extracted, with names, website
IDs/UUIDs, short descriptions, options, category paths, availability, retail
prices/currencies and source timestamps/hashes. **82 URLs returned HTTP 404**:
80 warranty URLs and two older XL filament packs. Their failures remain explicit
in `catalogue-source-report.json`. This is the accessible public English
storefront snapshot, not an internal ERP export, every possible configuration,
or proof that retired product records were recovered.

Source: https://www.prusa3d.com/content/sitemaps/domain_1_sitemap.sellableProducts.xml

`catalogue-products.csv` is the complete extracted reference table.
`catalogue-url-index.json` retains all sitemap URLs, including the dead ones.
Retail offers are copied from public product JSON-LD. A single unambiguous offer
is also exposed as `retail_reference_price` / `retail_currency`. These are listed
retail prices, **not customs values**, and are not quotations or landed costs.

No native SKU was present in the extracted product schema. Public website IDs
and UUIDs remain explicit; catalogue-intake files use `PRUSA-PUBLIC-<uuid>` as
clearly generated test identifiers, not claimed Prusa manufacturing SKUs.

## Test on localhost

For a small first-scan trial, use [first-scan-estimated.csv](first-scan-estimated.csv):
six pseudonymous products, only `product_label`, `hts_code`, and `origin_country`.
No price, supplier, shipment or account information is included. Every label says
DEMO ESTIMATE; the codes and Czech origin remain assumptions. The mapping back
to public product names and source URLs is in `first-scan-provenance.json`.

`node --import tsx scripts/scan-public-prusa-first.mts` performs a separate,
read-only public-source scan with this fixture, writing `output/prusa-first-scan/report.md`
and JSON evidence. It uses current USITC rows, 30-day Federal Register listings
and selected texts, and CBP's rolling CSMS feed. It does not use the signed-in
workspace or company profile, call an LLM, save tenant products, send alerts or start
schedules. Matches are review leads, not confirmed changes; broad measures,
annexes, classification and origin still need review. A first scan has no previous
baseline. This is a local experiment, not an implemented anonymous web-upload service.

The minimal CSV also parses in the existing **Check duties CSV** calculator with
values and quantities absent. That calculator checks supported duties, not recent
regulatory changes. **Import products CSV** requires the separate catalogue format
below; do not upload the minimal scan file there.

Open http://localhost:3000/tariff and use **Import products CSV**. Import these
three files separately: `catalogue-intake-01.csv` (500 products),
`catalogue-intake-02.csv` (500), and `catalogue-intake-03.csv` (222).
The unit price is a retail reference. HTS and origin remain blank because the
scraped catalogue did not supply reviewed U.S. import classifications or origins.
This intentionally tests catalogue intake, search and price display. Duty checks
need additional reviewed facts; do not expect a customs total from these files.
Uploading through the app is an intentional write to your signed-in workspace.
The scraping/verification scripts themselves made no tenant writes.

## Public shipment evidence

`public-manifests.csv` and `manifest-evidence.json` preserve one visible public
Prusa Research A.S. shipment sample from https://www.importinfo.com/prusa-research-a-s.
The source reports 126 bills of lading. Its 25 recent-history rows are empty
registration placeholders and were not treated as records. The visible sample
identifies Prusa as shipper and MatterHackers as consignee; it is not Prusa's
complete internal import ledger.

Its reported harmonized code `84859090`, zero-filled harmonized value, gross
weight and package quantity are kept verbatim as manifest evidence. They do not
become a verified full U.S. HTS, customs value, paid duty, tariff quantity or legal
entry date. Arrival is retained separately. **No complete customs ledger was
obtained.** The actual Cante evaluator retains errors/null totals for this sample.

## Raw data and reproduction

`raw/prusa-catalogue/extracted-product-records.json` contains parsed source
records, including published variant references. Original HTML and sitemap XML
are preserved byte-for-byte inside compressed `.html.gz` files in that directory.
`catalogue-source-report.json` maps each URL to its raw file, timestamp and SHA256
of the uncompressed response. `catalogue-verification.json` confirms those hashes,
record counts and the real CSV/missing-data checks.

Run from the repository root:

```sh
node scripts/scrape-prusa-catalogue.cjs
node scripts/prepare-prusa-catalogue.cjs
npx tsx scripts/verify-prusa-catalogue.ts
```

The earlier ten-row `published-codes.csv` is the separate Prusa customs FAQ
category-code table; `us-schedule-candidates.json` holds its U.S. research leads.
The one-row `prusa-printer-scenario.csv` remains explicitly hypothetical and is
not part of the catalogue or the actual manifest sample. Neither establishes
Prusa's real customs classification, duty paid or refund eligibility.

## User-requested 20-row estimated demo

`testsomething.csv` is a separate synthetic scenario with six printer products
and fourteen filament products selected from the real collected catalogue.
HTS codes are estimates, Czech origin and the October 11, 2026 test date are
assumed, and shipment values use ten times the published retail reference price.
Printer quantity is ten units; filament quantity is an assumed 3,000 metres.
All assumptions are marked on every row. None are actual customs entries or
paid-duty records. Use **Check duties CSV**, not historical audits. The actual
calculator parser accepts all twenty rows; this verifies intake, not classifications
or tariff accuracy. Coverage gaps can still withhold totals. Regenerate with
`python3 scripts/make-prusa-demo.py`; the convenient root `testsomething.csv`
copy and these fixtures are excluded from deployment. No tenant was modified.
