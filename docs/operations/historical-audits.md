# Historical audits

Historical source backfill, source pinning and reviewer draft preparation now use
the [shared reference archive](historical-references.md). Publication dates do not
establish legal effective dates. New execution uses `historical-audit-v7`; retained
v1–v6 proofs remain readable. **Update historical coverage** refreshes both source
and approved rule selections, preserving earlier calculation versions.

The top-level **Audits** tab uses `/tariff/audits`. CSV originals use existing
workspace file storage; confirmed inputs also create an immutable historical
impact snapshot. The old interface remains at `/tariff/audits/legacy`.

October 25 working tree: dated 2018–2026 China-list/exclusion support and selected
2025–2026 additional programs reuse the existing engine. Optional full-value
program declarations and dated per-entry decisions establish shipment facts;
they do not approve regulations. Audits pin up to 512 source versions. The worker
saves groups of at most 25 lines from one calendar month, yields between bounded
requests and resumes the saved checkpoint. The page permits six continuation
requests and preserves shared database quotas. See the
[implementation and coverage boundaries](../audits/2026-10-24-multiyear-chapter99.md).

October 24: supported 2024 Chapter 99 exclusions and China primary metals share
the existing engine. A finding shows published product definitions; **Review this
exclusion** opens the dated evidence decision in place. Saving confirmed facts
starts recalculation automatically and preserves earlier results. Qualification
is not inferred from an uploaded heading. See the
[scope and verification record](../audits/2026-10-24-chapter99-audits.md).

## Scope and workflow

Upload CSV → confirm columns → validate → save → run → review → export CSV.
Limits: 2 MiB, 500 entry lines, USD duties, ordinary consumption entries. Preserve
entry/line identity and full HTS strings. Missing data remains visible. Paid totals
exclude fees and other taxes. Deriving a total from base/additional components
requires an explicit completeness declaration. Ambiguous dates require a format
selection. Reconcile multi-record Chapter 99 exports before treating them as lines.

Current product origin is a discrepancy lead, not historical origin proof.
Evidence-backed corrections and product associations require references and a
valid inclusive-from/exclusive-until interval. The original declaration remains
unchanged. Fact decisions create a new revision, invalidate current totals and
retain all old results. A supplier move alone never changes legal origin.

## Database and execution

Apply migrations `20261022155806`, `20261022163123`, and `20261022164458`.
They add audit batches, immutable per-entry results, review events, protected
execution attestations and global historical rule bundles. Existing historical
impact snapshots are reused for input traceability, not retroactively trusted as
verified calculations. Legacy annual-impact constraints remain unchanged; new
audit results avoid representing specific-duty amounts as annual forecasts or a
fictional aggregate percentage.

The existing isolated checking worker accepts signed `historical_audit` tasks via
the same `/api/check` connector and session authentication. Rebuild/deploy that
worker before releasing the website. No service credential belongs on the website.
Local HTTP is permitted only for an explicit localhost connector outside Vercel.

Worker execution independently reads the original, revalidates confirmed inputs,
loads pinned approved rule versions, resolves tenant catalogue links and runs
deterministic arithmetic. It does not fetch current rates or call a model. A
five-minute fenced database lease prevents concurrent finalization. Checkpoints
save every 25 lines; interrupted runs can resume. Changed facts invalidate the
lease and checkpoint. Every resume remains subject to database admission limits.
Finalization atomically commits all entry results and a protected proof binding
their ordered bytes to the inputs, rules and engine version. Readers verify row
hashes, aggregate hash and summary; failures withhold totals.

**Update approved rules** explicitly pins newly approved coverage as a new revision
without requiring another CSV upload. Unchanged coverage does not invalidate a
completed audit. Older versions remain accessible through the result history.

## Local workflow test without approval

Open `http://localhost:3000/audit-test` while the existing development server runs.
Use **Download test CSV**, upload the file, confirm columns/input facts, run, inspect
findings, record reviews and export. This reuses the ordinary Audits upload,
validation, results and finding components, plus the real deterministic engine and
CSV writer. A test transport keeps originals/reviews/results only in the current
tab. Reloading or starting over clears the session. Test findings cannot enter
workspace chat or a saved customer audit.

The server loads the labelled 120-entry functionality fixtures and explicitly
removes their simulated approval before calculation. The engine skips approval
only when synthetic testing is explicitly enabled **and** the rule definition is
synthetic. Unapproved real rules still fail even with that test argument; ordinary
workers never enable it. Dates, scope, missing evidence and arithmetic are checked.
Fixture qualification decisions apply only to unchanged known fixture records,
not arbitrary rows with the same SKU or row number.

The page and endpoint return 404 outside local development, including every
Vercel runtime. The stateless endpoint bounds bytes before JSON parsing, supports
at most 500 entries, rejects cross-origin writes and performs no database, model
or government-source calls. The screen and each report row label its fictional
basis. Real-workspace approval/reviewer controls and database permissions remain
unchanged. This tests the workflow and calculations, not historical legal accuracy.

## Human-approved historical coverage

There are no production historical tariff rules seeded by this feature. Until an
appointed platform tariff reviewer approves relevant coverage, dollar comparisons
remain unresolved. Tenant owners/admins are not global reviewers. No accounts are
appointed automatically.

The authorized `/tariff/rules` page includes historical snapshot preparation and
source review. Submit a package containing `definition` and `sources`. The runtime
contract is `bundleSchema` in `app/api/audits/model.ts`; unknown fields are rejected.
Each source supplies a unique `id`, official HTTPS `url`, and optional `title`.
Cante captures original UTF-8/PDF bytes, hashes and timestamps before saving the
draft. Limits are 20 sources, 4 MiB each and 10 MiB retained per bundle. Redirects
and non-government sources are rejected except the official CBP CSMS account.
Download the retained original from the reviewer page before approving.

Definitions specify exact statistical codes and origins for reviewed coverage,
inclusive/exclusive effective intervals, required facts, dated base/additional
measures, evidence references and optional include/exclude/component-cap stacking
rules. Every scope/measure/stacking rule needs source IDs. Conditions must be
represented explicitly; do not hide unmodeled qualifications in a rate string.
Exactly one base measure must actually resolve under the supplied facts. Specific
duties require matching quantities/units. Metal-content bases, unsupported rates,
missing qualifications and conflicting coverage remain unresolved. A component
cap is not a combined-duty cap. Do not mis-model combined ceilings as ordinary
additive rates. `supersedes` explicitly identifies replaced snapshot IDs; overlapping
snapshots without explicit supersession withhold calculations.

Review requires an appointed reviewer, affirmative source-read confirmation and a
written legal basis. Approval freezes the entire version. Corrections create a
new version. `synthetic: true` cannot be approved or executed in a real audit.
Source hashes establish retained-byte integrity; human approval establishes the
recorded interpretation, not a guarantee that every legal obligation is covered.

## Review, exports and assistant

Review notes append. Reviewing/resolving requires a verified current result;
unresolved calculations cannot be marked resolved. Resolution is internal and
does not mean a customs filing, accepted protest or refund. Gross overpayment and
underpayment subtotals include calculable lines only, never net each other, and
do not treat unknown amounts as zero. Without any calculable lines the UI says
**Needs review**.

CSV export uses retained results and includes original facts, applied facts,
components, citations, missing evidence, next steps and review state for that
version. Audit-to-chat handoff retrieves the authorized protected result on the
server, suppresses current-product refresh routing, and provides an explicit
return link. Chat cannot approve rules or facts. Evidence notes/descriptions remain
untrusted prompt data. No model call is needed to run or export an audit.

## Validation

Use `npm run test:audits`, `npm run build:check-worker`,
`npm run test:audit-worker`, TypeScript, the existing regression suite and an
isolated production build. `supabase/tests/historical_audits.sql` uses disposable
identities and rolls all fixture writes back; run only through an administrative
test connection. Never use customer entries as disposable test data.

Validate real coverage separately: retain authoritative historical USITC editions
and modifying instruments, review applicable origin/classification and transition
facts, obtain human approval and compare independently reviewed examples. The
synthetic suite does not establish legal or financial accuracy.
