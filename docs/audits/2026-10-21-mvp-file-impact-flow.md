# File → fresh check → product costs — October 21, 2026

The dashboard, direct file upload and chat now share the archived live-check
execution path. The isolated Vercel worker and website preview are deployed. The existing
production website was not promoted or changed. No schedule, delivery channel
or real-customer import was activated.

## What changed

- The dashboard check button refreshes the latest immutable uploaded CSV and its
  explicit confirmations. It no longer requires a service key in the hosted app,
  a separate impact run, or the legacy delivery/recalculation path. Missing,
  invalid or unreadable latest files are not replaced with older files or samples.
- A shared report shows each SKU/HTS/origin, combined duty, comparable cost
  difference, next action, component explanations and official-source links.
  Changed legal-text matches remain review leads. A numerical duty difference
  does not independently establish legal applicability.
- Comparisons use only worker-attested saved baselines or fresh trusted
  in-process results. Identical products, values, quantities, qualifications and
  basis are required. Individually comparable rows remain visible in a partial
  portfolio; the overall difference remains null. Before/after evidence links
  retain the selected baseline identity.
- A signed dispatch connects the hosted request path to a separate trusted
  Next.js worker. The hosted app sends check/workspace IDs and the authenticated
  session to an operator-configured URL. The worker checks signature freshness,
  verifies the user with Supabase Auth and membership, reads immutable originals,
  and runs its own official fetches and deterministic calculations.
- The worker saves using the user's RLS-scoped client, compares the committed
  report and source metadata to its own output, then inserts the protected
  execution attestation using its worker-only service client. It never approves
  a member-authored completed report. Failed/missing proofs cannot yield a
  verified completion. A normal website deployment rejects the endpoint. The isolated Vercel worker
  requires both an explicit trusted-worker flag and deployment role. Dispatch is behind the existing shared database
  admission guard. Cancellation, failed writes and incomplete streams remain
  visible failures; no background delivery or model is used.
- China exclusion-note matching now uses country of origin as well as HTS.
  Candidate identities retain SKU, HTS and origin so one SKU from different
  countries does not acquire the other country’s review lead.
- Historical quantities now sum in the same unit rather than being discarded.
  Missing quantities stay missing; conflicting units or qualifications require
  separate inputs. Group rounding is still disclosed, not entry-line rounding.
- Explicit reviewed USMCA decisions and their supporting details now reach both
  the published base-duty quote and stacking calculator. Origin alone cannot
  enable a preference. Unsupported uploaded exemption/programme claims fail with
  a specific reason rather than being silently ignored.

No new tariff law, legal approval, other-sector Section 232 compiler, AD/CVD rate
or conditional-exclusion eligibility was invented. Existing unsupported cases
remain unresolved. This improves the supported workflow; it does not establish
complete legal coverage.

## Verification

- Existing suite: 930 tests passed. TypeScript and isolated production webpack
  build passed. Existing middleware deprecation/Edge-runtime warnings remain.
- Actual handler fixtures cover signed worker execution, hosted/foreign/viewer
  rejection, expired/invalid signatures, completed-record replay rejection,
  report/source tampering, proof-write/fetch failure, latest-file dashboard
  refresh and missing/invalid latest-file refusal.
- Existing live-check, chat CSV, remedy and archive/history regression suites
  were rerun. Worker/database/browser fixtures are separate from live-source
  verification; no real customer records were created for them.
- One read-only live run used `public/examples/tariff-workflow-test.csv`: five
  labelled fictional products and explicit fictional qualification assumptions.
  All 26 official-source fetches succeeded; the current and previous revisions
  were compared, and the current release stayed `2026HTSRev21` throughout.
  Four complete products returned duties of $4,150, $5,900, $4,400 and $1,250
  on $10,000 each. A fifth bearing intentionally omitted metal weight and
  withheld its total. Portfolio total stayed null. This fixture had no direct
  product matches in the adjacent-revision comparison; it is not an all-clear.
  Retained evidence hashes and component sums were checked. Raw output remains
  under ignored `raw/tariff-workflow/`. No model calls or database writes occurred.
- A separate explicitly fictional amendment changed one China heading from
  25% to 30% in an isolated official-source fixture. The actual engine computed
  $4,150 → $4,650 and the report comparison produced the matching SKU's $500
  difference. This is arithmetic/workflow evidence, not a real regulatory event.

Reproduce fixtures with `npm run test:workflow`; run the read-only official-source
probe with `npm run verify:workflow`. The latter fetches live government sources
and must not be presented as a customer import or complete legal validation.

## Actual hosted-worker and database verification

A dedicated, clearly labelled fictional verification workspace and confirmed test
identity were created for this test. No real customer workspace, product catalogue
or company profile was used or modified. The website test process had no service,
model or delivery credentials. Its real authenticated upload dispatched to the
separate Vercel worker using the same code/configuration as the website preview.
The main website's existing Vercel deployment gate was not disabled or bypassed.

Two real checks used four fully specified fictional products from the public test
CSV, omitting its intentionally incomplete fifth row:

- The initial upload returned combined duties of $15,700 and saved a protected
  execution proof. Its first comparison baseline was unavailable, never zero.
  The archive index returned HTTP 403 from Vercel, so the initial historical
  comparison was unavailable. This original report was preserved unchanged.
- The next check was triggered through the dashboard using the same saved file.
  It reused the verified baseline, returned $15,700 and a numerical difference
  of $0.00 on identical inputs, with the explicit limited-coverage caveat.
- Historical PDF comparison was separated from optional archive-index/JSON
  discovery. The second hosted check fetched and verified both revision-identified
  official PDFs and compared notes 16, 20 and 52. It detected the real Note 20
  insertion for 8479.90.9591. That change is not a match to these four example
  products and was not converted into an invented financial obligation.
- The second report retained 15 successful source captures and the one failed
  archive-index capture. Historical base-duty/heading comparisons remained
  explicitly unavailable. Coverage flags and visible text prevent empty missing
  comparisons from becoming a no-change conclusion.
- Both reports were independently reopened through the authenticated archive
  reader with full evidence, verifying event/input hashes, retained source bytes
  and protected attestation bindings. The second report's baseline link matched
  the first. The original saved calculation reopened through the actual UI.
- Desktop/mobile production-build browser checks passed for the real returning
  check flow, saved reopening, $0.00 comparison, real old/new legal text, missing
  archive disclosure and mobile layout. The site process was local; the worker,
  official fetches, database writes and attestations were real hosted operations.
  Separate UI fixtures covered a positive $500 product change and missing facts.
  Only expected local Vercel Analytics 404/MIME warnings appeared.

`npm run build:check-worker` produces a roughly 3.5 MB standalone function.
`node scripts/verify-check-worker-bundle.mjs` exercises that exact artifact with
real parsers/engine, replayed retained official bytes, and isolated Auth/database
fixtures. The `--block-index` variant verifies that the actual PDF parser still
finds the real note insertion while preserving a mocked archive 403. Neither
bundle probe writes to the real database. Seventeen focused workflow tests pass.

A new Vercel worker project was provisioned. Its first bootstrap received a default
production alias automatically but had no execution credentials. The configured
worker used for verification is a separate preview deployment; website connector
settings were added only to Preview. No commit, push, production website
promotion, schedule or notification activation occurred.

## Remaining release and legal limits

The supported on-demand file → check → product costs/evidence → saved refresh
path has been exercised. The production website still needs an explicit release
and corresponding production connector/worker configuration. The website preview
retains Vercel's existing access protection.

The user chose public/fake data. No customer ledger or independently reviewed
broker expectations were supplied. Other Section 232 sectors, conditional
exclusions, AD/CVD and other unsupported legal cases remain unresolved; this work
must not be described as universal correct-duty coverage or a completed customer
monitoring service. Human review and missing shipment facts cannot be replaced
with invented defaults. Background schedules and delivery remain disabled. After verification, the task-created
fictional login was disabled and its refresh sessions revoked; immutable test
reports were retained. Only task-created browser sessions and test servers were
closed. The pre-existing development server was preserved.
