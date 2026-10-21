# Handoff

Chat file intake (October 20): 15 MiB originals upload in 1 MiB chunks and are
saved privately on attachment. CSV, text PDF, DOCX and XLSX/XLSM tables enter the
same deterministic checker; ambiguous columns require confirmation. Original
references and bounded excerpts replace full-file chat payloads. Existing 100-group /
6,000-entry limits remain. Migration `20261021023704_chat_original_file_uploads.sql`
is applied; app changes are not deployed. [Details and verification](docs/audits/2026-10-20-chat-file-intake.md).

Security follow-up, October 20: shared tariff-rule review is now restricted to
explicitly appointed platform reviewers, enforced in the API, authenticated RPCs,
worker promotion and retry entry points. Migration
`20261021015446_platform_tariff_reviewers.sql` is applied; the private reviewer
list starts empty. Tenant owners/admins cannot appoint themselves. No real account
was granted reviewer access. [Fix and verification](docs/audits/2026-10-20-platform-rule-authorization.md).
The follow-up saved-report/resource fix is implemented: only protected worker-
attested results enter chat/calculation baselines; unverified totals are withheld,
with original inputs retained for rechecking. The attestation registry starts empty
and the independent trusted-worker verifier is still not connected. Shared DB
admission budgets, live-archive storage caps and byte limits before multipart/JSON
parsing are added. Both migrations are applied. Request/reader guards are local
code until app deployment; old hosted code does not automatically gain them.
[Verification and limits](docs/audits/2026-10-20-resource-and-report-security.md).
Dependency updates cleared the four npm audit findings. No app deployment was made.
Read the [security report](docs/audits/2026-10-20-security-review.md) before
presenting this as a secure multi-customer release.

October 20: update requests such as “Any news today?” now rerun the latest saved
workspace CSV through the real live checker. A new immutable record links to its
baseline, preserves explicit declarations and stores a deterministic same-input
duty comparison plus date-filtered tariff headlines. No model completion is
needed for this response. Missing inputs, failed sources and partial totals stay
visible; this does not activate schedules or establish universal legal coverage.
[Verification](docs/audits/2026-10-20-chat-news-refresh.md).

Updated October 20, 2026. Read this first, then [current status](docs/product/status.md). Current agent rules are in [CLAUDE.md](CLAUDE.md); dated implementation records are in the [engineering archive](docs/archive/engineering-history-2026-10-17.md).

October 19: chat CSV uploads now preserve complete UTF-8 originals separately from
the 20,000-character preview, automatically invoke the existing deterministic
live checker, archive evidence/results/failures, and stream progress plus a saved
report link. New conversations read the latest three workspace checks, all parsed
product groups and bounded original-field excerpts (matched by mentioned SKU/entry
IDs where available). Upload-only reports do not call the model. Missing fields
remain saved failures, not guessed facts. No schema migration, schedule or worker
connection was added. [Verification](docs/audits/2026-10-19-chat-csv-checks.md).

Historical before/after comparison is implemented for live checks (October 18).
Each check discovers the immediately preceding published USITC revision, retains
its original JSON and both versioned Chapter 99 subchapter III PDFs, compares
exact-code base duties, Chapter 99 headings and legal notes 16/20/52, and retains
the linked modifying notices and official PDFs. UI changes are review leads, not
automatically approved exemptions or a complete historical stacked-duty impact.
Publication, release availability and document effective dates remain separate.

The real Rev20 → Rev21 comparison found an exclusion-note insertion for statistical
code 8479.90.9591 while the tested base rates stayed unchanged. The notice was
published October 7 but states a July 1 effective date. Old/new text and original
bytes are preserved in immutable check history. Historical JSON is losslessly
gzipped with both stored-byte and original-byte hashes; PDF bytes stay original.
The migration `20261019033002_tariff_historical_source_evidence.sql` is applied.
This is adjacent-version backfill per check, not a full corpus since 1989, automatic
historical liability determination, notification delivery or a connected worker.
See [verification](docs/audits/2026-10-18-historical-rule-comparison.md).

Live-check bookkeeping is implemented (October 18). `/tariff/history` lists saved
checks and captured government-source versions. Accepted live-check CSVs and explicit
confirmations are saved before fetching; evidence versions and the terminal result
are committed atomically. Failures are recorded when possible; interrupted runtime
writes remain visibly incomplete. Review decisions append dated, attributed notes
without rewriting inputs, results or earlier decisions. Export verifies input,
event and source hashes. Reopening a result uses its saved evidence, not today's law.

The archive migration `20261018050226_tariff_check_archive.sql` is applied to the
linked project. Authenticated RLS/column grants and mutation-blocking triggers protect
records; request paths require no service key. This is application/database append-only
history, not certified WORM storage against database administrators. Broader historical backfill remains incomplete: unseen older law versions and previous unsaved checks are not
backfilled, and capture dates are not inferred legal effective dates. Standalone
calculator previews and the separately saved historical-entry audits are not silently
relabelled as live-check archive records. See [verification](docs/audits/2026-10-18-check-history.md).

Current Section 232/301 refresh is built (October 18). Today's calculations now
fetch the current USITC Chapter 99 notes and duty headings, plus the China tariff
reference, rather than relying solely on stale remedy tables. Supported metal
Section 232, legacy China Section 301 and current Note 52 rules use deterministic
calculations. Changed operative wording, unsupported rules, missing qualifications
and failed fetches remain unresolved. Historical calculations retain their existing
reviewed-data path. This is refresh-on-check, not a new background schedule.

The authenticated `/tariff/demo` live check accepts product CSVs or up to 6,000
historical entry rows, exports fetched evidence and shows the facts needed per
product. Ordinary-commercial and other-sector declarations are explicit and reset
when the file changes. Repeated checks can compare complete calculated duties only
when both runs are complete and inputs/facts match; base comparisons stay separate.
No first baseline is called a change or a zero impact. Real authenticated uploads,
calculator routes and desktop/mobile browser checks passed without worker/model
secrets in the hosted test process. The 600-entry example produced 15 calculable
product groups, 25 missing metal-weight facts and 10 conditional-scope reviews;
its overall total remains null. No customer facts were invented to clear them.
See [current verification](docs/audits/2026-10-18-current-remedy-refresh.md).

Federal Register/CBP listings remain unapplied review leads. The disconnected
monitoring worker, unsupported Section 232 sectors, conditional exclusions, AD/CVD
and wider legal coverage are not completed by this change. The earlier
[October 17 check](docs/audits/2026-10-17-live-tariff-check.md) records the original
all-unresolved baseline and is superseded for current remedy refresh only.

The previous fictional simulation is retained at `/tariff/demo/simulation`.
An isolated fictional equipment demo was made available at `/tariff/demo` (October 17).
It generates 50 labelled products and 600 historical entry lines, validates CSVs,
selects a simulated rule, computes integer-cent impacts, exports reports, and opens
chat with the recomputed scenario. The main hypothetical affects 18 products and
adds $8,817,300/year. All company, price, volume, origin, baseline-rate and regulation
facts are synthetic. Ten example HTS codes were found in public USITC responses;
their assignment to the fictional products is not verified classification.
Demo chat bypasses real customer context, conversation storage, catalogue imports
and memory extraction. One real API request through the actual route (with database
access forbidden by a test harness) answered the requested tomorrow question from
computed figures. This does not connect the monitoring worker or prove real legal
coverage. See [demo methodology](public/examples/equipment-demo/README.md) and
[verification](docs/audits/2026-10-17-fictional-equipment-demo.md).

The duplicate chat header/company label has been removed. Old pilot company-profile
facts were cleared from the configured workspace after an ignored local backup;
all 22 catalogue products were preserved. Two historical findings and one saved
alert still contain the former company name; those records were not deleted.
New company facts must come from the user, not historical monitor identity.

The user now wants chat as an easy entry point, with Cante represented by a cute
2D beagle. `/chat` and its authenticated API have been restored;
the sidebar calls it **Ask Cante**. It supports existing files, conversations,
and web research, plus a bounded read of actual workspace products. This does not
connect the missing monitoring worker or enable schedules. See current status.

Chat now requests provider-generated reasoning summaries for the configured GPT-5
streaming model. Actual summaries are live-only: each disappears on completion or when the next
summary/tool/answer starts. They are not saved, and older saved summaries are hidden.
Searches and actual source links remain visible and persisted. Private reasoning events are not
forwarded. Models outside the supported GPT-5 family keep normal progress/search
streaming without a summary request; simple responses may return no summary.
Verified with one live API call, route fixtures and browser fixtures (not a fresh
production conversation or database write). The live-only revision passes TypeScript,
15 targeted tests and a real-route fixture proving summaries are streamed but only
searches/sources are persisted. Browser fixtures verified live replacement, no
finished summary/replay control, retained source links, and hidden old summaries
on reload. The preceding full suite passed 920 tests.

Chat is temporarily **United States only**. The country dropdown is commented
out and replaced by a static label. Indonesia code/history is preserved; attempts
to resume that mode are refused rather than relabelled as U.S. conversations.

Chat is now explicitly **hosted API-only**, per the user's October 13 request.
Ignore stale browser provider cookies/fields there; missing API configuration
must fail visibly rather than launch a CLI. Other worker defaults are unchanged.
The OpenAI chat adapter now streams real working/search events, incremental text,
and returned source URLs to the existing favicon timeline. It does not expose
private reasoning. Default answers target 40–60 words, customer impact and one
next step; a feed snapshot/revision alone does not establish a changed obligation.
The current mascot is the original tan-and-brown SVG profile from the centered-chat
screenshot, restored at the user's request. Active artwork is in
`components/chat/cante-beagle.tsx`; the later flat/full PNG assets remain inactive. The floppy PNG was replaced on
October 17 with `public/cante-dog-floppy.svg`, the exported vector of this same icon.
Gentle breathing, head glances and ear perks run automatically, with reduced-motion
support. This visual restoration leaves API streaming and account-data fixes intact.
Empty chat centers the input below the dog and greeting, with all three starter
cards beneath it. The two rejected tagline/description lines have been removed.
The composer docks at the bottom only once the conversation begins.

The current focus is a simple U.S. tariff dashboard for one pilot customer: save products, check changes, understand affected items and next steps. No proprietary pilot customer customs ledger has been supplied. Public Prusa and LulzBot research is test evidence, not customer customs data.

## Working constraints

- Make code and documentation changes on `dev`; preserve existing uncommitted work.
- The operator forbids Telegram, launchd, and new schedules. Older documents describing them are historical capabilities, not authorization.
- Never implicitly enable paid model calls. `CANTE_LLM` defaults to the local CLI; `api` requires explicit configuration.
- Failed checks, unavailable sources, incomplete legal coverage, and absent customer facts stay visible. Never invent rates, company products, exposure, or successful checks.
- Keep privileged database secrets on the trusted worker, outside the hosted customer app.
- **No new modules under `lib/` until someone has paid.** Exceptions: `lib/llm/api.ts` if provider rule 1 is resolved, scripts, and fixes to code a real customer is touching.
- Preserve application features and legacy routes. Documentation cleanup does not authorize removing `/chat` or other code.

## Where to read next

- [Current product status](docs/product/status.md) for readiness limits and recent verification.
- [Mission One](docs/plans/mission-one.md) for stacking-rule design and dated implementation evidence.
- [Operations runbook](docs/operations/supabase-vercel.md) for setup and hosting constraints.
- [Docs index](docs/README.md) for research, API contracts, fixtures, and audits.

The [previous business handoff](docs/archive/business-handoff.md) is preserved. Its old launch, pricing, schedule, and deployment notes do not establish current authorization or live state.

Live reasoning presentation (October 15): one muted, clipped line of provider prose,
without a heading, Markdown decoration, or replay button. A stable slot closes
over 220ms before the next summary opens; generic working status also transitions
its height. Reduced-motion preferences disable the animation. Summaries remain
transient and unsaved; searches and sources are unchanged.

Verified the October 15 presentation with browser fixtures: single-line prose,
heading removal, sequential closing/opening, no remaining summary at completion,
working-status closure, and reduced-motion CSS. TypeScript and 15 targeted tests pass.
