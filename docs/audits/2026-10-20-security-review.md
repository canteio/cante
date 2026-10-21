# Security review — October 20, 2026

**Follow-up status:** finding 1 (global rule authority) is fixed in the applied
database and local API. Finding 2 is contained by withholding unverified saved
results from trusted chat/baselines; independent worker attestation is still not
connected. Findings 3–5 have dependency, distributed admission/storage and early
upload-intake fixes. The application changes are not deployed. Do not describe an
older hosted build as protected by these local reader/HTTP guards, or describe
this as a full security clearance. [Implementation and verification](2026-10-20-resource-and-report-security.md).

Scope: current chat upload/refresh, tariff archives and review permissions,
authentication middleware, upload processing, rendering, repository secrets and
installed dependencies. This is not a full external penetration test. No production
application configuration, customer records, legal rules or credentials were
changed. No commit, push, deployment or paid model request was made.

## High

### 1. Tenant owner/admin grants global tariff-review authority — fixed

Rule: NEXT-AUTH-001 / tenant authorization boundary.

Locations:

- `supabase/migrations/20261012005017_stacking_authenticated_review.sql:7`,
  `:34–38`, `:43–44`.
- `supabase/migrations/20261011183153_stacking_rule_authoring.sql:94`, `:143–145`.
- `lib/tariff/stacking-rules.ts:198–201`.
- `app/api/tariff/stacking-rules/route.ts`: GET/POST role checks.

**Evidence:** the authenticated review RPCs use SECURITY DEFINER and accept anyone
who has `role in ('owner','admin')` in **any** `customer_users` membership. The
confirmation RPC forwards the selected draft to the global promotion function.
The resulting rules have no customer scope and the deterministic engine reads
them as shared confirmed rules. The HTTP route repeats the tenant-role check; it
does not establish a separate platform legal-review role.

Read-only inspection of the configured database confirmed both review RPCs are
installed as SECURITY DEFINER, executable by `authenticated`, with the tenant
owner/admin gate and no platform-curator gate. No rule was approved/rejected as a
test.

**Impact:** an authenticated owner/admin of one customer workspace can approve or
reject existing shared drafts affecting other workspaces. Existing draft scope,
condition and conflict checks still constrain promotion; this is not a claim that
the caller can arbitrarily edit every tariff or access arbitrary customer CSVs.
The escalation is from tenant administrator to shared legal-rule reviewer.

**Fix:** reserve global approval for separately provisioned platform curators in
trusted, non-user-editable authorization data. Enforce it in the database RPCs as
well as the route. If customers require private overrides, scope those rules to
their tenant and change engine selection accordingly. Do not authorize from
user-editable JWT metadata or fix this by exposing a service key.

**Mitigation:** keep global review restricted to trusted internal curators until
the boundary is implemented. A one-workspace/internal pilot reduces exposure but
does not make the multi-tenant policy correct. This predates the news flow.

**October 20 follow-up:** applied `20261021015446_platform_tariff_reviewers.sql`.
All shared review/promotion/retry gates now consult an explicit private reviewer
list; tenant roles and JWT metadata confer no authority. The list is empty and
customer/worker accounts cannot insert appointments. API/page gates match the
caller-bound database capability, failing closed on missing permission/config.
Transactional tests cover two tenants, appointment, promotion/rejection, metadata
spoofing and revocation; synthetic writes roll back. No real reviewer was enrolled.
See [implementation and verification](2026-10-20-platform-rule-authorization.md).
Existing shared rules were not retrospectively re-approved by this change.

### 2. Members can author completed reports that chat treats as computed baselines — trust path contained

Rule: trusted-computation integrity / NEXT-AUTH-001.

Locations:

- `supabase/migrations/20261018050226_tariff_check_archive.sql:59–67`.
- `supabase/migrations/20261019033002_tariff_historical_source_evidence.sql:12–16`,
  `:21–30`, `:34–35`.
- `lib/tariff/business-impact-store.ts:129–131`.
- `app/api/chat/csv-check.ts`: `compareSavedChecks`, `recheckLatestChatCsv`.

**Evidence:** ordinary authenticated members can insert their own check record,
source bodies and terminal events. `complete_tariff_check` also accepts their
`report_text` object and source array directly. It checks tenant/actor identity,
sizes and hashes, but does not establish that the report came from Cante's engine
or that a supplied body was actually downloaded from its government URL. An empty
source array is allowed. The generated hashes cover caller-chosen content.

The archive reader verifies those hashes and returns the completed payload as a
`LiveCheckResult`. The new refresh flow uses that result as its previous numerical
baseline. Read-only database inspection confirmed authenticated execution of the
current invoker RPC. Its tenant and actor checks are real; they do not attest to
computation provenance.

**Local proof:** an in-memory fixture with caller-authored report/event hashes was
accepted by the actual archive reader. The actual comparison function reported a
-$975 difference against that fabricated baseline. No database report was forged,
no government fetch ran, and the numbers were a security fixture, not tariff law.

**Impact:** a malicious or compromised member can plant false computed results or
government-looking evidence inside their own shared workspace, influencing chat
answers and later duty-change figures. This does **not** demonstrate cross-tenant
access, actor/timestamp forgery or modification of an existing immutable row.
Append-only history and hashes protect retained content; they do not prove the
original content was generated by the trusted engine.

**Fix:** separate member-supplied inputs/notes from trusted computation outputs.
Require a verifiable execution attestation bound to check ID, input/facts, report,
engine version and source evidence, issued by a trusted worker, before using a
saved report as an authoritative baseline. Restrict authoritative completion to
that execution boundary; also address direct terminal-event inserts. Keep
worker/admin credentials out of the browser and hosted customer app.

**Mitigation:** label existing archives as workspace-authored evidence and withhold
trusted baseline comparisons unless provenance can be established. The current
fresh engine computation remains deterministic; the vulnerability is trusting a
caller-writable previous result, not arithmetic inside the engine.

**October 20 follow-up:** a protected, append-only trusted-worker attestation must
match check/tenant/input/terminal hashes before the archive reader returns a
`verifiedResult`. Chat uses only that field for saved computed context and duty
baselines. Unverified totals are hidden in saved-result UI; originals/raw exports
remain labelled workspace records. Members cannot self-attest. No existing record
is auto-trusted, and no verifier worker was silently connected. This contains the
forged-baseline path by withholding it; it does not manufacture provenance for old
reports. Hosted protection requires deploying the changed reader.

### 3. Four installed packages had high-severity dependency findings — fixed locally

Rule: NEXT-SUPPLY-001 / REACT-SUPPLY-001.

Locations: `package-lock.json:2734`, `:3056`, `:3106`, `:3696`.

Fresh `npm audit` reports four high-severity affected packages, zero critical:

| Package | Locked | Reported patched version |
| --- | --- | --- |
| next | 16.3.6 | 16.3.8 |
| sharp | 0.35.4 | 0.35.5 |
| source-map-js | 1.2.1 | 1.2.2 |
| undici | 6.28.0 | 6.28.1 |

These are affected-package findings, not four proven Cante exploits. Reachability
depends on enabled features and hosting. For example, the
[Next.js image SSRF advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4)
does not affect apps without `images.remotePatterns`; this checkout has none.
Other returned advisories concern cache, metadata and development-server paths.
See also [sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and
[undici](https://github.com/advisories/GHSA-3wwx-pv8p-q78v).

**Fix:** update compatible dependencies and lockfile, rerun the audit and relevant
tests/build. Avoid an unreviewed force update.

**October 20 follow-up:** updated the declared Next.js minimum and lockfile to
16.3.8, sharp to 0.35.5 (including its native/libvips packages), source-map-js to
1.2.2 and undici to 6.29.1 within existing dependency ranges. No forced upgrade,
new direct dependency or override was needed. Installed packages match the lockfile;
a fresh npm audit reports zero vulnerabilities. Sharp SVG-to-PNG conversion and
TypeScript passed, as did all 922 existing tests, 92 focused
chat/archive/live-check/history/remedy tests and an isolated production webpack
build. The build retained middleware/Edge
runtime warnings; it was not run over the user's active development output.
No deployment was performed. The existing development server was preserved and
still runs its previously loaded Next.js version until restarted. This resolves
finding 3 for the updated checkout, not findings 1, 2, 4 or 5.

## Medium

### 4. Expensive authenticated operations lack application quotas — admission/storage budgets added

Locations: `app/api/chat/route.ts:394–428`; `app/api/tariff/live-check/route.ts`;
`lib/llm/api.ts:95–114`; `middleware.ts`.

The application has per-request payload and timeout limits but no visible
per-user/workspace request rate, concurrency, archive-storage or model-spend quota.
A local test submitted twelve parallel requests to the actual chat handler with
mocked dependencies: all returned 200 and invoked twelve refresh operations.
No real traffic, model spend, database write or load test was performed.

**Impact:** a valid/compromised account can fan out costly official-source/PDF
fetches, CPU work, archive writes and, for ordinary chat, paid model calls. Direct
member archive writes also need consideration; route-only limits are bypassable
through the Data API. Authentication and timeouts alone do not cap aggregate cost.

**Fix:** add enforced per-user/workspace rate and concurrency limits, storage and
model budgets, with 429/Retry-After handling. Verify edge/WAF protections too.
External protections may exist; they were not visible or verified in this review.

**October 20 follow-up:** private, transactional counters and leases enforce shared
per-account/workspace hour/day/concurrency budgets across paid/expensive endpoints.
429 includes Retry-After; missing quota storage fails closed. Direct live-archive
inserts are capped at 256 MiB/5,000 rows daily and 1 GiB retained logical bytes.
These operation budgets bound admitted work, not a dollar-denominated provider
invoice; operator worker/CLI workloads and provider billing settings remain
separate. Applied DB migration plus actual-helper/database regressions are recorded
in the follow-up audit. HTTP enforcement awaits application deployment.

### 5. File size rejection occurs after multipart/body allocation — early byte caps added

Rule: NEXT-FILES-001.

Locations: `app/api/files/extract/route.ts:24`, `:35–39`;
`lib/documents/extract-file.ts:216–221`.

`request.formData()` parses/buffers the multipart request before the CSV limit is
checked. Other file types call `file.arrayBuffer()` before the extractor enforces
the 15 MiB limit. A local synthetic 20 MiB PDF probe confirmed arrayBuffer was
called before the route returned 400 for excessive size.

**Impact:** without a strict upstream body limit, oversized/multipart requests can
consume memory before rejection, multiplied by concurrent requests. A platform
body limit can mitigate this; its deployed value was not verified. This is not
evidence of a remote file-read or upload-execution vulnerability.

**Fix:** bound incoming multipart bytes while reading, enforce a matching upstream
limit, and reject known oversized files before `arrayBuffer()` as defense in depth.
Do not rely solely on Content-Length, filename extension or a client-side check.

**October 20 follow-up:** actual bytes are counted before concatenation or
multipart/JSON parsing, regardless of Content-Length. Multipart intake has a
15 MiB + 64 KiB envelope; per-file limits are checked before arrayBuffer().
Requests are admitted before buffering and aborted intake cancels its reader.
This is bounded buffering rather than a streaming per-part parser; upstream
platform limits were not reconfigured. Tests cover missing/forged lengths and
oversized files with zero arrayBuffer calls. HTTP changes are not deployed.

## Deployment and account notes

- **Conditional auth risk:** `lib/auth/config.ts:1–7` defaults to demo mode and
  `middleware.ts:84–87` accepts its constant demo cookie. Production configuration
  must fail closed rather than silently selecting this mode. New history/check
  handlers additionally verify Supabase workspace identity. This review did not
  establish that the live production app uses demo auth or is bypassable.
- The current Supabase security advisor reports the two authenticated-executable
  SECURITY DEFINER review functions and **disabled leaked-password protection**.
  Enable leaked-password protection where supported. No Auth setting was changed.

## Safeguards and verification

- No configured secrets or selected high-confidence token/private-key patterns
  matched in **593 current Git-eligible files**, including decompressed fixtures;
  five configured non-public secret values were compared without printing them.
  This scan is not proof that every possible secret is absent. Git history was
  not rescanned in this review; the October 19 readiness report records that scan.
- New archive/check paths verify workspace identity, restrict viewers, apply tenant
  filters and use authenticated clients. History exports are no-store, validate
  UUIDs, verify hashes and bound decompression. No cross-tenant CSV-read bypass was
  identified in those inspected paths.
- Historical-government fetches allowlist HTTPS hosts, reject credentials and
  redirects, and enforce response budgets/timeouts. No new user-controlled backend
  URL fetch was found in the reviewed chat/check path.
- Markdown rendering has no raw-HTML plugin or unsafe HTML sink in the inspected
  chat component. CSP, frame denial, nosniff and referrer headers exist. Hosted
  chat selects the API adapter rather than a local CLI. These observations are
  not a full browser XSS or prompt-injection evaluation.
- Fresh upload/recheck/archive tests: **63 passed**. Fresh TypeScript check: passed.
  These tests do not invalidate findings 1–5.
- Read-only live function metadata and security advisors were inspected. Privileged
  review functions were **not executed**. All behavioral security probes used local
  fixtures; no real customer or shared legal record was mutated.
- Reproduction probe and logs remain local/ignored. No application security fix
  was silently applied during this requested review.

Remaining: deploy the reviewed application fixes, connect an independently verified
trusted-worker attestation path before restoring saved numerical comparisons, and
verify production billing/WAF/Auth configuration. Preserve the dated evidence above.
