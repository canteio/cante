# Historical reference data

October 25 working tree: `historical-chapter99-v2` uses the retained original CBP
Section 301 implementation chart for bounded 2018–2026 exclusion windows. Eleven
CBP guidance originals support selected 2025–2026 program intervals. The original
v1 contract remains for older pinned 2024 selections. Apply migrations
`20261024162000` and `20261024210000` before using the expanded archive selection.
Capture commands are operator-only and never approve rules or write customer
imports:

```sh
npm run references:backfill-exclusions
npm run references:backfill-cbp
npm run test:chapter99-history
npm run verify:chapter99-history
```

Add `-- --write` to either capture command only when intentionally retaining
official originals. Source execution uses a request-local 64 MB original cache,
32 MB text cache and 4 MB metadata bound. It selects relevant dated guidance;
annual archives are read only when the supported exact-rate path needs them.
Each original download has a 45-second deadline and at most one transient-read
retry within the worker deadline. Permission, missing-object, size and integrity
failures are never retried as successful reads. See the
[scope and verification record](../audits/2026-10-24-multiyear-chapter99.md).

October 24: the narrow `historical-chapter99-v1` compiler connects supported 2024
exclusion definitions (.67/.68/.69), their original modifying instruments and
China primary-metal notes. Exclusions need dated evidence and an exact product
definition; aluminum requires separate Russian-content facts. Known legal-action
originals are reusable across editions while rates/notes remain edition-bound.
This requires updated website and worker code; it is not universal Chapter 99
coverage. [Implementation, verification and remaining limits](../audits/2026-10-24-chapter99-audits.md).

```sh
npm run test:chapter99
npm run verify:chapter99
```

October 23 update: the annual-data compiler now supports bounded ordinary-duty
estimates when a dated rate, computation-code key, General Note 3 and the importer's
scope declaration agree. General Notes originals are retained for 2000–2017.
This supersedes the earlier base-scenario-only limitation for those supported
cases. First uploads can save disclosed inactive SKU links. Existing special-duty
and evidence limits remain. [Scope, verification and current Preview](../audits/2026-10-23-ordinary-audit-completion.md).


Cante separates **captured evidence** from **approved legal coverage**. Both Audits
and monitoring retain the existing deterministic tariff components. No new LLM
calculation service or per-entry legal interpretation is introduced.

Latest free-data addition: annual USITC legal-line files are connected for every
year 2000–2014 and 26 years across 2000–2026 (2019's mismatched text filename stays
outside this projection). These are 8-digit dated references and base-only
scenarios, not complete historical duties. New Federal Register discovery retains
2025/2026 tariff documents separately from applied rules. See the
[source, verification and release record](../audits/2026-10-22-free-official-data.md).

```sh
npm run references:backfill-free -- --years=2000-2014 --legal-years=none
npm run references:backfill-free -- --write --years=2000-2014 --legal-years=2025,2026
# Explicit correction/refresh; originals and earlier audit pins remain immutable:
npm run references:backfill-free -- --write --refresh --years=2014 --legal-years=none
npm run references:backfill-free -- --write --years=none --legal-years=none --documents=2026-15181
npm run test:free-official
npm run verify:annual-tariffs
```

Without `--write`, source discovery/download/parsing is local only. These commands
publish no customer imports, legal approvals or schedules. Default annual years
are 2000 through the runtime's current year. Legal search is a bounded tariff-keyword
query for selected agencies, not exhaustive legal coverage. A partial XML rendition
cannot replace uncaptured graphics/annexes for applicability. Operator summaries
and dated receipts stay in ignored `raw/tariff-references/free-official/`.

October 22 expansion: the linked project retains 173 versioned full-schedule PDF
responses, 173 Chapter 99 originals and 228 legal instruments for its 2018–2026
registry. One legal-note response failed printed-edition verification. Four full
JSON projections remain; other JSON downloads returned access challenges. Bounded
exact-code PDF lookup now supplies supported base-rate references without claiming
a complete projected chapter. Dated ordinary-scope Section 301 reference estimates
are separate from human-approved bundles. See the
[coverage record](../audits/2026-10-22-historical-coverage-expansion.md) for scope,
verification and remaining gaps; older backfill counts below are dated states.

For bulk capture, use the operator-only command:

```sh
node --import tsx scripts/backfill-all-tariff-references.ts
node --import tsx scripts/backfill-all-tariff-references.ts --write
node --import tsx scripts/backfill-all-tariff-references.ts --write --releases=2024HTSRev3
npm run test:historical-coverage
npm run verify:audit-pdfs
```

Large official originals use the private `official-tariff-references` Storage
bucket. Apply `20261023011154_large_official_reference_storage.sql` and
`20261023014238_reference_publication_execution_timeout.sql` before this importer.
Only the operator/worker publishes; authenticated members read public-government
evidence and cannot mutate it. Customer originals remain in their tenant store.
Publication retains the original/stored hashes. Never upload customer files into
this global bucket. New global references do not silently revise old audits;
explicitly refresh coverage to create a revision.

PDF fallback accepts simple Free/percentage rows only, verifies edition/chapter
identity, exact printed statistical suffixes and footnote definitions, and caps
the number of pages examined. Rule-source text has a 64 MB decode budget;
sequential PDF lookup has a 256 MB total-original budget per processing group. Split larger
date/chapter ranges when these bounds are reached. Per-unit/compound rates remain
available through supported canonical JSON/approved rules, not a guessed PDF rate.

## Data ownership

| Store | Purpose | May establish a complete historical duty? |
|---|---|---|
| `hts_schedule_embeddings` | Mutable current HTS search/classification index | No; its revision is current, not the shipment's date |
| `section232_tariff_rows` / `section232_coverage_reviews` | Extracted remedy candidates and explicit coverage review | Only through the existing reviewed coverage path |
| `tariff_stacking_rules` | Previously reviewed conditional stacking instructions | Applicable dated, confirmed human/document rules can participate; conflicting instructions remain unresolved |
| `tariff_reference_releases` | Publisher release/availability directory | No; publication availability is not a legal effective date |
| `tariff_reference_sources` | Immutable original official files and labelled legacy observations | Evidence for review, not approval |
| `tariff_reference_publications` / `tariff_reference_rates` | Atomic, reproducible chapter projections of those originals | Published references; approved bundles or the narrow separately labeled compiler must establish scope |
| `tariff_rule_bundles` | Human-approved historical scope, effective intervals, measures, exclusions and source references | Yes, within the approved scope and supplied facts |
| `audit_batches` / results / attestations / reviews | Tenant imports, pinned rule/source IDs and immutable execution/review history | Only the protected completed execution is displayed as calculated |
| `tariff_source_versions` / check archives | Tenant-captured monitoring evidence | Never automatically promoted to globally approved law |

The shared implementation is under `app/api/tariff/references/`; route handlers
are thin adapters. Audit preparation and the trusted audit worker use the same
lookup functions. Existing `lib/tariff` arithmetic and stacking resolution remain
shared. This location respects the repository's restriction on new `lib` modules.

## Backfill

Use operator credentials locally, never add them to the website:

```sh
node --import tsx scripts/backfill-tariff-references.ts \
  --pages=https://www.usitc.gov/2024_htsa_revision_1 \
  --capture-existing
```

This is a dry run. Add `--write` to publish reference evidence, not customer inputs
or approved legal rules. Up to 20 explicit official edition pages are accepted per
run. Files are discovered from their published links; URLs are not guessed.
The ignored `raw/tariff-references/backfill-summary.json` records failures.

The script stores the original release registry, an edition's original JSON,
version-verified Chapter 99 subchapter III PDF and linked Federal Register original
PDFs. Both compressed-byte and original-byte hashes are retained and verified.
Older identifiers such as `2023HTSARev4a` and older empty-string unit fields are
supported without altering original bytes. Unexpected formats fail visibly.

Original source capture is idempotent by URL/content hash. Chapters publish in
separate atomic transactions, with ordered payload hashes and completion markers.
Identical retries reuse the published chapter; a different projection is rejected.
A failed chapter cannot publish partial rates or a completion marker. An edition
is complete only when all 99 chapters, including reserved chapter 77, are accounted
for and the projected count matches the expected count. A complete projection is
not a claim of legal completeness. Failed captures remain in the summary.

The first October 22 backfill captured four full JSON editions: 2023 revision 4a,
2024 revisions 1 and 2, and 2026 revision 21. The later bulk expansion retained
the 173 versioned PDF responses described above. Only those four editions have
complete canonical JSON projections; PDF capture does not establish all legal
coverage or a complete searchable chapter projection.

## Use in Audits

New audits select and pin relevant source IDs and the immutable registry snapshot.
The worker looks up exact statistical codes and the associated Chapter 99
references. Dated, evidence-backed classification corrections change the lookup
code without overwriting the original entry. Published base/Column 2 rates,
footnotes, legacy candidates, missing coverage and original downloads appear in
finding details and CSV exports. Approved rule selection is indexed and scoped
to the audit's exact code, origin and dates; unrelated approvals do not consume
the per-run rule budget.

For older audits, **Update historical coverage** explicitly selects new references
and approved rules, creates a revision and preserves previous results. Uploading
an identical original/mapping/options/rule/source selection reuses the same audit.
Old v1 execution proofs remain readable and exports retain their actual version.

At `/tariff/rules`, an appointed platform reviewer can prepare a draft from retained
sources by specifying exact HTS, origin, base-duty column and a review interval.
The interval is an explicit request for legal review, not a date inferred from the
registry. The draft uses the historical published rates and references shared
originals instead of copying large JSON files into every bundle. Section 301
exclusion qualification and unmodeled Chapter 99 headings keep the draft unresolved
until the reviewer models their treatment. Capture/save and explicit human approval
remain separate actions. Tenant owner/admin privileges do not grant this authority.

No reviewer was appointed and no real legal rule was approved by this backfill.
Two execution paths remain distinct: explicitly human-approved historical bundles,
and separately labeled Cante-validated estimates from the narrow dated reference
compiler. The latter requires the original actions, dated scope, source contracts
and explicit shipment declarations; it never creates an approval. Outside either
established scope, full expected duties stay unresolved. Capture timestamps, new
publication records, `auto_approved` extraction labels and content hashes cannot
substitute for legal applicability or government-fetch provenance. Estimated
differences are never guaranteed recoveries.

## Bounds and failure handling

- CSV audits retain their 500-line/2 MiB limit; split larger ledgers into batches.
- A run pins at most 100 relevant legal bundles and 512 reference originals.
- Rate lookups accept at most 500 exact pairs per call; remedy lookups are batched.
- Each original is at most 25 MB uncompressed and is decoded with a hard output cap.
- Shared original evidence checked for approved execution is capped at 64 MB.
- User routes use authenticated workspace identity and shared database admission
  quotas. Downloads verify original bytes and return attachments with `nosniff`.
- Publication RPCs are service-only; members may read reference evidence, not edit
  it or approve legal rules. Tenant source archives remain tenant-scoped.
- This is bounded MVP processing, not a claim of load-tested enterprise throughput.
  DB file chunks are the current private file store; object-storage migration and
  retention capacity planning belong to measured growth, not a duplicate upload path.

## Verification

```sh
npm run test:references
npm run test:audits
npm run build:check-worker
npm run test:audit-worker
```

Run `supabase/tests/historical_audits.sql` and `supabase/tests/tariff_references.sql`
in one administrative rollback transaction as documented in the audit runbook.
The reference tests require historical-audit fixture setup and applied migrations.
The SQL fixtures exercise actual role grants, RLS, immutable data, chapter rollback,
resume/conflict checks and scoped rule selection; they do not establish legal law.

Validate legal coverage separately against dated legal instruments, exclusions,
entry qualifications and an independently reviewed broker calculation. Synthetic
arithmetic tests and a successful official-source download are not that validation.


## Same-year annual precision corroboration (v17)

The operator-only original capture is available as:

```sh
npm run references:backfill-annual-schedules -- --years=2016,2017 --chapters=65
# Explicit real shared-government-source writes, no customer seeding:
npm run references:backfill-annual-schedules -- --write --years=2016,2017
npm run verify:annual-schedules
npm run verify:annual-quantities
```

The first command is a local source-fetch dry run. The second writes real public
originals using the existing service-only publisher and private official-reference
bucket. It follows actual archive links and publisher names, preserves immutable
versions, skips identical retained originals, and reports each failure. Read its
raw/ summary; never call a failed/partial capture complete. Default scope is four
editions × 96 chapters (77 reserved). There is no new schedule or automatic rule
approval. Secrets remain on the trusted operator/worker.

The annual effective-date row supplies applicability. Same-year originals only
corroborate the identical complete printed formula and exact known truncation;
all applicable pinned candidates must agree. PDF availability is not a legal
effective date. Footnotes, unsupported units/procedures and contradictory sources
can withhold totals. New small originals may use existing object storage to avoid
inline database growth; stored/original byte hashes are both verified. Earlier
immutable originals are preserved. The lookup bounds each chapter to 25 MB/250
pages, metadata to 4 MB, and chapter decoding to 256 MB per execution group.
The read-only verifier distinguishes 384 source identities from its four complete
chapter/storage samples; it does not certify every formula or legal coverage.


October 27 v22: `scripts/backfill-ordinary-tariff-notes.ts --country-actions`
is a read-only dry capture by default; explicit `--write` publishes four immutable
GovInfo originals with `historical_country_action` metadata. It creates no human
approvals, tenant entries or schedules. The dated compiler validates the complete
text contract plus operative clauses; its content hash is not legal approval or
government-fetch provenance. Existing audits should refresh historical coverage
to pin relevant transition-year originals and request the current engine. Source
publication and legal dates differ for these notices. See
[scope and verification](../audits/2026-10-27-ordinary-country-coverage.md).


October 28 v23: separate Column 2 fields now use the retained annual originals,
code key, field meanings and dated country notes. Existing original schedules
supply supported precision/statistical corroboration. No new source capture or
human approval was needed. Commands are read-only or local synthetic tests:

```sh
npm run test:column2
npm run verify:column2
npm run verify:column2-scope
```

The scope inventory writes only `/tmp/cante-column2-source-inventory.json`; its
repeated source-record counts are not complete legal/shipment coverage. Existing
archives retain missing fields and unsupported procedures explicitly. Release
website and worker together only when authorized. [Exact scope and evidence](../audits/2026-10-28-column2-historical-duties.md).


## Dated annual change records

Validate the original 2017 Revision 1 Change Record with the existing pinned
archive, registry and edition-details parents:

```sh
node --import tsx scripts/backfill-annual-change-records.ts
node --import tsx scripts/backfill-annual-change-records.ts --write
node --import tsx scripts/verify-ordinary-pilot.ts --restored-column2
```

The default only reads/validates; `--write` retains a public original and verifies
its bytes after reading it back. It creates no approval or tenant entry. Deploy
matching website/worker code separately. The runtime contract recognizes explicit
restoration/annotation dates; missing/changed wording fails closed, and N/A is
never converted to January 1 or the source capture/publication date. The supported
2017 tile restoration retains blank earlier fields and cites both the correction
and corrected chapter. All results remain labeled Cante-validated estimates on
declared lawful scope, not human legal review. See the
[v28 verification and remaining scope](../audits/2026-10-28-dated-rate-restoration.md).
