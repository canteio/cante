# Current product status

Working-tree summary, October 20, 2026. This collects the latest recorded implementation notes; it is not a fresh production or legal audit.

## Built

Chat file intake (October 20): 15 MiB originals upload in 1 MiB chunks and are
saved privately on attachment. CSV, text PDF, DOCX and XLSX/XLSM tables enter the
same deterministic checker; ambiguous columns require confirmation. Original
references and bounded excerpts replace full-file chat payloads. Existing 100-group /
6,000-entry limits remain. Migration `20261021023704_chat_original_file_uploads.sql`
is applied; app changes are not deployed. [Details and verification](../audits/2026-10-20-chat-file-intake.md).

- “Any news today?”, “Any updates?” and explicit tariff-refresh requests now
  trigger a new saved official-source check against the latest workspace CSV.
  Deterministic comparisons require matching inputs and qualification facts;
  incomplete totals stay unresolved. Today's captured tariff publications are
  labelled unconfirmed for product applicability. Other chat questions continue
  to read saved context; explanatory, unrelated and fictional-demo requests do
  not trigger a workspace recheck. No model routing/completion or schedule is
  required. [Verification](../audits/2026-10-20-chat-news-refresh.md).

- Chat CSV intake is connected to the existing live checker (October 19): original
  UTF-8 CSV retained intact, parsed products/history checked against supported
  official tariff sources, progress streamed and evidence/results/failures archived.
  Missing fields produce corrective guidance and a saved original. Report links open
  the exact record. Later conversations read the latest three workspace checks,
  all parsed product groups and bounded original fields; prompt limits are explicit.
  This is on-demand checking, not scheduled monitoring or universal legal coverage.
  [Verification](../audits/2026-10-19-chat-csv-checks.md).

- Live checks now compare the current and immediately previous official HTS
  revision, retaining original previous JSON, both Chapter 99 subchapter III PDFs
  and linked modifying documents. Exact-code base differences, heading changes,
  legal-note 16/20/52 wording changes and candidate product groups are shown
  separately from applicability review. Release dates are not treated as legal
  effective dates. The real Rev20 → Rev21 test found the Section 301 exclusion
  insertion despite unchanged tested base rates, including the notice’s earlier
  July effective date. [Verification](../audits/2026-10-18-historical-rule-comparison.md).
  This does not backfill all revisions or establish historical full-stack liability.

- `/tariff/history` provides automatic live-check bookkeeping: original CSV and
  confirmations, captured government-source versions, immutable results/failures,
  append-only review decisions, original-result reopening and verified evidence
  export. Source bytes deduplicate by URL/hash within a workspace. New checks never
  replace earlier records. Database migration is applied; no app deployment or
  schedule was performed. [Verification](../audits/2026-10-18-check-history.md).
  This captures checked sources and adjacent tariff revisions; it is not a backfill of all laws,
  a historical legal-effective-date lookup or certified retention storage.

- Current Section 232/301 refresh is implemented for today's calculations in the
  live check and existing single/bulk calculators. Each request fetches current
  USITC consolidated notes, duty headings and the China reference; deterministic
  compilers apply supported metal, legacy China and Note 52 rules. Unknown wording,
  contradictory sources, unsupported scope and failed fetches stay unresolved.
  Historical dates retain the existing reviewed-data path. This is on-demand
  refresh; no new background schedule or model calls were added.
- `/tariff/demo` performs authenticated, automatically archived live checks with exact-code rates,
  independent decimal base-duty checks, release consistency and source evidence
  exports. Intake accepts up to 100 product groups or 6,000 historical rows;
  historical values are explicitly repriced today, not annualized or compared with
  paid duty. Optional importer declarations and per-row CSV qualification facts
  are explicit. Same-input repeat checks compare base duties, and complete stacked
  duties only when both checks are complete. A live 600-entry browser upload yielded
  15 calculable groups, 25 missing metal-weight facts and 10 conditional-scope
  reviews; all 50 base checks passed and the overall total stayed null. Official
  notices remain unapplied review leads. [Verification](../audits/2026-10-18-current-remedy-refresh.md).

- `/tariff/demo/simulation` retains the isolated, labelled fictional equipment scenario: 50 products,
  600 historical entry lines, strict CSV intake, selectable simulated regulations,
  deterministic before/after annual impact, top-five ranking, report/CSV export and
  chat handoff. The server recalculates the scenario; demo chat does not read or
  write customer catalogue, conversation or memory data. This is workflow evidence,
  not real-company or live-law verification. [Methodology](../../public/examples/equipment-demo/README.md).

- Streaming chat displays only the current live provider reasoning summary (configured GPT-5 model). Finished summaries disappear and are not saved; older saved summaries are hidden. Searches and sources remain visible and saved. No private reasoning is displayed.

- Chat is temporarily United States only: static jurisdiction label, commented-out selector, U.S.-only new chats, and explicit refusal to resume Indonesia conversations. Historical data and Indonesia implementation are preserved.

- Chat now defaults to 40–60-word plain-language answers, with applicability checked before presenting feed updates as obligations. The OpenAI adapter streams search activity, returned sources/favicons, and incremental text; private reasoning is not exposed.
- Chat is explicitly hosted API-only; stale provider cookies and client fields cannot launch a CLI. One real OpenAI API connection request was verified. Its companion is the original tan-and-brown SVG profile from the centered-chat screenshot, restored by request; later PNG assets remain inactive. Gentle automatic breathing, head glances and ear perks remain. The empty-chat input is centered with three starter cards beneath it; the rejected tagline and description are removed.
- **Ask Cante** (`/chat`) is restored as a friendly entry point: a 2D black-and-white beagle, file attachments, saved conversations, official-source research through the existing provider, and context from up to 50 real workspace products. Additional products/classifications and read failures are disclosed to the model. The duplicate chat header and workspace-name row have been removed. The configured workspace’s stale pilot company-profile facts were cleared; its 22 catalogue products were preserved.
- `/tariff` combines product CSV/manual intake, search, deletion, list controls, and visible review guidance.
- **Check for changes** is the prominent action. The duty calculator is optional and opens when a product breakdown is selected.
- Deterministic calculations show components, citations, missing facts, and unresolved coverage. Shipment customs value is separate from catalogue reference price.
- Historical CSV audits retain entry identities, paid duty, immutable snapshots, duplicate-upload reuse, and exports. They have a separate dashboard link.
- Mission One includes stacking-rule application, AI drafting and verification at authoring time, and explicitly appointed platform-reviewer approval. Drafts are not approved legal rules.

## Still blocking a complete MVP

- The [October 20 security review](../audits/2026-10-20-security-review.md) found
  shared-rule reviewer and report-provenance risks. Shared-rule reviewer
  authorization is fixed in the applied database migration and working-tree API;
  the reviewer list is empty until administrator appointment.
  [Verification](../audits/2026-10-20-platform-rule-authorization.md).
  Saved numerical comparisons now fail closed without a protected trusted-worker
  attestation; no report is grandfathered, and the verifier worker is still not
  connected. Distributed operation budgets, archive storage caps and early bounded
  upload intake are implemented with applied migrations. Deploy the reader/HTTP
  guard changes before treating these as hosted-app protections.
  [Verification](../audits/2026-10-20-resource-and-report-security.md). Dependency updates
  subsequently cleared all four npm audit findings (Next.js 16.3.8, sharp 0.35.5,
  source-map-js 1.2.2, undici 6.29.1); running services still require restart or
  redeployment. Passing calculation tests is not
  clearance for a secure multi-customer release.
- The hosted checking worker is not connected. A disabled button is not a completed source check.
- Catalogue matching exists, but the dashboard still needs a clear affected-products and next-action flow after a check. Dollar-impact recalculation depends on a saved import-impact run.
- Current metal Section 232 and supported Section 301 rules refresh automatically on calculation. Other Section 232 sectors, conditional exclusions, newer unsupported China headings, Column 2 combinations, AD/CVD and missing qualification facts can still withhold totals.
- Pending legal drafts require human review; unconfirmed product codes remain review leads.
- No real pilot customer or other customer customs ledger has been validated. Public product descriptions and manifests lack essential customs facts.
- The first-time upload flow and returning-user check flow still need design refinement.

## Test data

[Prusa research](../../scripts/test-fixtures/prusa-public/README.md) contains 1,222 extracted catalogue products from 1,304 attempted public URLs; 82 returned 404. It includes one visible public shipment sample, not the full customs ledger.

[LulzBot research](../../scripts/test-fixtures/lulzbot-public-research/README.md) contains public catalogue, BOM, and limited manifest evidence. Neither dataset supplies verified full U.S. HTS classifications or customer customs values.

The user-requested `testsomething.csv` has 20 explicitly estimated Prusa scenarios. Its origins, quantities, classifications, and retail-based values are test assumptions.

A subsequent [six-row first-scan fixture](../../scripts/test-fixtures/prusa-public/first-scan-estimated.csv)
contains only pseudonymous labels, estimated HTS codes and assumed origins.
The local read-only runner `scripts/scan-public-prusa-first.mts` scanned September
12–October 12 publications, listing 220 Federal Register documents and examining
200 selected Federal Register/CBP notice texts. All 157 source-request captures
verified against their hashes; no direct code/product-family leads were found.
This is not an all-clear: broad measures and annexes were not evaluated, and there
is no previous scan baseline. It used no account/company profile, tenant writes,
model calls, delivery or schedule. The anonymous web-upload flow is still unbuilt.

## Verification and deployment

The fictional equipment demo has [dated verification evidence](../audits/2026-10-17-fictional-equipment-demo.md): deterministic scenario and handler tests, existing suite, TypeScript, isolated production build, desktop/mobile browser fixtures and one live API response with customer-data operations forbidden.

The restored beagle chat passed 907 existing tests, TypeScript and production
build, plus isolated browser fixtures for suggestions, petting, streamed
waiting/talking states, visible failure, attachment/removal and the save notice,
and mobile layout. A focused actual-handler probe verified tenant-scoped product
reads, read-failure disclosure and foreign-conversation rejection; a read-only
live schema query checked the selected fields. Anonymous page/API requests still
redirect/reject. No paid model response was run during verification, and the
browser fixtures are not evidence of a live end-to-end model answer. No deployment
or monitoring schedule was activated.

The latest recorded product/review changes passed 907 tests, TypeScript, a production build, and isolated desktop/mobile browser flows. The subsequent check-button layout passed TypeScript, build, and browser fixtures. Those fixtures did not run a paid source check or modify real customer products.

Recent dashboard changes were not deployed as part of those checks. Older preview URLs, migration counts, and audit test counts are dated evidence, not a current production guarantee. Read [historical engineering notes](../archive/engineering-history-2026-10-17.md) and [audits](../README.md#audits) for the original records.

Live reasoning presentation (October 15): one muted, clipped line of provider prose,
without a heading, Markdown decoration, or replay button. A stable slot closes
over 220ms before the next summary opens; generic working status also transitions
its height. Reduced-motion preferences disable the animation. Summaries remain
transient and unsaved; searches and sources are unchanged.
