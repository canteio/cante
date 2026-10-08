### A. Executive Verdict

**PARTIALLY. The scheduling implementation is added, but the new cookie-free HTTP execution path is broken and can report success without recalculating a customer's portfolio.**

Reviewed `dev` commit `7f18d40` on October 8, 2026, comparing against audited commit `332172e`. Scope: all seven changed files, their unchanged recalculation/storage/auth dependencies, new route/Edge probes, full test rerun, build and typecheck. No implementation fixes or deployments performed.

This is a follow-up to [AUDIT_REVIEW.md](/Users/a/Desktop/cante/AUDIT_REVIEW.md), not a claim that every deployed system was re-audited. Core tariff engine, historical-import workflow, and HTS refresh implementation are unchanged between these commits.

Correction to the first report: its assertion that no customer notifications occurred was not supported. The subsequent test-fix commit identifies a real Telegram send from fixture tests. In this follow-up, Telegram credentials were explicitly blanked for the suite; route and Edge probes use synthetic clients/transports and do not invoke the real scheduled endpoint.

### B. Feature Audit

| Feature/change | Status | Evidence | Problem |
|---|---|---|---|
| Internal recalculation route authentication | COMPLETE for tested handler cases | [route.ts:44](/Users/a/Desktop/cante/app/api/internal/tariff-recalculate/route.ts:44); missing/wrong secret probes returned 401 before database access | Deployed routing/gateway not verified. |
| Cookie-free scheduled recalculation | BROKEN | [route.ts:53](/Users/a/Desktop/cante/app/api/internal/tariff-recalculate/route.ts:53), [recalculation:217](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.ts:217) | Service-client injection stops at `getImpactRun`; portfolio read switches to anonymous request client. |
| Aggregate scheduler outcome | BROKEN | [route.ts:62](/Users/a/Desktop/cante/app/api/internal/tariff-recalculate/route.ts:62) | Failed/skipped execution can still return HTTP 200; unreadable known run is counted as zero failures. |
| Edge authentication and trigger | PARTIAL | [Edge function:34](/Users/a/Desktop/cante/supabase/functions/tariff-impact-recalculate/index.ts:34); executable synthetic probe | Wrong secret rejects without fetch. Valid trigger forwards failure summary as successful response. Actual Deno deployment/gateway unverified. |
| Six-hour cron SQL | PARTIAL | [migration:43](/Users/a/Desktop/cante/supabase/migrations/202610090001_tariff_impact_recalculate_cron.sql:43) | Explicit schedule exists; URL/secret initially placeholders. Applied migration, real secrets, gateway configuration, and successful runs unverified. |
| Middleware bridge access | PARTIAL | [middleware.ts:39](/Users/a/Desktop/cante/middleware.ts:39) | Cookie-gate exemption enables scheduler access. Entire internal prefix is exempt, so every future route there must provide its own auth. No unauthenticated access to this handler was found. |
| Recalculation test notification isolation | COMPLETE for inspected changed calls | [recalculate-customer-impacts.test.ts:147](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.test.ts:147) | Explicit `env: {}` prevents those fixture calls inheriting production Telegram configuration. Suite-wide transport isolation is still preferable. |
| Test environment consistency | PARTIAL | [loader:18](/Users/a/Desktop/cante/lib/test-support/supabase-test-loader.mjs:18) | Bulk/provider tests now pass; loads real credentials into every child, increasing need for explicit transport isolation. |
| Checklist fixture isolation | COMPLETE for changed fixture | [checklist-request.test.ts:24](/Users/a/Desktop/cante/lib/checks/checklist-request.test.ts:24) | Tenant-specific fixture IDs replace a shared ID; relevant tests passed. |
| Tariff engine and historical auditing | unchanged | No diff in `stack.ts` or `business-impact.ts` | Previous critical calculation/coverage/data-model findings remain unresolved. |

### C. Critical Bugs and Risks

**1. [P1] Pass the trusted client through the portfolio read.**

The new route creates a service client and passes it into `recalculateTariffImpacts`. That client discovers candidates and selects a latest run ID. At [recalculate-customer-impacts.ts:217](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.ts:217), `getImpactRun(customerId, runId)` creates another client internally at [business-impact-store.ts:50](/Users/a/Desktop/cante/lib/tariff/business-impact-store.ts:50).

Inside a real Next.js request, `cookies()` is available. Consequently [server.ts:45](/Users/a/Desktop/cante/lib/supabase/server.ts:45) returns the request client, rather than the CLI service fallback. A cron request carries a shared-secret header, not a signed-in Supabase cookie. That request client is anonymous and cannot read tenant snapshots protected by authenticated membership RLS.

**Reproduction:** invoke the actual handler with a valid synthetic shared secret, a service client returning an existing fixture run, and an anonymous request client returning no tenant rows. The handler traverses the real recalculation function and real `getImpactRun`. It returns **200, `{customersEvaluated:1, eventsCreated:0, failures:0}`**, while logging `run_not_found` and “The most recent impact run could not be read.” The probe confirmed an anonymous-client query actually occurred. This is a dependency/auth-context reproduction with synthetic transport, not a claim of invoking the deployed route.

**Impact:** adding a recurring trigger does not make this execution path perform the intended work. Existing CLI tests replace the server adapter with a service-backed test client and therefore hide this distinction.

**2. [P1] Propagate incomplete/failed execution through both HTTP layers.**

At [route.ts:65](/Users/a/Desktop/cante/app/api/internal/tariff-recalculate/route.ts:65), only `skippedReason === "error"` contributes to failures. `run_not_found` and capacity skips are omitted. Even a real error result returns HTTP 200. [Edge line 58](/Users/a/Desktop/cante/supabase/functions/tariff-impact-recalculate/index.ts:58) only checks `response.ok`, then forwards HTTP 200.

**Reproductions:** controlled customer read failure returned **200 with `failures:1`** from the actual route. Running the transpiled actual Edge handler with an upstream response of that shape returned **200 with `failures:1`**. Thus HTTP success cannot establish successful recalculation. Delivery failures likewise remain outside the failure count. A summary in the body can disclose failure to a reader; it does not make automated success reporting correct.

**3. [P1] Scheduling still does not retry undelivered events.**

The unchanged [recalculation:287](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.ts:287) returns early when deduplication inserts no new event. Events are inserted before delivery, and failed sends remain unnotified. A later six-hour run with unchanged calculation will not retry them. This remains a source-proven defect from the first audit; no real send/failure was induced in this follow-up.

**4. Architecture/deployment constraint: hosted bridge requires a privileged database secret.**

[Route line 52](/Users/a/Desktop/cante/app/api/internal/tariff-recalculate/route.ts:52) calls `createServiceClient`, which requires `SUPABASE_SECRET_KEY` or its service-role equivalent at [service.ts:18](/Users/a/Desktop/cante/lib/supabase/service.ts:18). The standing repository instructions reserve that secret for the trusted worker and exclude it from Vercel. This bridge requires a changed deployment trust boundary or a worker-hosted execution endpoint. With only the currently documented publishable/session configuration, it fails. I did not inspect or change hosted secrets. Shared-secret authentication works in the tested cases; this finding is a deployment-policy mismatch, not a demonstrated secret leak.

**5. Operational limits remain unverified.**

The Edge wrapper has a 110-second fetch timeout; the route declares no explicit duration budget and processes customers synchronously. There is no durable job cursor or overlap lock in the new bridge. These are scale/cancellation risks, not demonstrated timeout incidents. The test suite contains no checked-in tests exercising the new route or Edge bridge; the temporary audit probes do.

### D. End-to-End Test Results

| Test | Expected | Actual |
|---|---|---|
| Full suite with Telegram credentials blanked | All tests pass without real delivery | **824 passed, 14 failed, 0 skipped**, 838 tests, 52.2 seconds |
| Internal handler, missing/wrong secret | 401, no database access | Passed both cases |
| Internal handler, valid secret, cookie-free request | Read existing portfolio with trusted identity | Anonymous read; skipped run; HTTP 200 and zero failures |
| Internal handler, customer database error | Observable failed execution | HTTP 200 with one failure |
| Edge handler, wrong secret | 401, no upstream call | Passed |
| Edge handler, upstream failure summary | Observable failed execution | HTTP 200 with one failure |
| TypeScript | Clean | Missing `@vercel/analytics/next` |
| Build | Clean | Same missing dependency; installed Next.js 15.1.6 |
| Diff of prior critical implementation files | Determine whether fixed | `stack.ts`, `business-impact.ts`, recalculation implementation, and HTS refresh unchanged |

The previously failing bulk-stack and provider-health tests now pass. Remaining failures are **13 discovery subprocess import failures** and **one real database fixture error, `JWT issued at future`**, now in a product-import test. This suggests an intermittent environment/auth fixture problem rather than an additional proven CSV product bug.

Logs/probes: [full suite](/tmp/cante-followup-tests.log), [typecheck](/tmp/cante-followup-tsc.log), [build](/tmp/cante-followup-build.log), [route probe](/tmp/cante-followup-route.cjs), [route results](/tmp/cante-followup-route.log), [Edge probe](/tmp/cante-followup-edge.cjs), [Edge results](/tmp/cante-followup-edge.log).

No deployed cron endpoint was called, no migration was applied, and no legal-rule ingestion was run. New schedule deployment and end-to-end production execution remain unverified. The complete two-dataset browser demonstration remains blocked by the earlier missing historical workflow and local dependency failure.

### E. Regulatory Accuracy and Reliability

This change adds invocation infrastructure, not new legal data or calculation behavior. It does not fix the earlier Section 232 combined-floor arithmetic, stale-rule coverage, outage fallback, origin qualification, historical rate selection, ignored portfolio claim fields, or partial HTS-refresh completion logic.

The improved bulk test result is useful evidence of consistent test configuration. It is not independent legal verification: the changed loader now supplies credentials to tests that previously could not query the reference store. No refreshed legal accuracy or successful production automation is inferred from that pass.

The six-hour schedule could improve timeliness once its client context and outcome reporting are fixed. The current implementation still cannot establish that all scheduled recalculations completed, all applicable rules were current, or all new events reached their destination.

### F. Missing MVP Requirements

**P0, unchanged:** correct and appropriately withheld tariff totals; relevant effective-dated rules and qualification facts; historical entry/paid-duty reconciliation; a runnable authenticated complete workflow.

**P1, this change:** trusted client throughout the HTTP worker path; accurate failure/skip reporting; delivery retry independent of event deduplication; verified schedule, secrets, gateway and execution evidence; documented hosting trust boundary; route/Edge regression tests using a real request-context distinction.

**P2:** durable batching/checkpoints for larger customer sets and protection against overlapping scheduled work. Do not create a second tariff engine or rebuild working ingestion/RLS components.

### G. Minimal Fix Plan

1. Keep one calculation implementation. Make the portfolio read explicitly use the trusted client supplied to this execution path; preserve normal session/RLS clients for user-facing requests.
2. Decide whether this bridge runs on the existing trusted worker or whether the hosted privilege policy is intentionally changed. Do not silently put a worker secret in Vercel.
3. Separate valid no-op states from incomplete reads, capacity skips, cancellation and failures. Propagate an actionable outcome through route and Edge instead of HTTP 200 for failed work.
4. Select/retry unnotified persisted events independently of whether recalculation creates a new event.
5. Add targeted tests for a valid cron header with no browser cookies, inaccessible known snapshots, partial customer failures, and failed-send retry. Preserve explicit test-delivery isolation.
6. Verify deployment with schedule/configuration metadata and successful execution logs, without treating checked-in SQL or comments as proof. Then return to the unchanged tariff and historical-data blockers.

### H. Final Demonstration

**The full MVP scenario still cannot be demonstrated honestly.** The new code adds a scheduler and an authenticated bridge, but the cookie-free route can skip a known portfolio and report success. Fixing that would enable execution; it would not correct tariff semantics, add historical paid-duty reconciliation, or establish production rule freshness.

The positive change is narrower: safer recalculation test fixtures and more consistent test environments, plus a concrete schedule implementation to validate. The new scheduling path needs correction before it can be called working automatic customer-impact monitoring.
