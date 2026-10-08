### A. Executive Verdict

**PARTIALLY. The requested two-dataset MVP is not complete, and its tariff totals are not sufficiently reliable for a customer-facing duty-audit pilot.**

Reviewed `dev` at commit `332172e` on October 7, 2026 (America/New_York). No implementation fixes, migrations, deployments, or commits were performed. Correction added October 8: the original assertion that no customer notifications occurred was not supported; the subsequent test-fix commit identifies a real Telegram send from fixture tests. See [the follow-up audit](/Users/a/Desktop/cante/AUDIT_FOLLOWUP.md) for the corrected test-isolation approach and current findings.

There is substantial working functionality: catalogue ingestion, strict tariff CSV parsing, duty-expression arithmetic, tenant-scoped persisted snapshots, official-source fetchers, coverage disclosures, and authenticated/RLS-protected operations. However, the annual portfolio calculator is not a historical-entry audit. It lacks paid-duty reconciliation and historical schedule selection, and live calculations reproduce an incorrect Section 232 combined-rate calculation. Automatic rule freshness and delivery also have material gaps.

Verification: `npm test` ran 838 tests: **822 passed, 16 failed, none skipped**. TypeScript and build failed on an absent local dependency. A local HTTP request returned 500. Component, API, and database integration tests are evidence of those individual paths; they do not prove the complete browser demonstration.

### B. Feature Audit

COMPLETE below describes the explicitly bounded feature that was tested, not the whole tariff product. PARTIAL includes deployment or browser behavior that remains unverified.

| Feature | Status | Evidence | Problem |
|---|---|---|---|
| Product catalogue CSV ingestion | COMPLETE | `importProductsCsv`, [products.ts](/Users/a/Desktop/cante/lib/catalogue/products.ts:225); catalogue/products tests passed | Handles aliases, per-row outcomes, duplicate SKUs, persistence, and lead-tier classifications. Uploaded codes are not legally validated classifications. |
| Historical imports dataset | MISSING | [business-impact.ts](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:7), [schema.ts](/Users/a/Desktop/cante/lib/db/schema.ts:1026) | Portfolio fields are annual value and supplied current rate. No structured entry/line identity, paid-duty ledger, or historical reconciliation workflow. Raw input retention does not implement these features. |
| Annual portfolio CSV validation | COMPLETE | `parseBusinessImpact`, [business-impact.ts](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:40); parser/route tests passed | Bounded to 500 rows and 2 MiB; invalid rows are retained as errors. Entry deduplication is outside its implemented contract. |
| Catalogue/portfolio linkage | PARTIAL | `createImpactRun`, [business-impact-store.ts](/Users/a/Desktop/cante/lib/tariff/business-impact-store.ts:12) | Exact tenant SKU/supplier-name linking works; missing or ambiguous links remain null. Calculation can still succeed without a linked product. |
| Saved impact runs and CSV exports | COMPLETE | [business-impact-store.ts](/Users/a/Desktop/cante/lib/tariff/business-impact-store.ts:36); business-impact RPC/route tests passed | Atomic storage, tenant constraints, immutable evidence, and spreadsheet formula protection tested. Upload retries create new snapshots; hash is not an idempotency key. |
| Current USITC base-rate retrieval | PARTIAL | `lookupTariff`, [rates.ts](/Users/a/Desktop/cante/lib/tariff/rates.ts:137); live requests succeeded | Correct rate inheritance is useful, but exact leaf existence and historical revision are not established. |
| Duty expression arithmetic | COMPLETE | `parseDutyRate`/`computeDuty`, [duty-expression.ts](/Users/a/Desktop/cante/lib/tariff/duty-expression.ts:58); tests and independent compound probe | Supports its documented ad valorem, specific, and compound forms; unknown expressions and missing units produce null. This is arithmetic, not legal applicability. |
| Country-based base-column selection | BROKEN | `quoteDuty`, [rates.ts](/Users/a/Desktop/cante/lib/tariff/rates.ts:277) | Defaults to Column 1 for all origins; stack never requests Column 2. |
| China Section 301 | PARTIAL | [section301.ts](/Users/a/Desktop/cante/lib/tariff/section301.ts:56), [stack.ts](/Users/a/Desktop/cante/lib/tariff/stack.ts:289) | Finite list-heading rate table and dated coverage snapshot; product exclusions, strategic-product measures, and full historical rates are incomplete. Unknown references generally remain unresolved. |
| Live Section 232 | BROKEN | [stack.ts](/Users/a/Desktop/cante/lib/tariff/stack.ts:378), [section232-live.ts](/Users/a/Desktop/cante/lib/tariff/section232-live.ts:59) | Annex III floor treated as additive; stale April rule store; UK reduction assumed from origin; failed lookup can produce a resolved incomplete total. |
| Section 338 Canada | PARTIAL | [section338.ts](/Users/a/Desktop/cante/lib/tariff/section338.ts:1) | Original annex coverage exists; later amendments/ban annex and exclusions have explicit limitations. No independent complete legal replay was achieved. |
| Other additional tariffs / Chapter 98–99 | PARTIAL | [stack.ts](/Users/a/Desktop/cante/lib/tariff/stack.ts:136) | No complete effective-dated measure registry; Section 122 historical window is absent. Uploaded Chapter 99 claims are context in portfolio runs. |
| Special-program qualification | PARTIAL | `resolveUsmcaQualification`, [stack.ts](/Users/a/Desktop/cante/lib/tariff/stack.ts:159) | Direct calculator demands caller-verified USMCA decision; does not establish origin qualification. Portfolio program/exclusion fields do not influence its calculation. |
| AD/CVD, forced labor, quota | PARTIAL | `adcvd.ts`, `uflpa.ts`, `quota-ledger.ts` and passing tests | Advisory scope leads/ledger features exist; no exporter-specific AD/CVD assessment in stacked total. Cannot interpret total as complete entry liability. |
| Document discrepancy audit | PARTIAL | [audit.ts](/Users/a/Desktop/cante/lib/documents/audit.ts:416); document tests passed | Prices classification mismatches with current base quotes, not entry-date paid-duty reconciliation. First candidate code/first matching code line can be selected. |
| Official-source regulatory fetch and evidence | PARTIAL | [run.ts](/Users/a/Desktop/cante/lib/checks/run.ts:102), `lib/sources/fetch.ts`; source tests passed | Real stored source/run evidence exists. Profile-gated fetch plus LLM judgment is not a validated tariff rule feed. |
| Seen-log, verdict coverage, before/after brief | PARTIAL | `coverage.ts`, `briefing.ts`, [run.ts](/Users/a/Desktop/cante/lib/checks/run.ts:299); related tests passed | Strong disclosures and bounded retry; model wording/applicability still require evidence review. Did not initiate a fresh paid/model check. |
| Rule ingestion and activation gate | PARTIAL | [ingest-section232-proclamation.ts](/Users/a/Desktop/cante/scripts/ingest-section232-proclamation.ts:454), [verify-section232-proposal.ts](/Users/a/Desktop/cante/scripts/verify-section232-proposal.ts:133) | Pending/approved state exists; second extraction corroborates annex rates, not every HTS row and condition. No verified recurring invocation. |
| Product impact from monitored finding | PARTIAL | [monitor-bridge.ts](/Users/a/Desktop/cante/lib/tariff/monitor-bridge.ts:9), [monitor-company-impact.ts](/Users/a/Desktop/cante/lib/tariff/monitor-company-impact.ts:195); tests passed | Code overlap is correctly a candidate. Deterministic before/after derivation requires a structured Section 232 component and matching document; other measures need review. |
| Impact recalculation and notifications | BROKEN | [recalculate-customer-impacts.ts](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.ts:287) | Failed deliveries are not retried for unchanged events; CLI can report success after delivery failure. Recurring execution unverified. |
| HTS recurring revision refresh | BROKEN | [index.ts](/Users/a/Desktop/cante/supabase/functions/hts-revision-check/index.ts:258), [cron migration](/Users/a/Desktop/cante/supabase/migrations/202610080002_hts_revision_cron.sql:34) | Partial publish prevents resume; placeholder URL/secret requires real configuration. Schedule/function deployment logs unavailable. |
| Dashboard and browser workflow | BROKEN | [layout.tsx](/Users/a/Desktop/cante/app/layout.tsx:3), [tariff page](/Users/a/Desktop/cante/app/tariff/page.tsx:8) | Current installation cannot render. UI code exposes useful run/source/evidence views but full browser QA is blocked. |
| Authentication, tenant isolation, RLS | PARTIAL | [server.ts](/Users/a/Desktop/cante/lib/supabase/server.ts:69), `middleware.ts`, tenant migrations; signed-in RPC isolation test passed | Tested snapshot ownership/viewer boundaries work. Comprehensive deployed-policy/advisor review unavailable; demo mode remains a configuration hazard. |
| Upload safety and scale | PARTIAL | [business-impact.ts](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:145), [extract-file.ts](/Users/a/Desktop/cante/lib/documents/extract-file.ts:64) | Tariff CSV is bounded; Office archive expansion and multipart allocation are not similarly bounded. Thousands of portfolio rows are explicitly rejected. |
| Supporting chat, memory, screening, suppliers, lanes, checklist, workqueue, BOM, classification retrieval | PARTIAL | Corresponding modules/routes/tests inspected; broad suite exercised them | Implemented supporting operations, not proof of historical-duty auditing. No complete browser/product acceptance verification. |
| Import manifest/recall monitor | PARTIAL | `pipelines/import-manifest/monitor`, `app/import-monitor`; tests passed | Shipment/recall leads are a separate workflow; do not confuse these records with customer import entries and paid duties. |

### C. Critical Bugs and Risks

1. **P0 — Incorrect combined-rate arithmetic (verified live code bug).** `computeStackedDuty` unconditionally adds the live rate at [stack.ts:380](/Users/a/Desktop/cante/lib/tariff/stack.ts:380), then sums it with base duty. Live USITC gives HTS 8483.60.80 a 2.8% base; the database maps it to Annex III at 15%. Germany, $10,000, October 7 returns **17.8%, $1,780, zero unresolved measures**. For the relevant 15% combined-duty treatment, the correct combined base/232 result is $1,500, subject to qualifying facts and other applicable measures. Adding 15 percentage points is not the specified operation. [CBP implementation guidance](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/41aa83d).

2. **P0 — Live Section 232 store is stale (verified data limitation).** The configured database has 1,593 rows, all accepted from `2026-06960`, effective April 6. CBP's June amendment adds classifications and reduces rates, effective June 8; it is absent. HTS 8427.10.40 currently returns April's 25% for Germany with no unresolved measure. Exact amended applicability must be established, rather than assuming the old annex remains sufficient. `lookupSection232Live` has no freshness boundary at [section232-live.ts:74](/Users/a/Desktop/cante/lib/tariff/section232-live.ts:74). [CBP June amendment guidance](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/41aa83d).

3. **P0 — Lookup failure becomes a confidently incomplete total (verified code bug).** [stack.ts:365](/Users/a/Desktop/cante/lib/tariff/stack.ts:365) writes a prose warning without adding an unresolved measure and falls back to static coverage. Controlled outage, HTS 7408.11.60.00, Germany, $10,000 produced base-only $260 using a synthetic 2.6% base, `unresolvedMeasures: []`. Real configured rules cover that copper code at 50%; a live healthy calculation returned $5,300 with the real 3% base. The outage fixture proves unsafe resolution, not a verified legal amount under every possible exception. Portfolio code accepts this as computed at [business-impact.ts:100](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:100).

4. **P0 — Historical imports are not audited (missing feature plus unsafe historical quoting).** [business-impact.ts:7](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:7) has no paid-duty/entry-line model. `quoteDuty` always reads today's HTS at [rates.ts:274](/Users/a/Desktop/cante/lib/tariff/rates.ts:274); `compareDuty` has no date/origin input. Some 301/232 historical gaps are withheld, but others receive a current base rate and finite total. Section 122's February 24–July 24, 2026 surcharge window is not implemented. A March 1 synthetic non-China/non-metal fixture returned only base duty, with no missing-measure disclosure. This establishes absent evaluation; it does not independently prove that the fixture has no exemption. [CBP Section 122 guidance](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/40b3b7b).

5. **P0 — Legally relevant origin facts are missing or ignored (verified code bug/data limitation).** `quoteDuty` always initializes Column 1; no country argument selects Column 2 at [rates.ts:277](/Users/a/Desktop/cante/lib/tariff/rates.ts:277). A Cuba fixture with published general 2.6% and Column 2 35% returned $260 rather than selecting Column 2. Also [stack.ts:379](/Users/a/Desktop/cante/lib/tariff/stack.ts:379) automatically applies UK reduced rates from `GB`; inputs do not establish the required metal-origin condition. These cases must resolve eligibility or withhold a legal total. [CBP guidance on origin-conditioned metal rates and Column 2 countries](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/41aa83d).

6. **P0 — Exclusions/program claims can be present but have no effect (verified implementation gap).** At [business-impact.ts:95](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:95), quantity, Chapter 99, exclusion ID, and program claim are explicitly context-only. Independent capture of calculator arguments confirmed their absence. The form advertises these fields at [business-impact-panel.tsx:196](/Users/a/Desktop/cante/components/tariff/business-impact-panel.tsx:196). Saving them is useful evidence, but a computed delta cannot imply the claimed exception was evaluated. Quantity-specific duties remain unresolved despite supplied quantity; exclusion-sensitive ad valorem rows can still look computed.

7. **P1 — HTS refresh cannot resume after partial publication (code-path proof).** `runIngestion` independently publishes chapters and stops for its time budget at [index.ts:194](/Users/a/Desktop/cante/supabase/functions/hts-revision-check/index.ts:194). Next invocation selects one newest row and returns “Up to date” if its revision matches at [index.ts:260](/Users/a/Desktop/cante/supabase/functions/hts-revision-check/index.ts:260). Publish chapter 01 of revision R2, leave chapter 02 at R1, rerun: newest row says R2, so remaining chapters never resume. Fetch/publication failures also return HTTP 200. This is a deterministic control-flow defect; no deployed Edge execution was claimed. Current inspected rows all have Rev20, so mixed revisions were not asserted as a present database state.

8. **P1 — Notification failures are permanently suppressed (code-path proof).** New events are inserted before Telegram delivery at [recalculate-customer-impacts.ts:277](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.ts:277). Fail the send, then rerun unchanged data: deduplication inserts nothing and [line 287](/Users/a/Desktop/cante/lib/tariff/recalculate-customer-impacts.ts:287) exits before delivery. Undelivered rows are not selected for retry. [CLI line 36](/Users/a/Desktop/cante/scripts/recalculate-tariff-impacts.ts:36) counts only `skippedReason === "error"`; a returned delivery failure exits zero. No real notification was sent during this audit.

9. **P1 — Duplicate uploads/rows inflate estimates (verified data-integrity gap).** Two identical $10,000 annual rows, baseline 30%, injected resolved rate 27.5%, yield **−$500**, versus −$250 for one row. [business-impact.ts:117](/Users/a/Desktop/cante/lib/tariff/business-impact.ts:117) sums both. Repeated legitimate entries require separate entry-line IDs; the current portfolio cannot distinguish them from accidental repeats. Snapshot hash at [business-impact-store.ts:36](/Users/a/Desktop/cante/lib/tariff/business-impact-store.ts:36) also does not prevent duplicate upload runs.

10. **P1 — Ancestor rate is mistaken for full-code validation (verified lookup behavior).** [rates.ts:199](/Users/a/Desktop/cante/lib/tariff/rates.ts:199) accepts prefix-compatible rows. Live lookup of 8501.10.40.99 returned the requested code with a 4.4% rate inherited from 8501.10.40; it did not establish an exact statistical leaf. A synthetic parent-only response also returns a quote. Inheritance should follow validation of the requested code/revision; a broad heading cannot establish exact additional-tariff coverage.

11. **P1 — Auto-approval does not verify applicability rows (source review).** [verify-section232-proposal.ts:133](/Users/a/Desktop/cante/scripts/verify-section232-proposal.ts:133) collapses stored data to one rate record per annex, checks annex-level rates, then sets verification/effective date across every pending row and approves. It does not independently corroborate every HTS-to-annex assignment, subheading qualifier, omitted row, or legal condition. The ingestion count guard permits substantial omissions. Two matching model rate summaries are not complete legal validation.

12. **P1 — Current checkout is not demonstrable (verified environment failure).** `npm ls` shows missing `@vercel/analytics` and Supabase CLI, Next 15.1.6 versus declared ^16.3.6, and Drizzle 0.38.4 versus ^0.45.3. [layout.tsx:3](/Users/a/Desktop/cante/app/layout.tsx:3) cannot import analytics. Build, TypeScript, and local page all fail. This is dependency-installation drift; it is not proof that a clean locked install has the same failure. No dependency repair was made.

13. **P1 — Office uploads lack expanded-size limits (security risk, source review).** [extract-file.ts:64](/Users/a/Desktop/cante/lib/documents/extract-file.ts:64) and line 131 synchronously inflate whole archives. The limit at [line 200](/Users/a/Desktop/cante/lib/documents/extract-file.ts:200) checks compressed bytes. Product upload reads `formData()` and `arrayBuffer()` before extraction validation. A compressed archive can consume far more memory/CPU than its accepted size. No destructive load test was run.

Additional architecture risk: [current_section232_rate SQL:18](/Users/a/Desktop/cante/supabase/migrations/202610071005_section232_effective_lookup.sql:18) selects the latest document globally, then searches only that document. That is safe only if each accepted document is a complete replacement schedule. A narrow amendment can erase unaffected prior coverage. No multi-document runtime example was present to verify this path.

### D. End-to-End Test Results

The requested full flow **did not pass**. Historical-entry upload/reconciliation is missing and local UI compilation fails. I did not substitute annual portfolio fixtures for the requested historical workflow or claim API tests as browser E2E.

| Executed test | Expected | Actual |
|---|---|---|
| Full `npm test` | All available checks pass | 822/838 passed; 16 failures in 53.6 seconds |
| `npx tsc --noEmit` | Clean typecheck | TS2307: missing analytics module |
| `npm run build` | Production build | Webpack missing analytics module; installed Next 15.1.6 |
| Local server + GET `/` on port 3007 | Rendered page | HTTP 500, same missing module |
| Product/catalogue integration tests | Parse, reject duplicate/missing SKU, persist | Passed relevant tests against temporary tenant fixtures |
| Missing HTS / missing origin probes | Row error, no fabricated delta | `Missing hts` / `Missing origin`, status error |
| Ordinary historical CSV (`entry_id,sku,hts,country,customs_value,paid_duty,entry_date`) | Audit entry duty | Rejected as missing portfolio fields; no audit result |
| Invalid CSV/header/body tests | Reject malformed structure, conflicts, oversized streams | Relevant tests passed; row errors persist for missing business fields |
| Duplicate portfolio rows | Identify repeats or require distinguishing identity | Both computed and aggregated; synthetic delta doubled |
| Repeated SKU / unmatched products | Preserve evidence and identify unmatched state | Snapshot linking leaves absent/ambiguous product null; tests verify this; no historical matching ledger |
| Specific/compound duty | Apply value and matching-unit quantity | Independent `4.4¢/kg + 8.5%`, $1,000 + 200 kg = **$93.80**; missing quantity/unit withheld |
| No delta / unresolved legal rule | Zero when resolved, null when unknown | Relevant injected-result tests passed: `no_change` and zero; unresolved portfolio total null |
| Before/after dates and source identity | Only show delta with established versions | Monitor impact tests passed for versioned fixtures; non-232 and missing prior versions need review |
| Annex III with live base + live stored rule | Correct combined treatment | 17.8%, $1,780; reproduced incorrect additive calculation |
| Live lookup outage | Unknown current applicability, totals withheld | Controlled outage returned base-only total with zero unresolved measures |
| Origin with general and Column 2 rates | Correct column | Cuba fixture used general rate |
| Quantity/exclusion/program forwarding | Use inputs or explicitly require legal review | Calculator received none of these portfolio fields |
| Signed-in Supabase ownership/atomicity test | Reject cross-tenant and viewer writes | Passed; immutable snapshots/foreign product and supplier rejection tested |
| Focused rerun of two failing test files | Reproducible outcomes | 10 passed / 2 failed: discovery module import and bulk component assertion |

Failure breakdown: **13** discovery subprocess tests fail with named-export/`GET is not a function` errors; **1** fixture creation fails `JWT issued at future`; **1** provider-health test expects a different error string; **1** bulk-stack test expects three components but receives two. See [classifications-openapi.test.ts](/Users/a/Desktop/cante/lib/catalogue/classifications-openapi.test.ts:1), [customers/openapi.test.ts](/Users/a/Desktop/cante/lib/customers/openapi.test.ts:94), and [stack-bulk-route.test.ts](/Users/a/Desktop/cante/lib/tariff/stack-bulk-route.test.ts:58). The bulk test's Supabase behavior changes with harness/environment, so it is not independent legal verification. Do not equate all 16 failures with 16 product defects.

Logs and independent probes are retained locally at [test log](/tmp/cante-audit-tests.log), [typecheck log](/tmp/cante-audit-tsc.log), [build log](/tmp/cante-audit-build.log), [probe script](/tmp/cante-audit-probes.cjs), [probe output](/tmp/cante-audit-probes.log), and [focused rerun](/tmp/cante-audit-retest.log).

### E. Regulatory Accuracy and Reliability

**Useful arithmetic does not yet establish a legally applicable total.** Base rates were fetched live from USITC: 8483.60.80 → 2.8%; 7408.11.60.00 → 3%; 8501.10.40.99 → inherited 4.4%, without exact-leaf validation. These are current quotes, not independently verified historical classifications. [USITC HTS](https://hts.usitc.gov/).

The critical Section 232 defects are treatment semantics and qualification, not just missing citations. The April proclamation exists and establishes a changed metal regime; it is not an invented source. [Official proclamation PDF](https://www.govinfo.gov/content/pkg/FR-2026-04-09/pdf/2026-06960.pdf). Its full annex text could not be repeatedly retrieved through the browser tool; I used live stored matches and the independently accessible CBP implementation guidance for the reproduced calculation findings. No claim of checking all 1,593 rows against the PDF is made.

Section 301 uses an explicitly dated July 28, 2026 coverage snapshot plus finite rate records. Exact 10-digit overrides and refusal to infer a parent's coverage from one child are positive safeguards. This still does not validate exclusions, every later modification, or every prior entry period. Section 338 has explicit amendment/ban uncertainty; I did not complete a line-by-line primary-source audit of its 554 original lines. AD/CVD remains advisory and should remain outside calculated totals until actual order scope and exporter rates are established.

**Automatic monitoring evidence:** the configured database contains 7 check runs and 196 source results. Latest successful fetch metadata is October 6, 2026, 1:42 p.m. EDT; latest completed check was 1:41–1:42 p.m. EDT that day, following two failed runs. That proves persisted executions, not unattended scheduling. HTS storage contains 20,418 rows at `2026HTSRev20`, across 97 populated chapters. It contains zero tariff impact events. Neither these counts nor comments prove deployed cron/function configuration or delivery.

The available Supabase connector exposes a different project from this checkout, so I did not inspect that unrelated project. Read-only aggregate evidence above came from the checkout's configured Supabase endpoint using its existing worker client. Deployment SQL, cron history, Edge logs, Vault configuration, hosted environment, and migration inventory remain unverified. No matching Cante/tariff/HTS LaunchAgent filename was found in this user's LaunchAgents directory; schedules elsewhere remain possible.

Source fetches and judgment coverage are tracked separately; URL/regulation identity deduplication and completion retry are useful existing mechanisms. Regulatory findings queue catalogue-code candidates. They do **not** automatically invoke proclamation ingestion/verification. HTS embedding refresh does not refresh Section 232 legal rules or the Section 301 snapshot. A code match is not a legal applicability determination.

Security review found real strengths: membership-derived tenancy, RLS role gates, immutable snapshots, SQL ownership/foreign-key checks, fixed public errors in tariff endpoints, streaming upload bounds, and formula-safe export. The signed-in RPC test proves a meaningful subset of boundaries. It does not prove every deployed table/policy. Many operational tests replace the request client with a service client, so their passing results alone cannot establish RLS. Demo-cookie mode is intentionally weak and must not be the customer deployment gate. The hosted model receives retrieved excerpts rather than database secrets; local CLI write denial/scratch-directory protections remain present. No secret values were included in this report.

Architecture is viable for a small SaaS if narrowed: retain Next.js, Supabase, the trusted worker, deterministic arithmetic, existing parser, and evidence snapshots. Current `lib/db/queries.ts` already uses Supabase and `lib/db/client.ts` is absent; the SQLite-centric handoff is stale. Broad supporting modules add complexity, but a rewrite is unnecessary. Invest in the missing entry contract, legal coverage, and reliable execution rather than more modules.

### F. Missing MVP Requirements

**P0: Must fix before showing Kate or a pilot customer as a working duty-audit MVP**

- Define historical entry/line CSV fields and paid-duty reconciliation; import the second required dataset with durable identity, product linkage, duplicates, and explicit unmatched/error states.
- Resolve combined Section 232 treatment, country/metal qualifications, rule freshness, and failed-lookup behavior. Withhold totals outside verified scope.
- Select rates/classifications by entry date and HTS revision; support the pilot's relevant additional measures/exclusions or disclose and withhold them.
- Distinguish annual hypothetical delta, historical paid-duty discrepancy, and evidence-backed potential overpayment. Do not call one the other.
- Establish a runnable dependency installation and execute the complete authenticated browser flow with valid, invalid, quiet, unmatched, and date-change datasets.

**P1: Important but can wait beyond a narrowly supervised demonstration**

- Repair partial HTS ingestion/resume and durable success/failure reporting; verify deployed schedules and worker rule-ingestion/recalculation sequence.
- Retry undelivered events independently of calculation deduplication; expose last successful legal-rule synchronization separately from latest fetch.
- Verify each auto-activated HTS rule and legal condition; compose partial amendments without deleting unaffected coverage.
- Add bounded chunk processing above 500 historical entries, durable background progress, input idempotency, and expanded archive limits.
- Repair nonhermetic/import-discovery tests and stale operational docs/UI copy; run deployed RLS/advisor and role/API acceptance checks.

**P2: Future enhancements, not necessary now**

- ERP integration, broad automatic classification, full international tariff engines, comprehensive exporter-specific AD/CVD automation, and new dashboards/modules.
- Automated recovery/refund filing and complete legal qualification of all preference programs.

### G. Minimal Fix Plan

1. Restore dependencies from the existing lockfile and rerun build/types/tests. Diagnose tests by category; do not rewrite working catalogue, CSV, storage, or RLS features.
2. Patch `stack.ts` and the existing rule metadata to represent additive rates versus combined floors and qualified exceptions. Fail closed on stale/unavailable applicability; validate full HTS codes before inheriting rates.
3. Choose the pilot's actual HTS/origin/date scope. Verify those measures against official documents and store effective-dated evidence. Initially return `needs_review` outside that scope instead of pretending to cover every tariff.
4. Extend existing tariff CSV/run storage for entry ID + line number, SKU, entry date, origin, full HTS, customs value, paid/declared duty, quantity/unit, and supported claims. Compute assessed duty minus paid duty per entry, retain basis, aggregate only accepted distinct entries, and keep unmatched records visible.
5. Reuse catalogue linkage and monitored-candidate machinery. Derive impact from accepted historical values/volumes and verified before/after rates, with clear extrapolation assumptions and null when unresolved.
6. Fix chapter-completion tracking and delivery retry; connect and verify the existing fetch → pending rule → reviewed activation → recalculation sequence on the existing worker. Demonstrate a deliberate fetch/delivery failure as well as a quiet run.
7. Run one acceptance dataset through the actual authenticated UI and database, including duplicates, two entries for one product, entry-date rule changes, excluded goods, missing facts, zero discrepancy, and no relevant change. Publish neither deployment nor “complete” claims until this passes.

### H. Final Demonstration

**No: the full requested scenario cannot currently be demonstrated honestly.**

1. **Can both datasets yield useful results?** Catalogue and annual portfolio upload paths exist; a normal entry-history CSV is not supported as the requested second dataset.
2. **Historical duty mistakes with evidence?** Document-code mismatches and present-rate comparisons exist. Paid-duty reconciliation at the applicable historical rate is missing.
3. **Products affected by a new tariff?** Catalogue-code candidates exist; exact applicability still needs verification. Computed monitored impact is bounded mainly to structured Section 232 versions.
4. **Financial impact using historical import volumes?** Current annual-value estimates exist. Deriving exposure from historical entries/volumes is missing.
5. **Automatic monitoring?** Real fetch/check executions are stored. Recurring production operation and the complete rule activation/recalculation chain are unverified; refresh/resume and delivery have defects.
6. **Reliable tariff calculations for a customer pilot?** Not as comprehensive duty totals. The live Annex III result is wrong, rule data is stale, and outage/qualification gaps can return finite totals.
7. **Does every important result explain its calculation?** Component citations, explanations, and saved evidence exist. They cannot make incorrect applicability or missing historical operands valid.
8. **No changes or overpayments?** Resolved portfolio equality returns zero/no_change; unknown rows withhold totals. Monitoring has quiet briefs/coverage caveats. There is no implemented historical “no overpayment” conclusion.
9. **Mocked/hardcoded/incomplete?** Static 301/232/338/advisory tables, synthetic test responses, demo auth, cron placeholder configuration, and context-only CSV fields. The actual tariff UI is wired to APIs, not merely a mock; incompleteness lies in coverage and workflow.
10. **Would it save a manager time?** Potentially, through catalogue handling, official-source triage, and evidence consolidation. It cannot yet safely replace historical duty review or promise trustworthy complete tariff impact.

A limited, clearly scoped technical demonstration of catalogue ingestion, current quotes, saved evidence, and unresolved states is supportable after restoring the local installation. Calling that the completed two-dataset MVP would overstate what was tested and what the code does.
