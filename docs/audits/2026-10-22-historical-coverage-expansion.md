# Historical coverage expansion — October 22, 2026

## Implemented

The shared historical archive now retains **173 versioned full-schedule PDF
responses, 173 Chapter 99 subchapter III PDFs, and 228 legal instruments** in the
linked database/storage project. These cover the 173 entries in the current
2018–2026 release registry. They are government evidence, not 173 approved rules
or a claim to all U.S. law since 1989. One Chapter 99 response for
`2022HTSABasicRev1B` failed printed-edition verification; it remains visibly
unverified and cannot establish a compiler contract.

Four complete JSON editions / 91,539 rate records remain available. The publisher's
separate JSON host returned HTTP-200 Akamai challenge pages for other downloads;
these were rejected. One archive-index page also returned a challenge. Older
PDF-only index entries and oversized/unavailable modifying instruments are recorded
as capture gaps. Operator summaries and original download caches stay under ignored
`raw/tariff-references/bulk/`, never public assets or tracked evidence.

`scripts/backfill-all-tariff-references.ts` discovers published links, bounds
pagination/concurrency/bytes, resumes chapter publication and retains failures.
It captures legal notes independently of JSON failures. Large public originals
use the existing Supabase Storage service in a dedicated private
`official-tariff-references` bucket. Members may read official evidence but cannot
insert, alter or delete it. Customer uploads remain in the existing tenant store.
Original and compressed-byte hashes are verified when reading objects. No website
service key, new hosting service, customer seed or automatic approval was added.

`app/api/tariff/references/pdf-rates.ts` adds bounded exact-code lookup in pinned
full PDFs. It verifies the printed edition identity or exact revised chapter
identity, locates chapter ranges, requires the known table/column structure and
actual printed statistical suffix, and accepts only complete simple Free/percent
rates. It retains page numbers and associated footnote definitions. Superscripts
from adjacent rows cannot become the selected row's exception. Missing definitions,
unrecognized layouts and unsupported expressions do not establish a total.
Unchanged chapters may retain an older footer when the full cover establishes the
edition. A Basic Edition cover needs an exact matching revised chapter header.

`historical-contract.ts` compiles dated ordinary-scope Section 301 reference
estimates for the explicit tables associated with 9903.88.01, .02, .03 and .15.
The original actions/modifications, matching consolidated language and dated scope
tables must be retained. List 3's earlier 10% and List 4A's earlier 15% intervals
cannot cross their modifying dates. Descriptive product-only scope and unmodeled
headings remain outside this compiler. These are Cante-validated estimates, never
human approvals. Historical engine v4 preserves v1/v2/v3 readers and snapshots.

Audit findings and CSV exports distinguish missing shipment information,
missing historical sources, unsupported tariff treatment and evidence review.
Quantity-dependent failures name the required unit. A retained PDF whose table
cannot be read is not described as an absent government source. Original entries,
dated reviews, tenant catalogue matching and execution attestations remain intact.

## Verification and limits

- Configured main regression run: 936 passing. An earlier run encountered database
  gateway/connection errors and is not counted as passing. The successful retry
  loaded the Next environment and bounded test-file concurrency to two. The cause
  of the earlier gateway failures was not independently established.
- Focused audit/reference/CSV/dashboard tests: 74 passing at the recorded revision;
  TypeScript passes. Final deployment checks are recorded below when complete.
- Actual government-reference 120-entry fixture still matches its independent
  manifest: 100 calculated, 20 unresolved, 70 discrepancies; fictional $2,900
  overpayment / $2,700 underpayment. No customer ledger was used.
- Actual PDF lookups reproduce the published 4% base rate for fictional motor
  entries in 2020, 2021, 2022, 2023 and 2024. Declared ordinary China/Vietnam cases
  calculate $290/$40 on $1,000 in the three supported 2022–2024 examples. The
  2020/2021 rows explicitly withhold totals because the referenced 9902.16.06/.07
  treatment is not established. The fixed expected fixture records those nulls.
- The bundled audit worker preserves 120 originals, signed dispatch, tenant scope,
  execution proofs and checkpoint/resume with isolated Auth/REST fixtures. Existing
  manual/daily worker calculations pass against replayed actual government bytes.
- Actual linked-database Storage-policy tests verify authenticated evidence reads,
  member mutation denial and anonymous denial in a rollback transaction.
- Browser verification exercised upload, mapping, validation, run and finding
  details through the real screens at local `/audit-test`. Its 120 fictional-rule
  entries produce 75 calculated / 45 unresolved without importing their separate
  optional evidence decisions. That local fixture is distinct from the 120-entry
  government-source fixture above. It writes no customer records.
  The detail screen explicitly identifies missing shipment fields and next steps.
  CSV export is covered by server tests; the browser download wait timed out and
  did not yield a verified downloaded artifact.

Full historical financial coverage is still incomplete. The reference compiler
does not establish 2025/2026 country regimes, all Section 232 sectors/content
calculations, AD/CVD, Column 2, preferences, product-specific exclusions or unseen
older law. PDF lookup also withholds complex/per-unit expressions and unsupported
layouts. No passing synthetic test or download count proves legal completeness,
refund eligibility or correctness for an unseen customer file.

## Release

Both Vercel builds completed with `READY` status:

- Website Preview: [private deployment URL omitted]
- Trusted worker: [private deployment URL omitted]

Website Preview configuration and the local connector select the new worker's
`/api/check`. Supabase Vault selects its `/api/monitor`; the existing authorized
five-minute dispatcher remains active. No workspace was opted in, additional
schedule activated, or delivery credential added. Production website configuration
and promotion remain unchanged.

A browser visit to the new Preview's `/tariff/audits` reached Vercel's sign-in
protection. Hosted end-to-end acceptance of this exact expansion is therefore
not verified. Earlier pilot hosted acceptance belongs to the earlier release
record and must not be attributed to this deployment. Local/browser fixture,
real-source read-only checks, bundled worker tests and successful builds are
reported separately above.
