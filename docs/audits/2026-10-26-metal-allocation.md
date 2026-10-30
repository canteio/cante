# Charged-metal allocation and early 2026 Section 122

October 26, 2026. Local audit engine v11 continuation. Full historical coverage
remains IN PROGRESS. No deployment, daily target, tenant permission or legal
approval changed.

## Corrected behavior

When a tariff applies to only the steel portion, the remaining tariff's value
must subtract that steel portion. It must not also subtract aluminum or copper
that are not covered by a metal duty. The earlier compiler previously selected
the all-metal remainder for these cases; that could understate the remaining
duty when other metal values were supplied.

The shared exact engine now supports explicit single-metal and combined-metal
remainders. Missing unrelated metal values are not invented as zeros and do not
prevent a steel-only allocation. Required deducted values still need dated
evidence. Supplied metal values totalling more than customs value withhold the
total until corrected; originals and prior results remain intact. Existing
all-metal and other bases retain their meanings for older snapshots.

The earlier-metal compiler also supports the February 24–April 5, 2026 Section
122 overlap. The retained [original proclamation](https://www.govinfo.gov/content/pkg/FR-2026-02-25/pdf/2026-03824.pdf)
explicitly applies the surcharge to the portion outside Section 232 treatment.
Its exact clause, date, rate and Eastern cutoff must match. A changed or absent
original withholds this treatment. Full-value metal duties remove the overlapping
surcharge; partial-value duties leave the other portion subject to its separately
established rate and exceptions. Independent China Section 301 remains separate.
[CBP's implementation guidance](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/40b3b7b)
and dated notes establish the surcharge's other conditions.

The original is retained as source `d5054a1f-0434-4a90-933f-3dfb576ca642`.
The loader now keeps it for relevant early-2026 calculations rather than only
the first-day amendment. Commodity rates remain from the entry-date edition.
Both sides of the first-day 00:01 Eastern start are tested independently from
the earlier midnight IEEPA termination.

Existing `shipment.ts`, `model.ts`, `engine.ts`, `compiled-reference.ts`,
`metal-history.ts` and `store.ts` are reused. The earlier compiler is versioned
`historical-metals-2025-v2`, new results use audit v11, and old v1–v10 results
remain readable. No new runtime module, service, dependency, migration or grant
was added. Calculations make no per-shipment model calls.

## Verification

- Twelve selected calculations against actual retained government originals
  pass, with explicitly fictional shipment evidence. Examples on USD 1,000
  customs value include China steel duty plus Section 122 totalling USD 670,
  Vietnam/Canada/India USD 420, UK USD 220, ordinary China aluminum USD 719 and
  the supported older positive Russian-content aluminum case USD 2,299.
  The first-day China steel example totals USD 650 before 00:01 and USD 670
  afterwards. A 2025 reciprocal example retains unrelated metal in its remainder.
- 99 focused tests and 931 existing regressions pass. TypeScript, website build,
  worker build and the separate mocked worker test pass. The worker bundle is
  3,793,390 bytes with 324 inputs and no website/provider/delivery code.
- Real isolated Auth/database/worker acceptance passes thirteen fictional
  entries, mapping, idempotency, thirteen dated decisions, original upload hash,
  exact SKU association, immutable earlier results and CSV export. All thirteen
  initially require evidence; after decisions all calculate, with nine
  discrepancies, USD 500 potential overpayment and USD 200 potential underpayment.
  The thirteenth preserves its original overallocated values and separately
  records the evidence correction. Other-company detail/export reads return 404;
  direct result RLS reads return no rows. Inactive linked products have no
  invented current origin, customs value or tariff facts.
- Browser correction/export passes: changing fictional steel value from USD 800
  to USD 600 changes duty from USD 670 to USD 590. The surcharge assesses USD 400,
  including the unrelated aluminum and copper. Display revision 15 shows USD 580
  overpayment and USD 200 underpayment, separately. Downloaded CSV preserves the
  original USD 800, revised USD 600, decisions, exact bases and citations. Direct
  retained results verify display revisions 14 and 15 still hold USD 670/590.
- Browser sign-out is visibly confirmed and its temporary tab closed. Temporary
  servers stop; the port-3000 development server remains running. Cleanup's
  redundant operator global-signout reported a failure after browser logout.
  A live aggregate query confirms zero sessions for banned audit fixtures; the
  fixture account ban is separately checked.

Private local evidence: `/tmp/cante-content-allocation-verification.log`,
`/tmp/cante-content-allocation-live-acceptance.log`, the temporary
`cante-audit-pilot-DrYWr1` folder and
`/tmp/cante-metal-allocation-audit-results.png`. The isolated tested website build
is `cante-history-build-mKGe6s`. No credentials or raw customer records are
included here.

## Still unfinished

These are selected actual-law cases with fictional qualifications, not
independent broker/legal or financial validation. The broad
[completion ledger](../plans/historical-coverage-completion.md) remains open:
India's earlier additional-duty/metal interaction, U.S.-metal zero-duty overlaps,
first-day 2025 inclusion amendments, conditional newer metals, other 232 sectors,
preferences/Column 2, broader AD/CVD/final assessment, reductions/exclusions and
special-entry/transit cases still require further work.
