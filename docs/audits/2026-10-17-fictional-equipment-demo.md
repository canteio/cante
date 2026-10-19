# Fictional equipment demo — October 17, 2026

## Delivered

`/tariff/demo` demonstrates CSV upload → simulated regulation → deterministic
impact → generated report → scenario questions in `/chat?demo=equipment`.
The dashboard links to this isolated playground. No real catalogue is seeded.

The generated public fixture has 50 products and 600 entry lines, all marked
synthetic. Ten distinct code examples were returned by public USITC search
responses; their application to the fabricated products and all baseline rates
remain assumptions. Source URLs and capture time are preserved with the fixtures.

The main hypothetical adds 25 percentage points to selected China-origin goods.
Origin AND HTS-prefix matching affects 18 SKUs, with $35,269,200.00 of planned
annual customs value and $8,817,300.00 of extra annual duty. Its monthly equivalent
is $734,775.00. The top-five results are in the downloadable report.

Historical duty is unchanged across scenarios. Annual forecasts use explicit
catalogue unit customs values × planned annual volumes, never automatic
annualization of past entries. Integer cents/basis points and per-SKU half-up
rounding own the calculation; the model receives formatted results.

## Verification

- Eight deterministic scenario tests: fixture counts and reconciliation, known
  totals/top-five ordering, origin-plus-code scope, zero-change control, history
  separation, rounding, malformed/unsafe input rejection, exports, and bounded
  per-SKU/month historical context.
- Two additional real-handler tests: scenario totals are recomputed despite a
  tampered client total, invalid rules are refused, and no customer data/memory
  access or persistence occurs. The five chat-route tests pass together.
- The existing 920-test suite passed during implementation. TypeScript passed
  after the final changes. An isolated production build of actual source passed
  with `npm run build -- --webpack`; existing Next/Edge-runtime warnings remain.
- Browser fixtures exercised real product/history file upload, example loading,
  regulation selection, invalidation of old results, zero-change results,
  top-five presentation, all-50 expansion, report generation/download and the
  scenario-to-chat handoff using the exact requested question. A downloaded
  50-row CSV was independently summed with decimal arithmetic: 18 affected,
  $8,817,300.00 extra annual duty. A mobile overflow defect found during this
  check was fixed and rechecked at 390px. Replacing a catalogue now invalidates
  old input/results before asynchronous file reading; invalid replacement CSVs
  disable calculation and leave no stale total. Reloading the example recovers
  the expected result. Session-restored editing and demo-specific chat controls
  were also checked.
- Screenshots remain in ignored `output/playwright/`. Browser chat transport was
  a fixture, not evidence of a live authenticated customer conversation.

## Live API proof

`scripts/verify-equipment-demo-chat.ts` invoked the actual chat route with the
configured OpenAI provider. Its database functions were replaced with a harness
that throws on customer-data access; only workspace identity was supplied by the
harness. It made exactly one live API request, with web tools disabled and zero
customer data reads/writes.

Question: “If this tariff hits tomorrow, how much more do we pay?”

Response:

> If the simulated China equipment surcharge hits tomorrow (hypothetical), the
> extra duty over the next 12 months at unchanged planned volumes is
> $8,817,300.00. 18 of 50 products are affected; the monthly equivalent is
> $734,775.00. This is a hypothetical deterministic scenario computed from your
> supplied annual planned units × unit customs value and the +25 percentage-point
> additive; no real liability or legal conclusion is claimed.

The test asserts the annual amount, affected count, monthly equivalent, simulation
label, one API call and zero customer-data operations. Subsequent historical-context
aggregation was covered by deterministic and handler tests rather than another paid
call.

## Scope

Demo chat recalculates the supplied CSV and known rule on the server. It receives
all per-SKU impacts and historical aggregates, twelve monthly totals, and up to
60 matching entry lines when a SKU/month is named. It does not access real company
context, web research, stored conversations, file filing or memory extraction.
Messages are transient; inputs stay in browser session storage for editing/reload.
Normal authenticated chat and the real tariff engine retain their existing paths.

This proves the explicitly fictional workflow and its arithmetic. It does not
prove live legal monitoring, full tariff coverage, actual classifications or
proprietary customer data accuracy. No schedules, delivery or deployment were enabled.

[Fixture methodology](../../public/examples/equipment-demo/README.md)
