# Free official historical sources — October 22, 2026

## What a 2000–2014 import can do now

An audit can import the historical CSV, retain its original declarations, find
dated USITC **8-digit legal-line base-rate evidence** and show a clearly labeled
ordinary-MFN base-duty scenario where its expression is supported. That scenario
does not enter expected-total, savings or discrepancy sums. Full historical duties
still require exact statistical-code validity, country treatment, additional-duty
scope, preferences/exclusions and sufficient shipment evidence. This expansion
does **not** establish automatic complete auditing of arbitrary 2000–2014 imports.
The existing CSV limit remains 500 lines / 2 MiB per audit.

## Sources actually retained

- All 15 annual files for 2000–2014: 239,248 source records.
- 26 annual files across 2000–2026: 392,725 source records. The 2019 annual ZIP
  contains a text filename identifying 2018, so that projection is not admitted.
  The existing separately versioned 2019 schedule archive remains independent.
- Agency-filtered Federal Register `tariff` discovery for 2025/2026: 173 and 112
  documents respectively. 284 official GovInfo PDFs were retained/reused.
  `2026-15181` exceeds the 25 MB PDF limit; its publisher-linked XML rendition was
  retained instead, with the missing PDF/annex-graphics limitation explicit.
  These searches are not an exhaustive inventory of tariff law or applicability.
- The annual download directory, field dictionary, code key and all four search
  response pages are retained with their original-byte integrity records.

Only public government material was published into the existing shared immutable
reference store. No tenant entries, memberships, approvals, reviewer appointments,
schedules or delivery settings were created. No schema changes or dependencies
were needed. Original ZIP/PDF/XML downloads and operator receipts remain private;
no raw source files were added to tracked docs or public assets.

## Implementation

`annual-data.ts` reads only an exact-year publisher text member, checks archive
expansion/entry/record/field limits before use, supports legacy pipe/tilde quoting
and modern CSV, and preserves leading-zero legal codes. UTF-8 is checked strictly;
legacy files fall back to Windows-1252. Source record dates are explicit inclusive
dates, bounded to the selected annual-file year. No 2050/2100 end marker permits
use of that annual file for later years.

Actual sources contain three reversed-date records in 2002, seven in 2007 and
one invalid-date record in 2020. Such rows remain retained evidence. They block
selection for the affected legal line, even when another row looks usable; they
do not silently get corrected or contaminate unrelated legal lines. Multiple
matching intervals also yield no selected rate.

The captured code key must establish the supported methods. Only simple Free
and ad-valorem MFN expressions with consistent numeric/text fields produce a
base-only scenario using existing exact arithmetic. Quantity/compound methods,
type T statistical-level duties, unsupported expressions and missing contracts
remain uncalculated. Country eligibility and preference qualification are never
inferred from annual program indicators.

`store.ts` pins annual sources by the entries' actual years and includes their
dictionaries. Generic publication search hits never become automatically applied
rules or consume every audit's source budget. Existing exact-code dated reference
compilation and human-approved bundles remain separate. Existing audits need an
explicit coverage refresh to select new sources; prior results remain intact.
Annual data appears in finding details and the existing CSV reference field.
Downloads retain ZIP/XML content types, attachment disposition and `nosniff`.

`backfill-free-official-data.ts` is operator-only and resumable. Discovery pages
and the current-year annual file fetch afresh; `--refresh` also re-fetches cached
older originals. Sources remain immutable by URL/content hash. Failures and XML
limitations are recorded; source acquisition never creates a legal approval.
The existing bulk backfill and new importer share one operator publication helper.

## Verification

- 81 focused audit/reference/workflow tests pass; TypeScript passes.
- A read-only linked-database fixture checks one fictional motor entry in every
  year 2000–2014. Each finds the published ordinary 4% base reference and produces
  a $40 base scenario on fictional $1,000 customs value. Each expected total and
  overpayment remains null; aggregate potential overpayment remains $0.
- The existing actual-source 120-entry fixture still matches: 100 calculated,
  20 unresolved, 70 differences, fictional $2,900 / $2,700. It exercises different,
  narrowly supported dates/scope and does not establish old-year total coverage.
- Bundled audit-worker tests pass original retention, dispatch authentication,
  tenant scope, execution proofs and checkpoint/resume with isolated REST fixtures.
  No live customer audit or paid model check was run.

## Release

The new worker Preview is ready at
`https://cante-check-worker-nyzd3q2ta-jeremygautamas-projects.vercel.app`.
Preview and local manual/audit connectors select its `/api/check`. The existing
daily Vault target remains on the previously tested worker; no scheduler change
was required. Production is unchanged.

Website Preview is ready at
`https://cante-rm5gwgb57-jeremygautamas-projects.vercel.app`.
Both Vercel deployments report `READY`; the website retains Vercel authentication.
Hosted signed-in end-to-end acceptance of this exact release was not performed.
The read-only live-source checks, fixture worker verification and successful build
are distinct from a real customer audit or production deployment. No commits,
pushes, production promotion or existing dev-server restart were made.
