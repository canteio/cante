# Historical audit expansion — October 22, 2026

Later October 22 follow-up: shared historical sources, rule-draft preparation,
newer worker Preview and clean SQL lint supersede the original reference/worker
limits below. See the [architecture/data audit](2026-10-22-supabase-architecture.md)
for current verification. Full historical legal approval is still outstanding.

Implemented a top-level Audits workflow using the existing catalogue, original
file storage, historical input snapshots, duty-expression arithmetic, deterministic
stacking resolver, reviewer authority and isolated trusted worker. Existing
tariff/chat/monitoring capabilities remain. The previous historical interface is
preserved at `/tariff/audits/legacy`.

The first release accepts USD ordinary-consumption CSVs up to 500 lines / 2 MiB.
It confirms mappings, retains invalid lines and originals, matches catalogue SKUs,
supports dated evidence-backed product associations and fact corrections, and
shows per-line calculations, missing evidence, citations, reviews and CSV export.
Current catalogue origin differences are leads, never historical proof.

Historical calculation uses immutable human-approved bundles. It never substitutes
today's rates, calls a model per shipment or auto-approves extracted rules. Source
originals/hashes and effective intervals are retained. Unsupported conditions,
metal-content bases, unavailable rates and coverage conflicts remain unresolved.
No real legal bundles were seeded or approved during implementation.

Five supporting tables were added. Existing historical impact rows retain input
snapshots; new immutable entry-result records hold calculations/findings. This
avoids weakening legacy annual-impact constraints to accommodate specific duties.
Protected attestations bind inputs, rule versions, engine version and ordered
output. Database leases/checkpoints support safe interruption/resume. Fact and rule
updates create revisions without modifying prior results.

## Verification

- The independent 120-entry synthetic suite matches 75 calculable / 45 unresolved
  lines, 50 monetary discrepancies, USD 4,375 potential overpayment and USD 600
  potential underpayment. These numbers are functionality expectations only.
- Actual bundled-worker verification uses isolated Auth/REST fixtures: signed
  dispatch, tenant filters, original retention, all 120 entries unresolved without
  approved coverage, checkpoint resume, and own-output execution proof. No real
  model, government fetch or database write is performed by that fixture test.
- Database tests exercise tenant isolation, denied member report/proof writes,
  denied tenant-owner legal approval, evidence requirements, worker-only leases,
  atomic proof/result commit, immutable results and revision invalidation. The
  remote administrative transaction rolled its synthetic fixtures back.
- A production-build website and isolated worker exercised actual Supabase Auth,
  original storage, duplicate reuse, two verified result versions, retained
  declarations after origin correction and CSV export in a separate verification
  workspace. With no approved historical bundles, all 120 lines remained
  unresolved. This verifies the real storage/execution path, not customer duties.
- Browser verification covers upload, confirmed mapping, validation counts, saved
  results, finding detail, original/applied origin, review controls and chat handoff.
  Desktop and 390px mobile views, the unchanged-rule refresh message and the
  contextual return from chat were checked against the final production build.

## Final checks and release state

- TypeScript and the isolated webpack production build pass. The audit tests pass
  19/19, the existing chat/file intake tests pass 70/70, and the previously run
  general regression suite passes 930/930. The final bundled worker passes its
  offline signed-dispatch, execution-proof and checkpoint-resume verification.
- All three audit migrations are applied. The administrative rollback test passes;
  no rollback fixtures remain. No historical bundles are approved. Remote SQL lint
  reports no errors and two pre-existing type warnings in unrelated functions.
- The compatible [checking-worker preview](https://cante-check-worker-p4bj55ib0-jeremygautamas-projects.vercel.app)
  is deployed. Local connector settings and the website's future-build Vercel
  connector settings point to it; dispatch secrets are unchanged. The hosted
  preview was not probed as an execution test. Real storage/execution verification
  used an isolated local website/worker with actual Supabase, as described above.
- The main website has not been redeployed or promoted. No commit, push or
  schedule was created. A transient unintended website preview was removed;
  it did not change production.
- The browser was signed out; the isolated verification identity is disabled with
  zero remaining sessions, and temporary credentials were removed. Immutable test
  originals/results remain in its separate workspace. Temporary servers and the
  isolated PostgreSQL instance were stopped; the existing development server was
  preserved. Unrelated working-tree changes remain untouched.

## Limits

Independent broker/legal validation and curated real historical coverage are
still required. Existing customer products/checks were not modified or used as
fixtures. No schedules, delivery, automatic filings or refund submissions were
enabled. The website changes are not a production release until deployed.

Operational contract: [historical audit runbook](../operations/historical-audits.md).


## Local approval-free workflow verification

Added `/audit-test`, available only during local development. It uses the existing
Audits screens, server-side importer, historical engine and CSV writer with the
labelled 120-entry fixtures. Fictional drafts execute without approval; unapproved
real rules remain blocked. No database writes, customer data, provider calls,
new credentials, migrations, schedules or deployments were needed for this test.

Browser verification: upload → confirm mapping/facts → validate (110 valid, 10
invalid input lines retained) → run → view 75 calculable / 45 unresolved lines,
50 calculated differences, USD 4,375 gross potential overpayment and USD 600 gross
potential underpayment → inspect the 5% + 25% calculation → record a review →
export CSV. The downloaded report contains all 120 entries, the same independent
totals, its recorded review and synthetic labels on every row. Negative numerical
differences now export as numbers while formula-like text remains escaped. The
390px mobile view has no visible horizontal overflow outside its scrollable table.

The audit suite now passes 24 tests, including actual endpoint gates for production
and hosted development, byte/origin rejection, independent per-entry expectations,
reviewed origin recalculation and protection against inferred fixture facts. The
bundled worker's existing signed-dispatch/proof/resume test passes unchanged.
TypeScript and the isolated production build pass. These are functionality results;
no real historical rate or legal approval is established by them.
