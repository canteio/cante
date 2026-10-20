# Documentation

Start with [current status](product/status.md). Plans describe intended work; research describes evidence and assumptions; audits describe a particular revision. Older documents can contain superseded runtime, pricing, or delivery instructions.

## Product and operations

| Document | Read it for |
|---|---|
| [Fictional equipment demo](../public/examples/equipment-demo/README.md) | Synthetic fixtures, scenario rules, deterministic formula and local workflow |
| [Current status](product/status.md) | Built features, MVP gaps, and latest recorded verification |
| [Handoff](../HANDOFF.md) | Working constraints and current focus |
| [Setup and deployment](operations/supabase-vercel.md) | Supabase, authentication, worker and Vercel configuration |
| [Agent instructions](../CLAUDE.md) | Current rules, runtime boundaries and code map |
| [Engineering history](archive/engineering-history-2026-10-17.md) | Anonymized historical implementation evidence; not current instructions |
| [Judgment prompt](engineering/daily-judgment-prompt.md) | Original monitoring judgment instructions |
| [Import data pipeline](import-data-pipeline.md) | Public manifest sources and ingestion boundaries |
| [Import-monitor implementation](../pipelines/import-manifest/README.md) | Pipeline contracts, storage, failure handling, and verification |
| [Work queue API](workqueue-api.md) | Resolved-task filter contract; legacy API documentation |

## Plans

| Document | Scope |
|---|---|
| [Mission One](plans/mission-one.md) | Stacking exclusions, authoring, review, and dated implementation updates |
| [U.S. monitor](plans/us-monitor.md) | Broader domestic and trade source coverage |
| [Indonesia monitor](plans/indonesia-monitor.md) | Indonesia coverage roadmap |
| [Competitive roadmap](plans/competitive-roadmap.md) | Historical expansion proposals |
| [Original MVP](plans/original-mvp.md) | Original Indonesia-first plan |
| [Original app architecture](plans/original-app-architecture.md) | Early architecture, including superseded SQLite decisions |

## Research

| Document | Scope |
|---|---|
| [Market](research/market.md) | Dated competitor, positioning, and market estimates |
| [Positioning proposal](research/agentic-positioning.md) | Long-term vision, not verified current capabilities |
| [U.S. leads](research/us-leads.md) | Historical prospect research |
| [Trade-data APIs](research/trade-data-apis.md) | Official data interfaces and limitations |
| [Indonesia source coverage](research/indonesia-source-coverage.md) | Source evidence and known gaps |
| [Pasal upstream issue](research/pasal-upstream-issue.md) | Preserved draft; not evidence an issue was filed |

## Audits

Keep these separate: each records different code and verification conditions. Later fixes may resolve earlier findings.

| Document | Record |
|---|---|
| [October 6 tariff audit](audits/2026-10-06-tariffs.md) | Reconciled October 7 |
| [October 7 review](audits/2026-10-07-review.md) | Original implementation audit |
| [October 8 follow-up](audits/2026-10-08-followup.md) | Scheduling and trusted-worker findings |
| [October 9 fixes](audits/2026-10-09-fixes.md) | Scoped fixes and release verification |
| [October 19 chat CSV checks](audits/2026-10-19-chat-csv-checks.md) | Complete CSV preservation, automatic checks, saved chat context and verification boundaries |
| [October 20 chat news refresh](audits/2026-10-20-chat-news-refresh.md) | Explicit chat-triggered rechecks, unchanged-input duty comparisons and dated tariff headlines |
| [October 20 security review](audits/2026-10-20-security-review.md) | Global reviewer authorization, archive provenance, dependencies and resource limits; unresolved findings |
| [October 18 historical comparison](audits/2026-10-18-historical-rule-comparison.md) | Real adjacent HTS versions, original legal text, amendment dates, product review leads and evidence hashes |
| [October 18 check history](audits/2026-10-18-check-history.md) | Automatic archival, captured source versions, append-only reviews and authenticated persistence tests |
| [October 18 current remedy refresh](audits/2026-10-18-current-remedy-refresh.md) | Fresh Section 232/301 compilation, importer facts, authenticated HTTP/browser verification and remaining scope |
| [October 17 live-data check](audits/2026-10-17-live-tariff-check.md) | Actual government fetches, independent base maths and discovered full-duty blockers |
| [October 17 fictional demo](audits/2026-10-17-fictional-equipment-demo.md) | Scenario arithmetic, CSV/browser checks and isolated live API proof |

## Test datasets

Dataset READMEs stay beside their fixtures so provenance and reproduction instructions remain easy to find.

- [Prusa catalogue and estimated scenario](../scripts/test-fixtures/prusa-public/README.md).
- [LulzBot public research](../scripts/test-fixtures/lulzbot-public-research/README.md).
- [Historical public-product demo](../scripts/test-fixtures/README.md).

## Archive

- [Older README](archive/legacy-readme.md).
- [Previous business handoff](archive/business-handoff.md).
- [October 9 MVP checkpoint](archive/mvp-status-2026-10-09.md).
- [Incomplete Supabase migration checkpoint](archive/supabase-migration-checkpoint.md).

All original documents were retained during the October 12 cleanup. Root Markdown is limited to README, HANDOFF, and CLAUDE, plus the existing AGENTS symlink to CLAUDE; feature READMEs remain with their code or data. Former filenames and their new locations are listed in the [relocation map](archive/document-locations.md).
