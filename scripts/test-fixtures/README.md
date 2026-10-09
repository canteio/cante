# Public-product demonstration and synthetic customs entries

**No proprietary customs ledger, paid duties, origin declarations or actual
import values have been supplied.** Public product documentation does not prove
that a company imported a product, its origin, classification, or its duties.

## Recommended CSV demonstration

1. Import `lulzbot-public-products.csv` into Catalogue. Public product names and
   links are sourced; the `DEMO-` SKU labels and proposed HTS classifications are
   test assumptions, not LulzBot customs classifications.
2. Import `lulzbot-synthetic-imports.csv` in Tariff. Every entry, date, origin,
   quantity, value, payment and qualification statement is explicitly synthetic.
3. The filament lines exercise the narrowly reviewed 3916.90.30.00 basis. The
   motor line deliberately remains unresolved, demonstrating coverage limits.
4. The historical change panel replays the real July 24 tariff transition on
   the same uploaded filament volumes. It is not an annual forecast, a newly
   detected event, a claim about LulzBot's costs, or a refund determination.

Public references checked October 9, 2026:
- https://buy.lulzbot.com/collections/pla-filament
- https://ohai.lulzbot.com/project/taz-6-final-assembly/taz-6/
- https://ohai.lulzbot.com/project/long-bed-assembly/quiver/

The proposed filament HTS classification requires independent review of actual
material and dimensions. Synthetic reviewed flags are test assertions only;
never use them as evidence for customer goods.

## Older fixture

`lulzbot-taz-bom.csv` is a **legacy synthetic tariff-input fixture inspired by
public printer parts**. Its suppliers, countries, spending, quantities, SKU labels
and HTS mappings have not been established as real LulzBot business records.
Several codes have only eight digits. Do not present it as a genuine import
ledger or a verified BOM-to-HTS mapping. It remains for parser regression work.

## Actual public Aleph Objects (LulzBot) manifest records

`lulzbot-public-manifests.csv` transcribes three publicly displayed shipment
records from https://www.importgenius.com/importers/aleph-objects-inc,
accessed October 9, 2026. It is not synthetic. The rows identify filament
(arrival July 27, 2018), step motors (September 27, 2015), and power supplies
(February 13, 2015), with their published bills of lading, suppliers, gross
weights and package counts. LulzBot's own announcement identifies Aleph as its
manufacturer: https://assets.lulzbot.com/legacy-site/aleph-objects-inc-2016.pdf.

This is third-party manifest evidence, not broker-certified entry data. Customs
entry ID/line, SKU, exact HTS, customs value, duty paid and legal entry date are
not published in these rows and remain blank. The site's reported China field
is retained separately from a legally reviewed country of origin. Arrival date
is not entry date; gross weight is not dutiable quantity; a bill of lading is
not a customs entry number. The power-supply description is shortened; no
customs facts were added. Company-name attribution is third-party, not verified
by a broker or the manufacturer.

The acceptance test expects all three records to be retained as incomplete,
with no tariff lookup, assessed duty, overpayment or financial total. This tests
real-record intake and missing-data handling. It cannot validate duty accuracy:
that requires customs-entry records containing the missing facts. Earlier
synthetic fixtures remain regression tests and are no longer advertised in the
customer interface.
