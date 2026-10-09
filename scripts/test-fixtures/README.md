# Public-product demonstration and synthetic customs entries

**No Toro or LulzBot customs ledger, paid duties, origin declarations or actual
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
