# LulzBot public research dataset

Collected October 11–12, 2026. Real public records only; no synthetic shipments,
customer database writes, paid API calls, login or access-control bypass.

This is a public-data snapshot, **not LulzBot's complete internal catalogue or
customs ledger**. It supports intake and missing-data tests. It cannot prove
tariff accuracy, overpayment or refund eligibility.

## What was collected

| Dataset | Records | Meaning |
| --- | ---: | --- |
| `products.csv` | 821 variants / 270 products | Complete storefront pagination at collection time |
| `bom-lines.csv` | 45,825 | Normalized rows from selected historical public BOMs |
| `bom-parts.csv` | 1,677 | Distinct published part identifiers, not current inventory |
| `bom-supplier-links.csv` | 6,000 | Part/vendor relationships, not 6,000 distinct suppliers |
| `public-manifests.csv` | 10 | Visible Aleph Objects ocean-manifest sample; source reports 23 total |
| `manifest-suppliers.json` | 5 | Public supplier summary records |
| `historic-origin-notes.csv` | 4 | Historical Germany notes for two part identifiers, repeated across sheets |

The archive crawl visited 204 index pages within selected model, hardware and
production-document paths. It discovered 288 BOM URLs and selected 156 files,
preferring XLSX over an ODS copy with the same basename. All selected files
were fetched; 148 unique workbooks were extracted after content deduplication.
The sparse raw extraction retained 150,958 nonempty rows. Two oversized XLSX
files were replaced by their published ODS equivalents. Earlier failures and
snapshot reuse remain explicit in `crawl-report.json`.

## Sources and provenance

- [Official storefront](https://buy.lulzbot.com/collections/all), collected through
  `https://buy.lulzbot.com/products.json?limit=250&page=1` and subsequent pages.
- [Official downloadable archive](https://download.lulzbot.com/): selected paths
  under TAZ, Mini, AO-100, AO-101, KITTAZ, Budaschnozzle, SideKick and retail_parts.
- [Public Aleph Objects manifests](https://www.importgenius.com/importers/aleph-objects-inc).

Individual rows retain source URLs and collection timestamps. `bom-sources.json`,
`crawl-report.json` and `manifest-source-report.json` retain source metadata,
hashes and limitations. Raw HTML, JSON, workbooks and sparse source rows are
retained locally in `raw/lulzbot-public-research/`, outside this package and the
deployed application. A rerun reusing a verified snapshot keeps its original
timestamp and records `reused_captured_snapshot`; it does not claim a fresh fetch.

## Missing customs evidence

No verified company-specific full HTS codes, customs entries, customs values,
paid duties or qualification records were obtained. Missing fields stay blank.

Retail prices and historical BOM purchasing prices are not customs values.
BOM quantities, package counts and gross weights are not tariff quantities.
Supplier location, model-region suffixes and reported manifest country are not
reviewed customs origin. Arrival date is not legal entry date. Historical German
origin notes remain separate, unverified for current entries. Names and suppliers
may vary across historical revisions; the parts file preserves those variants.
Source cached spreadsheet values were read without recalculating formulas.

Other research did not supply a complete ledger: ImportYeti and direct Volza
requests returned HTTP 403; no challenge was bypassed. The attempted ImportGenius
FAME 3D URL redirected to a generic trade page. Indexed Volza FAME material
describes exports and broad four-digit HSN categories, not exact U.S. import HTS
records. No exact LulzBot/Aleph Objects ruling was located in the bounded CBP
CROSS search. Secondary example classifications were not adopted as company data.

## Using and reproducing the tests

The four `calculator-intake-*.csv` batches contain 500, 500, 500 and 177 public
part identifiers respectively, with HTS, origin and entry date deliberately blank.
They are sized for the calculator's 500-row intake limit. They are expected to
request missing information, not calculate a duty. Large research CSVs are
reference evidence rather than ready-to-upload customs exports.

Run from the repository root:

```sh
python3 scripts/scrape-lulzbot-public.py
npx tsx scripts/scrape-lulzbot-manifests.ts
python3 scripts/normalize-lulzbot-public.py
npx tsx scripts/verify-lulzbot-public-data.ts
```

Verification uses Cante's actual CSV parsers and business-impact evaluator.
All 1,677 incomplete calculator rows are rejected with HTS errors. All ten
manifest rows retain honest missing-field errors and null computed totals.
No tariff calculation, LLM call or tenant write occurs. `verification.json`
records those results. To test duty accuracy next, obtain broker-reviewed HTS,
origin, legal entry date, customs value, paid duty and applicable qualification,
along with entry/line identity and an exact tenant catalogue match.
