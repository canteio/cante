# Pilot workflow completion — October 22, 2026

This record separates implementation, verification and remaining legal coverage.
All new calculation examples and workspace probes use explicitly fictional entries.
No customer ledger has been supplied or validated.

## Historical estimates

At the user's explicit instruction to have Cante validate the sources, Audits now
have two distinct calculation paths. Existing platform-approved bundles remain
immutable and retain their actual human approval. A narrow deterministic source
compiler can also produce **Cante-validated estimates**. It never creates an
approval, reviewer appointment or legal/refund entitlement.

`app/api/tariff/references/historical-contract.ts` checks the original 2018 USTR
instrument (2018-17709) and retained consolidated Chapter 99 notes. Only legacy
Section 301 heading 9903.88.02, intersecting eight-digit classifications in both
original lists, and the retained 2023 Rev4a / 2024 Rev1 / Rev2 editions are supported.
The original instrument establishes August 23, 2018 and additive 25% treatment.
Coverage intervals are compiler validation intervals; publication availability is
not substituted for an original legal effective date. Exact statistical-code base
rates come from the pinned edition selected for the entry's availability window.
Other dates/editions, country regimes and unmodeled headings remain unresolved.

`app/api/audits/compiled-reference.ts` supplies the same audit arithmetic and stacking
resolver used by approved bundles. This path requires the explicit import declaration
about ordinary scope, no preferences/exclusions, AD/CVD, Section 232 or other extra
duties. It does not decide legal origin, classification or exclusion qualification.
Claims, conflicting evidence and missing scope withhold complete results. Evidence
backed corrections are dated and retained separately from original declarations.
Results, exports, pinned source hashes, facts and compiler version are reproducible.
Engine version is `historical-audit-v3`; v1/v2 reports remain readable.

The original action was retained as an additional global reference, not tenant data
and not an approved legal bundle. `scripts/backfill-tariff-references.ts` accepts
`--documents=2018-17709`; `--write` is required for reference capture.

Independent source check (`scripts/verify-historical-reference.ts`) uses a fictional
$1,000 motor entry under 8501.31.4000. Actual retained editions publish 4% base;
China adds 25%, giving $290. Vietnam ordinary treatment gives a $40 estimate only
under the declared legal-origin and scope assumptions. Eight hand-calculated
examples and six unresolved guards pass. These are not broker comparisons or
proof of comprehensive legal accuracy.

## Daily monitoring

Migration `20261022224156_daily_workspace_monitor.sql` adds tenant-scoped settings
and immutable in-app events. Owners/admins may opt their own workspace in. Nobody
is enabled by deployment or setup. No email, Telegram or launchd job is activated.
A Supabase Cron job dispatches one due workspace per five minutes to the separate
trusted worker; each successful workspace runs again after 24 hours. Failure retries
after an hour. The worker reads the same catalogue snapshot as the dashboard/chat,
not the older separate import-impact monitor. Current limit: 100 active products
per workspace, one scheduled check at a time; larger workspaces fail visibly.
This admission ceiling is a pilot bound, not an enterprise throughput claim.

The shared worker execution in `app/api/internal/tariff-live-check/execute.ts`
calculates, archives originals/evidence/terminal output, compares committed output
with its own result and issues a protected attestation. Daily completion requires
that proof. Failed sources are partial/failure; source headlines alone are review
leads, never a confirmed cost change. Events deduplicate semantic findings and open
the saved check on the existing dashboard. The dashboard keeps one daily toggle
beside its normal refresh status.

The scheduler's separate secret and worker URL are in Supabase Vault, outside hosted
website credentials. Claim/finish/begin RPCs are service-only. Leases are hidden from
members. Archive writes require either original member ownership or a live private
workspace/check lease. Every operation is tenant-filtered. SQL transaction tests
on the actual linked project verify foreign workspace denial, hidden lease fields,
service-only admission, duplicate claim denial, proof-before-success, immutable
terminals and preservation of the existing manual writer; all fixtures roll back.
Database advisors report intentional authenticated security-definer entry points
and the existing leaked-password-protection setting; no new index/RLS warning.

Official checking also retains the White House presidential-actions first page,
with a clearly stated title/date-filter and pagination limit, alongside Federal
Register and CBP CSMS. No listing is automatically promoted to law. A read-only
live-source probe calculated four supported fictional products, kept one deliberately
missing metal-weight case unresolved, established a stable revision and had zero
failed sources. It did not write customer records or call a model.

## Chat privacy

Private chat requests have no model-controlled web tools. Separate application
research receives fixed public topic strings only, with bounded reads from fixed
official hosts. Raw questions, catalogue data, documents and transcript text are not
sent to research endpoints. Abstracts and failed sources are disclosed. The model
still receives authorized private context to answer the question; that is separate
from public-source requests. Memory extraction explicitly disables web tools too.

The first live verification caught the memory-extraction omission, which was fixed
and given an actual-provider-request regression test. This is why a route-only
assertion was insufficient. The existing inert Markdown-image renderer remains.
Cross-tenant database/API tests are not a claim of prompt-injection immunity.

## Release verification

- Main regression suite: 931 passing, including the memory-only regression;
  six targeted memory/provider tests also pass.
- Focused workflow, reference, archive, CSV/chat, dashboard and Markdown suite:
  156 passing with the daily event test; privacy/daily subset: 68 passing.
- Bundled worker historical checkpoint/resume test: 120 entries retained;
  missing legal coverage stays unresolved. Daily worker secret/admission/idle test passes.
- TypeScript and isolated production build pass. The existing development server
  remains untouched.
- Deployment and fresh hosted acceptance results are recorded below when complete.

### Additional live acceptance findings

The first hosted upload exposed native Request private-field incompatibility in the
Vercel runtime. The admission guard now transfers public request fields and the
unread body stream rather than invoking the native Request copy constructor on a
runtime wrapper. Byte limits and disconnect leases remain intact. The reproduction
and 87 related request/dashboard/chat tests pass (88 total).

The next check reached real calculation but timed out while atomically archiving
about 22 MiB of government evidence. A direct authenticated REST reproduction
returned PostgreSQL `57014`; small transactional archive tests passed. Migration
`20261022231308_tariff_archive_execution_timeout.sql` gives only the two bounded
atomic archive writers a 45-second REST statement timeout. General roles keep
their existing eight-second timeout; byte, row, storage and tenant guards remain.

Live configured-model retests: 43 primary isolation/injection assertions and 34
public-research controls passed after memory extraction was fixed. Both the private
response and background memory requests had no web tools. Observed public-source
requests carried no private canaries; the own-workspace positive control succeeded.
These were local production-build requests with real Supabase and real hosted
model calls, not fresh hosted-site security tests or an immunity claim.

The full source-based 120-entry fixture passes its independent expected manifest:
100 calculated, 20 unresolved, 70 calculated discrepancies, $2,900 overpayment and
$2,700 underpayment. This remains fictional declared data using real retained
sources. The earlier entirely synthetic rules/120-entry fixture is separate.

### Completed hosted acceptance and final release

Final website Preview:
[private deployment URL omitted]

Final separate worker Preview:
[private deployment URL omitted]

The production website was not promoted. No commit or push was made. Browser tests
used an isolated fictional workspace and temporary Vercel automation access; cleanup
revokes that access and signs out/bans the test identity. No customer workspace was
seeded or enabled. The daily job remains available for explicit owner/admin opt-in.

Fresh hosted browser verification:

- Product CSV original saved, mapping confirmed, two fictional catalogue products
  persisted, real official sources fetched, amounts archived and worker-attested.
- The final **Check for changes** click compared a verified scheduled baseline on
  identical facts and displayed $0.00 difference. This is the tested fictional
  portfolio's actual repeated-source result, not a customer no-change claim.
- Historical CSV upload → mapping → validation → run → findings → detail → CSV
  export completed. All 120 downloaded entry amounts matched the independent
  manifest: 100 calculated, 20 unresolved, $2,900 potential overpayment, $2,700
  potential underpayment. Origin conflict, unavailable edition, missing HTS and
  exclusion claim cases stayed unresolved. Original values and citations remained.
- The final export does not mislabel compiler coverage windows as original legal
  effective/expiration dates. The original Section 301 start date stays distinct.
- Embedded dashboard chat named the same two saved SKUs/countries. The selected
  audit finding handed off to chat, which explained the $10 modeled discrepancy
  and requested entry/payment/qualification evidence without promising recovery.

The initial real Cron run exposed a database-context omission: the job saved a
protected but unresolved report because the shared rule readers had no worker
client binding. That original report/review event is retained, not rewritten.
The worker now binds its already-authorized service client to the shared rule
reader context, after tenant admission; catalogue/archive queries remain tenant
filtered. `verify-check-worker-bundle.mjs --daily` reproduced five null amounts
before the fix and passes afterward with four independently expected supported
amounts plus one deliberately missing-weight null. The manual bundled path,
120-entry historical checkpoint/resume path and scheduler authentication/idle
path also pass. No model or real database was used in those bundle replays.

The corrected real daily execution completed on October 22 at 23:28:55 UTC with a
protected proof: $4,150 and $1,650 on the two fictional $10,000 annual-value products,
$5,800 total, zero unresolved products. This matched the real manual check. The
first Cron invocation and a single authorized retest both used Supabase dispatch
and Vault credentials; the final dashboard showed the successful timestamp.
The subsequent final button check displayed the genuine $0 comparison.

Screenshots and temporary private diagnostics stay in ignored/local output, not
tracked public assets. The report is reproducible from the retained originals,
source/rule versions and expected fixtures. These results establish the tested
workflow, not comprehensive tariff coverage, real-customer accuracy or refunds.

Cleanup verified: zero enabled daily-test workspaces, zero sessions for the pilot
fixture identity, that identity banned, zero temporary Vercel automation tokens,
and original Vercel project protection retained. Production's connector setting
remains separate from Preview. Final idle database lease/isolation/manual-writer
test passed again with all SQL fixtures rolled back. The existing development
server was not restarted or disrupted.
