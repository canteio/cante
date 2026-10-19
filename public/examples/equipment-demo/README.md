# Fictional equipment tariff demo

This is a fabricated outdoor-power-equipment business, not an actual company's
catalogue or customs ledger. Every CSV row is marked `SYNTHETIC DEMO - NOT CUSTOMER DATA`.

## Files

- `products.csv`: 50 DEMO-prefixed SKUs across ten equipment/component families.
  Unit customs values, planned annual units, origins and baseline duty rates are assumptions.
- `imports.csv`: 600 fictional entry lines, October 2025–September 2026. Each SKU's
  twelve quantities reconcile to the example annual plan, but the application does
  not derive its annual forecast from the history. Entry/line IDs, values and paid
  duty remain separate from scenario calculations.
- `expected-impact.csv`: all 50 calculated SKU results for the main simulated rule.
- `scenario-report.md`: human-readable report for that same rule.
- `hts-provenance.json`: ten distinct statistical codes returned by the public USITC
  search API, with URLs and capture time. Code existence was checked, not the
  correctness of assigning those codes to these products. The codes do not establish
  current duty rates, exclusions or a complete tariff stack.

## Main hypothetical

Add **25 percentage points** for China-origin products with HTS prefixes 843311,
843390, 840790, 850131 or 848340. This is an invented regulation with no legal
citation or actual government authority. Treat it as starting with the next imports,
then hold planned volumes and customs values constant over the next twelve months.

Expected: **18 of 50 products affected**, **$8,817,300.00 extra annual duty**,
**$734,775.00 monthly equivalent** (annual divided by twelve, not a shipment schedule).

Top five:

| SKU | Extra annual duty |
|---|---:|
| DEMO-MOW-005 | $1,642,800.00 |
| DEMO-DEK-005 | $911,680.00 |
| DEMO-MOW-002 | $893,550.00 |
| DEMO-ENG-005 | $816,960.00 |
| DEMO-MOW-001 | $693,750.00 |

The other scenarios add ten points to selected China/Vietnam components or apply a
zero-rate control. Selecting another scenario invalidates previous displayed results.

## Method

1. Parse strict, bounded CSV; reject absent fields, duplicates, unlabelled inputs,
   invalid amounts/dates, mismatched import records and unsafe integer totals.
2. Match both origin and the selected HTS prefix. Do not use fuzzy or AI matching.
3. Annual customs value = unit customs value × explicit planned annual units.
4. Compute before/after duty using integer cents and integer basis points, rounding
   half-up per SKU annual duty. Extra = rounded after minus rounded before. Sum SKU
   results for totals and sort by extra duty (then SKU) for the top five.
5. Leave past duty payments unchanged. No retroactive liability or refund is computed.

No real Section 301/232/AD-CVD stacking, exclusions, preferences, fees, quantity-based
rates or classification decisions are modelled. This demonstrates a hypothetical
workflow, not the accuracy or completeness of the live tariff engine.

## Try it

Open `/tariff/demo`, upload `products.csv` or choose **Use the 50-product example**
(which also attaches the history), choose a simulated regulation, calculate, and
select **Generate report**. Download the report and per-SKU calculations.

**Ask Cante about this** opens `/chat?demo=equipment` with the calculated inputs and
the question “If this tariff hits tomorrow, how much more do we pay?” ready to send.
The server recalculates those inputs; it never trusts client totals. All per-SKU
and monthly historical aggregates are available to chat. Asking for a SKU or month
also supplies up to 60 matching entry lines; the complete ledger remains downloadable. Demo chat uses
no web tools or real customer context, and does not save conversations, catalogue
records or memories. Inputs stay in browser session storage; messages are transient.
The authenticated chat API still requires an explicitly configured hosted API.

Regenerate using `node --import tsx scripts/generate-equipment-demo.ts`.
Run deterministic checks with `npm run test:demo`. A separately invoked
`scripts/verify-equipment-demo-chat.ts` makes one live API request while forbidding
all customer-data reads/writes; it is not part of the default test suite.
