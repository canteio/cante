# GitHub readiness review — October 19, 2026

**Verdict: do not publish the entire working tree yet.** No credentials were
found by the scans below, but the full test suite has one failure, dependencies need security updates and the proposed
public source still includes competitor strategy notes the operator previously
wanted removed. The interview-name cleanup below has since been completed.
Publishing source and approving a
production deployment are separate decisions.

This review did not stage, commit, push, deploy, alter credentials, or change
application code. The branch is `dev`; before this report there were 61 changed
tracked paths, 145 untracked files, and no staged changes. A blanket `git add .`
would combine several sessions' work and local test output.

## High — dependency security findings

### 1. NEXT-SUPPLY-001: locked dependencies have published advisories

Locations: `package.json:38`; `package-lock.json:2733`, `:3055`, `:3105`, `:3695`.

The fresh npm registry audit reports four high-severity affected packages and no
critical findings:

| Package | Locked version | Reported patched version |
| --- | --- | --- |
| next | 16.3.6 | 16.3.8 |
| sharp | 0.35.4 | 0.35.5 |
| source-map-js | 1.2.1 | 1.2.2 |
| undici | 6.28.0 | 6.28.1 |

These are dependency findings, **not four demonstrated exploits in Cante**.
Exploitability depends on enabled features and deployment. For example, the
[Next.js image SSRF advisory](https://github.com/advisories/GHSA-cjq9-62q9-8jv4)
explicitly excludes apps without `images.remotePatterns`; this checkout's
`next.config.ts` has none. Other audit entries cover cache/metadata/dev-server
paths. The [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w),
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), and
[undici advisories](https://github.com/advisories/GHSA-3wwx-pv8p-q78v) identify
additional affected code in the installed dependency graph.

Fix: update compatible dependencies and the lockfile, rerun the audit, tests and
production build. Review changes rather than running an unexamined force update.
Pushing these versions does not itself expose credentials, but they should not
be presented as a cleared production release.

## Medium — public-source privacy and requested cleanup

### 2. PUB-PRIVACY-001: competitor strategy remains; interview identity resolved

Locations: `scripts/prepare-pilot-stacking.ts:1`; `docs/plans/mission-one.md:443`,
`:463`, `:473`, `:478`; `docs/plans/competitive-roadmap.md:30`;
`docs/archive/business-handoff.md:89`.

The initial review found an interview participant's name in a script filename,
comment, plan and CSS comment. Follow-up cleanup renamed the script to
`scripts/prepare-pilot-stacking.ts`, anonymized those references and updated links.
A follow-up scan found no remaining references to the requested person or company
in current tracked or eligible untracked text files and filenames.

Competitor analysis and explicit copying guidance remain in the newly organized
docs. Archiving a document does not make it
private when that archive is committed to a public repository.

The current `CLAUDE.md` passed the targeted name check. These remaining references
are elsewhere. Public manufacturer catalogue research is not evidence of a secret
customer ledger; this review does not classify public product names as credentials.

Remaining fix: remove or keep competitor strategy outside the public repository according to the operator's
existing direction. Review the selected commit diff before publishing. Removing
current text does not scrub prior Git history; this review did not certify the
history as free of all personal or business references.

## Low — commit hygiene

### 3. PUB-ARTIFACT-001: temporary output is eligible for accidental staging

Locations: `.gitignore:35`; `output/chat-check/check-concise.ts:1`;
`output/chat-check/concise-result.json:1`.

Ignore rules cover selected output subdirectories, not the whole output tree.
The chat test script and generated response are untracked and eligible for
`git add .`. Their inspected contents describe a test fixture; no real customer
ledger or token was found. This is unnecessary public test debris, not a confirmed
credential leak. The script can also make a paid model request when executed.

Fix: keep temporary chat-test output local or deliberately move any useful test
into the maintained test suite. Preserve the intended vector asset separately.
The largest eligible file is a public-research CSV of about 17.3 MB; no candidate
file exceeded GitHub's 100 MB per-file threshold.

## Deployment condition — existing demo authentication

### 4. NEXT-AUTH-001: production must not silently default to demo mode

Locations: `lib/auth/config.ts:1–7`; `middleware.ts:84–87`;
`app/api/demo-login/route.ts:4–5`; `envexample:7`.

The auth-mode selector defaults to `demo`, which accepts a constant demo cookie.
That is a local demonstration convention, not a production authentication boundary.
The documented production configuration explicitly selects Supabase authentication.
This review did not verify the currently deployed environment and does not claim
the production app is bypassable. The new live-check/history handlers additionally
require a verified workspace and use authenticated Supabase clients/RLS.

Before deployment, enforce Supabase mode in production or make production startup
fail when it is missing; retain demo mode only where deliberately intended.

## Secret scan and safeguards checked

- Scanned 588 existing tracked/eligible untracked files for private keys, common
  provider/GitHub/cloud token formats, JWTs and credential-bearing database URLs.
- Compared five locally configured non-public secret values against candidate
  files and all 1,607 reachable historical Git blobs without printing the values.
- Scanned reachable historical blobs for private keys and selected token formats.
  No configured-secret matches or historical pattern matches were found.
- The three candidate token-like matches were product URL slugs, not API keys.
- Inspected the two compressed official-source fixtures after decompression;
  neither matched the selected secret patterns. Neither is a tenant export.
- No `.env` paths appeared in the targeted environment-file history query.
  Environment files, raw captures, local databases and browser auth artifacts are
  ignored. Ignore rules do not protect a file that was already committed.
- New history endpoints enforce workspace identity, explicit tenant filters,
  viewer write restrictions, bounded input and `no-store` responses. Source export
  checks stored hashes and bounds gzip expansion. Historical government fetches
  allowlist HTTPS hosts and reject redirects. These checks are not a full pentest.

Pattern scanning cannot establish that every possible secret or personal detail is
absent, and unreachable Git objects were not scanned.

## Release correctness

### 5. RELEASE-TEST-001: full suite is not green

Location: `lib/tariff/section301-live.test.ts:48`.

Fresh `npm test`: **921 passed, 1 failed, 922 total**. The live filament-stack
test expects a Section 301 component name matching `/List 2/`, but the current
component is named `China Section 301 · 9903.88.02`. This observed failure is a
label/assertion mismatch, not proof of incorrect duty arithmetic. Resolve the
intended label contract and rerun the affected test and full suite before claiming
release verification; do not silently drop the assertion to make the suite green.

## Verification

- Fresh `git diff --check`: passed.
- Fresh `npx tsc --noEmit`: passed.
- Fresh focused tariff/history/archive tests: **36 passed, 0 failed**.
- Fresh full `npm test`: **921 passed, 1 failed**; see finding 5.
- The previous implementation session completed a production build and isolated
  authenticated browser/export checks; no new production build was run for this
  read-only review. Neither those checks nor this report guarantees complete legal
  coverage or validates a real customer's customs ledger.

After cleanup and dependency fixes, review and commit a deliberate set of files,
rerun verification, and then assess that exact commit for push/deployment.
