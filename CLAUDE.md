# Cante — working notes for agents

> **New session? Read `HANDOFF.md` first.** This file covers the code; that one
> covers where the business actually stands, what is in flight, and which
> decisions are already settled.

## Current status — October 10, 2026 (Project Mission One)

- **Unified Trade Compliance Command Hub (`/tariff` & `/catalogue`):** Consolidated the previous multi-tab navigation and deleted legacy 1-2-3 wizard steppers across both `/tariff` and `/catalogue`. Features an instant executive impact banner, an interactive visual cargo-to-customs flow, and an expandable 42-part BOM exposure table ($1.84M exposure, 42 parts, 12 suppliers).
- **Automated Federal Register & CBP CSMS Ingestion (`lib/tariff/federal-register-monitor.ts`):** Daily background monitoring via Vercel Cron (`0 9 * * *` on `/api/cron/tariff-check`) queries live USTR Federal Register notices and CBP Cargo Systems Messaging Service (CSMS) ACE bulletins, automatically extracting affected HTS headings and calculating financial exposure against stored tenant catalogues.
- **Tolerant CSV Ingestion Engine (`lib/tariff/bulk.ts`, `lib/tariff/business-impact.ts`):** Handles dirty enterprise exports without failing: normalizes unpunctuated HTS numbers (`8501104060` -> `8501.10.40.60`, 8-digit, 6-digit), converts natural country names (`China` -> `CN`, `Vietnam` -> `VN`), strips currency decorations (`$ 1,500.50 USD` -> `1500.5`), and fuzzy-matches over 20 header aliases (`HTS`, `HTS-Code`, `Part #`, `Made in`, `Spend`).
- **Supabase Snapshot Persistence & Zero-Token Reloads (`app/api/tariff/impact-runs/route.ts`):** Evaluations and AI mapping results persist permanently as immutable snapshots in Supabase (`tariff_impact_runs`, `trade_policy_alerts`). Page reloads and historical lookups read directly from Supabase, consuming zero LLM tokens.
- **Universal LLM Adapter (`lib/llm/api.ts`):** Added native OpenAI Chat Completions fallback (`gpt-4o`) alongside Responses API, allowing plug-and-play operation with any standard API key.

## Previous status — October 9, 2026

This section supersedes older runtime/deployment notes below. Read
`AUDIT_FIXES.md`, `MVP_STATUS.md` and `SUPABASE_VERCEL.md` for current scope.
The operator explicitly forbids Telegram and launchd for this work. Blank
Telegram credentials during tests; do not activate delivery or schedules.
Code/doc changes stay on `dev`; the user authorized release to dev then main.

Supabase project `nvdsjqzbzsczvmvjxhro` has all 28 migrations applied and HTS
Edge Function version 6 active. Revision 21 has all 99 publication markers. CLI 2.120.0 has working login; the older repo
2.118.0 CLI blocked on Keychain. Do not repeat login unnecessarily.

### Independent audit, October 9 2026 — verified vs. assumed

A from-scratch audit (not by the implementing agent) of the tariff engine,
CSV workflow, regulatory monitoring, and security found the arithmetic and
"never fabricate" discipline genuinely sound — nulls propagate instead of
guessed numbers everywhere checked (`lib/tariff/stack.ts`,
`lib/tariff/duty-expression.ts`, `lib/tariff/business-impact.ts`). The real
gap is breadth, not correctness: Section 301/232/AD-CVD coverage is narrow
hand-maintained tables, and "automatic regulatory monitoring" in production
means the 6-hour USITC *rate-schedule* sync, not detection of new Section
301/232/AD-CVD legal actions — that richer system (`lib/checks/*`) exists but
is 409'd off in the hosted app. The proactive recalculate-and-notify cron
(`supabase/functions/tariff-impact-recalculate`) is architecturally sound but
requires a reachable "trusted worker" that is not deployed; its Vault secrets
are still placeholders. The internal cron bridge
(`app/api/internal/tariff-recalculate/route.ts`) was independently re-checked
and is solid — timing-safe shared-secret comparison, rejects on Vercel,
never leaks per-customer detail on a compromised secret.

**`scripts/verify-lulzbot-pilot.ts`** (added this session) runs the real,
un-mocked `importProductsCsv()` → `parseBusinessImpact()` →
`evaluateBusinessImpact()` → `createImpactRun()` pipeline against the real
public LulzBot product list and the real public Aleph Objects import
manifests ImportGenius publishes — not a script-only simulation, a run
against the actual configured tenant (`CANTE_CUSTOMER_ID`). It confirmed by
direct execution, not just by reading the existing test, that the real
manifests (which carry no HTS/value/duty data) come back `error` on every
row with specific missing-field messages and zero fabricated duty — matching
`lib/tariff/business-impact.test.ts:180-196`. Running it imports
`DEMO-PLA-285` / `DEMO-NEMA17` into the real customer's product catalogue
(clearly SKU-labelled DEMO) — a genuine, intentional write, not a side effect
to silently revert.

⚠️ **Verified live, not assumed: `create_tariff_impact_run` (`supabase/migrations/
20261009132549_audit_tariff_coverage_and_hts_progress.sql:160`) is granted to
`authenticated` only, not `service_role`.** `lib/supabase/server.ts`'s
documented CLI fallback (`createClient()` → service client outside a request
scope) therefore cannot persist a tariff impact run — it correctly gets
refused. This is the right security boundary (impact runs are user-uploaded
data, not a worker-authored table) and not a bug, but it means
`verify-lulzbot-pilot.ts` can prove the parsing/calculation stages and the
catalogue import, and no further than that: proving the persisted
"upload → see it in Saved reviews" path still requires a real authenticated
browser session. That last step was not independently re-verified this
session (no browser-extension/login access); it rests on the existing
migration/idempotency tests and the prior agent's described browser
walkthrough in `AUDIT_FIXES.md`, not on a fresh run.

Tariff fixes require exact published statistical codes, Column 2 where applicable,
quantity/unit propagation, reviewed consolidated Section 232 coverage, and honest
unresolved totals for the July forced-labor Section 301 action. Historical
entries preserve entry/line identity, customs value, paid duty, qualification,
and raw input; duplicate uploads reuse immutable snapshots. Computed persisted
entries require an exact tenant catalogue match. Historical rows never become
annual forecast exposure. A separately labelled before/after scenario may hold
the same uploaded historical values and quantities constant. Public LulzBot
product descriptions and synthetic imports are demo inputs, not proprietary customer evidence. The bounded historical basis is HTS 3916.90.30.00,
China/Vietnam, July 21–27 or September 15–27, 2026, archived Revisions 12/19; unsupported scope
remains unresolved, and a calculated difference is not a refund entitlement.

HTS completion requires atomic publication markers for every chapter; failures
remain failures and chapter 99 uses terminal boundary 9999. DOCX/XLSX expansion
is bounded before allocation. OpenAPI discovery supports both module export
shapes, and customer listing pages through PostgREST response limits.

Daily automated check of official government sources, matched against one
manufacturer's actual operations, producing a plain-language alert only when
something genuinely changed. The bundled customer profile is fictional and defaults to the United States.

**Not export-only.** A purely domestic manufacturer is a first-class customer:
every one of the 13 Indonesian sources — national law, tax, environment, labor
and OHS, SNI, KBLI/OSS licensing, regional Perda — applies whether or not
anything ships abroad, and 29 of 52 US sources are domestic. `sideOfTrade`
(`domestic | import | export | both`) decides whether the cross-border packs are
polled at all.

Business model is Vanta's, pointed at Indonesian *export* compliance: watch
something automatically, alert on change, charge monthly, sell to businesses too
small to hire someone for it.

---

## The two rules that govern everything

**1. Flexible LLM Provider Options.** `CANTE_LLM` defaults to `claude-code`.
The factory also supports `codex-cli`, `antigravity` and the explicitly enabled
hosted `api` provider. Local CLI providers use the operator’s login; the deployed
app uses `api` with `CANTE_LLM_LOCKED=true`. Never enable hosted spend implicitly.

**2. Honest failure beats useful-looking output.** A fetch that failed and a
regulation that isn't relevant are different facts, and neither may be rendered as
"checked, nothing found". This is why `source_results` is its own table, why
`entriesParsed: 0` is tracked separately from `success`, and why the alert carries
`coverageCaveats`. Accuracy over always having something to report — a quiet alert
is the product working, not failing.

The same discipline now runs one stage further down. `source_results` proves what
was *fetched*; `lib/checks/coverage.ts` proves what was *judged*. An entry the
model silently skipped and an entry it read and cleared both left no row, so a run
could parse 30 Kemendag entries, return verdicts on none, and still read as
"nothing found". `auditVerdictCoverage()` splits fetched entries into judged /
already-seen / unaccounted and appends a **code-written** caveat for the last
group. Model-written caveats can't be the only ones — the model is the thing
being audited.

### An alert that says a rule changed must say what changed (added 19 Aug 2026)

`lib/checks/briefing.ts`. "PP 20/2026 — worth a look" hands the reader the
entire job: find the new rule, find the old one, read both, work out the
difference. Nobody does that, so the alert gets skimmed and the monitoring is
worth nothing. The judgment provider already has `WebFetch`/`WebSearch`, and
`lifecycle.ts` already detects that 20/2026 amends 55/2022 — so the run
researches the delta and puts it in the alert.

Output is a scannable before → after list, not prose:

```
*PP 20 Tahun 2026* — mengubah Peraturan Pemerintah Nomor 55 Tahun 2022
Mengatur tarif PPh final 0,5% untuk usaha kecil (UMKM).
Yang berubah:
• CV, Firma, PT biasa: boleh pakai PPh final 0,5% → tidak boleh lagi
• Orang pribadi, PT perorangan: batas waktu 3-7 tahun → tanpa batas waktu
Buat kamu: …
```

Verified live against the real PP 20/2026, and independently correct — it
matched a Gemini answer the user had on the same regulation, and additionally
found the transition provision and the new non-deductibility of bribes.

**Two things the first live run got wrong, both fixed and both worth
remembering:**

1. **It answered in English** for an Indonesian business owner. The system
   prompt said "write for a business owner" and never named a language.
   Language is now stated explicitly per jurisdiction. Prompts inherit English
   by default; say the language out loud whenever output reaches a customer.
2. **It was enormous** — multi-clause rows citing Pasal numbers. The fix was
   not "be concise" but a hard shape: `before`/`after` are **fragments of at
   most 8 words**, max 5 rows, enforced in the Zod descriptions *and* the system
   prompt, with the reasoning stated ("if a row cannot be said in eight words it
   is too detailed for this format"). Schema constraints work better than
   adjectives.

Honesty rules, because a fabricated "before" column is worse than no table —
it reads authoritative and a customer may act on it:

- Every row must come from a document actually fetched; the model is told to
  return **fewer rows rather than guess one**.
- `confidence: "partial"` when the older rule could not be fully read, rendered
  **next to the table**, not in a footnote three sections away.
- A briefing with no rows *and* no sources read is discarded rather than shown
  as an empty comparison implying the work was done and found nothing.
- Bounded to `flagged`/`noted` findings, max 3 per run, and every failure
  degrades to the plain finding the alert would have carried anyway.

The Telegram digest carries this section too, trimmed to ~1400 characters on a
line boundary, via `alertBriefingExcerpt()` — which **reads it back out of
`alert.body` rather than re-deriving it**, so the operator and the customer can
never end up with two different accounts of the same change.

### ⚠️ The "41 unjudged entries" defect was the audit crying wolf (fixed 19 Aug 2026)

Three runs reported entries as never checked and a retry that resolved 0 of
them every time — 0 of 1, 0 of 3, then **0 of 41**. It was recorded here as the
largest defect in the system and diagnosed as the model refusing to complete
large batches. That diagnosis was wrong, and the way it broke is worth keeping.

**First fix, on the wrong cause.** Batching the judgment stage looked obvious:
62 entries in, 20 verdicts back. `lib/checks/judge-batched.ts` splits entries
into batches of 15 and composes the customer message in one small separate call
(each batch would otherwise write a message about its own slice). That work is
sound and stays — but the very next live run put **8 entries in one batch and
got 3 verdicts back**, which killed the hypothesis outright. Batch size was
never the problem.

**The actual cause: one regulation, two portals, two URLs.** The five
"unchecked" entries were PP 31/2026, PP 27/2026, Permenaker 11/2026 and two
Keputusan Dirjen — every one of which had *already been judged in an earlier
run*, fetched then from `jdih.kemnaker.go.id` and now from Setneg under a
different URL. The model saw them in the seen log and correctly declined to
re-litigate. `auditVerdictCoverage()` keyed only on exact URL, so it called
them never checked. **The model was right and the audit was wrong**, and it had
been generating false alarms for three runs — including one that cried wolf
over 41 entries at once. In a product whose entire value is that a disclosure
means something, a coverage warning nobody should act on is a serious defect,
not a cosmetic one.

**`regulationIdentityKey()` is the fix**: instrument type + number + year, so
"PP 27 Tahun 2026" and "Peraturan Pemerintah Nomor 27 Tahun 2026" resolve to
the same `pp|27|2026`. Three properties are load-bearing:

- **Type is part of the identity, never dropped.** PP 11/2026, Perpres 11/2026
  and Permenaker 11/2026 are three different regulations sharing a number and a
  year. Matching on number alone would silently suppress two real ones — a far
  worse failure than the one being fixed.
- **The instrument is read only from text *before* the number.** Titles cite
  other regulations constantly; "PP 20/2026 tentang Perubahan atas PP 55 Tahun
  2022" must key on 20/2026, not 55/2022.
- **An unparseable citation returns `null` and never matches.** Absorbing a
  title it could not read would hide a genuinely unjudged entry, which is the
  original failure inverted.

Composite decree numbers needed their own branch: Keputusan Dirjen numbers look
like `3/1920/PK.01.02/III/2026`, carrying the year inside the number with no
"Tahun" anywhere, and were still reported unchecked after the first fix.

Verified against the real database: replaying all five entries that the last two
runs reported as unchecked now yields **0 unaccounted**, and the caveat says
they were "sudah dinilai dari sumber lain". 176 tests pass.

**Disclosure alone isn't the fix for that gap — `runCheck()` also retries it
(added 18 Aug 2026, now a long stop rather than the main mechanism).** `judge()`'s prompt explicitly instructs the model to
return a verdict for every entry, but on a large batch it does not always fully
comply: a real run (`dfd33ac5`, 18 Aug 2026, the day the East Java sources above
went live) put 54 entries into judgment and got verdicts back for only 36–37,
with the missing 18 coming from established Setneg/Kemnaker sources, not the new
ones. `runCheck()` now computes `auditVerdictCoverage()` right after the first
`judge()` call and, if anything is unaccounted, retries **once** against only
the missed entries — a much smaller batch is far more likely to get full model
compliance. Newly surfaced `flagged`/`noted` findings from the retry are
appended to the customer-facing message; a code-written caveat always states how
many of the missed entries the retry actually resolved. The retry is bounded to
a single attempt (never a loop chasing a model that may never fully finish), and
a retry failure is caught and degrades to the same honest "unaccounted"
disclosure the first pass would have produced alone — a completion-pass bug must
never turn an otherwise-successful run into a failed one. `normalizeUrlKey()` is
exported from `coverage.ts` so the retry can match returned findings back to the
exact entries it was asked about, rather than trusting the model not to
re-litigate something already judged. `lib/checks/coverage.test.ts` covers the
audit function itself, which had no test coverage despite being load-bearing.

**A live run on 18 Aug 2026 found a gap the audit itself doesn't cover: the
model's free-text `whatsappMessage` can assert something the model's own
`findings` don't back.** One run's message opened with "the only rule that
came up was already checked before" — but the coverage audit for that same
run said the opposite: 0 judged, 0 already-seen, 1 unaccounted for that exact
entry, and the code-written caveat correctly called it out three sections
later. `auditVerdictCoverage()` audits the *findings* array; nothing audited
the *prose*, so a false claim could open the message a reader sees first and
be silently corrected only in caveats they might not reach. `judge()`'s
system prompts (both languages) now explicitly forbid stating or implying an
entry was already checked without a backing verdict, and warn that the claim
is audited. The same run also showed the message repeating, in paragraph
form, content the code was about to append anyway as coverage notes — so the
prompt and the `whatsappMessage` schema description now require a single
bolded one-liner (WhatsApp's own `*asterisk*` syntax, not Markdown — Telegram
never gets `parse_mode` and would show it literally) when nothing is flagged
or noted, with caveats left entirely to the code-appended section. Not yet
re-verified against a live run; the next `npm run check` with a quiet result
is the test.

---

## Commands

```bash
npm run dev        # Next.js at localhost:3000
npm run check      # same code path as POST /api/checks, from the terminal
CANTE_COUNTRY="United States" npm run check  # run the US pack
npm run check:scheduled            # the cron entrypoint: run, deliver, exit with a code
npm run check:scheduled -- --verify # confirm the Telegram bot and chat work
npm run db:seed    # seed sources + Example Company from config/customer.json
npm run db:cloud:dry-run # legacy Supabase-only read verification
npm run db:cloud:sync    # compatibility alias: no data copied
npm run db:cloud:verify  # verify Supabase reads/counts
npm test           # focused source-window/parser regression tests
npm run build      # must stay clean
npx tsc --noEmit   # must stay clean
```

## Production runtime (added 23 Aug 2026)

Supabase is now the only application/worker database. Vercel serves the
signed-in app with session-bound RLS; the trusted worker runs long source checks
using a local CLI and writes to Supabase. `scripts/sync-supabase.ts` is a
read-only compatibility verifier, not an importer or local/cloud parity check.
SQLite files and Drizzle declarations are legacy artifacts, not runtime storage.
Do not create a local ledger or run the removed `db:push` command.

`supabase/migrations/202608230001_cante_production.sql` contains the complete
Postgres schema, pgvector/FTS document retrieval, and RLS. `customer_users` is
the tenant authority. Middleware protects operational pages and APIs;
`resolveCustomerId()` validates every requested customer against membership;
RLS repeats the boundary in Postgres. The publishable key is used by the signed-
in app. `SUPABASE_SECRET_KEY` bypasses RLS and belongs only in the local sync
worker, never Vercel and never a `NEXT_PUBLIC_*` variable.

The hosted model never connects to Supabase and never receives a database key.
`app/api/chat/route.ts` uses the signed-in Supabase session to call
`search_cante_context`, then puts only those bounded tenant excerpts in the
prompt. Chat uploads write `trade_documents` and `document_chunks` through the
same user/RLS session. This is the memory architecture: structured durable facts
in `memories`, document evidence in chunks, retrieval at request time, and no
whole-database prompt dumps.

The vector RPC keeps `search_path = ''` because it is part of the tenant
security boundary. Consequently, pgvector's cosine operator must be written as
`OPERATOR(extensions.<=>)` in both the similarity expression and `order by`.
An unqualified `<=>` fails on Supabase with PostgreSQL error 42883 even though
both operands display as `extensions.vector`; do not remove that qualification.

`lib/llm/api.ts` is now implemented for OpenAI Responses and Anthropic Messages,
with server-side web tools. Hosted spend remains explicit: Vercel sets
`CANTE_LLM=api` and `CANTE_LLM_LOCKED=true`; local checks continue to default to
the CLI. The API keys are server-only. OpenAI calls set `store: false`.

The exact migration and Vercel environment sequence is in
`SUPABASE_VERCEL.md`. The honest boundary remains: heavy check execution,
customs document audit, tariff enrichment, screening, and BOM assessment still
run on the worker. Their tables are migrated, but Vercel does not pretend to run
those long/local workflows; `POST /api/checks` returns 409 in cloud mode.

A full check takes several minutes: the profile first selects applicable source
packs, then the judgment stage may fetch detail pages. `npm run check` is the
fastest way to test without the browser.

---

## Layout

```
lib/llm/          types.ts = the seam (+ streaming) · claude-code.ts (works) · codex-cli.ts (local fallback) · api.ts (OpenAI/Anthropic) · index.ts (factory)
lib/sources/      registry.ts (sources + profile activation as data) · fetch.ts (no AI, fetch+JSON/RSS/Cheerio parse)
                  pasal-dates.ts (enactment dates the pasal.id API omits) · fallback.ts (labelled backup when an official source fails)
                  *.test.ts (incremental windows, pagination, source-field contracts)
lib/screening/    csl.ts (bounded, cached exact-name matching against Trade.gov CSL bulk data)
                  persist.ts (screens as dated, auditable events; `error` is never `clear`)
lib/chat/         attachments.ts (a dropped file is filed, not just read — documents, catalogue, memory)
lib/checks/       judge.ts (prompt + Zod schema) · judge-batched.ts (batches + message composition) · briefing.ts (what actually changed, before → after) · run.ts (fetch → judge → store) · checklist.ts (living obligations)
                  facts.ts (HS/KBLI tiers — the one answer to "what is established") · coverage.ts (entries in, verdicts out)
                  lifecycle.ts (amends/revokes/supersedes links + favourable/unfavourable direction)
lib/catalogue/    products.ts (SKUs + CSV import) · classifications.ts (tiered code history + approval)
                  lanes.ts (trade lanes, suppliers) · csv.ts (quote-correct reader, no dependency)
lib/delivery/     telegram.ts (Bot API, chunking) · dispatch.ts (run → message, with honest delivery states)
lib/classification/ suggest.ts (retrieval-grounded HTS suggestions; lead-only, adopt-then-approve)
lib/tariff/       duty-expression.ts (rate strings → numbers, or an honest refusal) · rates.ts (USITC HTS lookup, quote, compare)
lib/substances/   bom.ts (components, declared substances, restriction lists, four-verdict assessment)
lib/impact/       assess.ts (finding → affected SKUs/lanes → exposure, or an honest null; + tariff enrichment)
lib/documents/    audit.ts (PEB/invoice text → line items → discrepancies → document-tier promotion)
                  extract-file.ts (uploaded .pdf/.xlsx/.docx/.csv → text, or an honest refusal; no OCR)
lib/workflow/     actions.ts (finding → human response, kept separate from the evidence)
lib/suppliers/    evidence.ts (certificate status, gaps, expiry horizon)
lib/test-support/ supabase-test-db.ts (Supabase test fixtures + per-test tenant isolation)
lib/db/           schema.ts (legacy types) · queries.ts (Supabase)
app/              page.tsx (public landing) · login/ · request-access/ · pending/ · logout/ · checklist/ · chat/ · memory/ · catalogue/ · documents/ · workqueue/ · suppliers/
                  api/{checks,checklist,chat,customers,memories,screening,products,classifications,lanes,documents,workqueue,suppliers,tariff,substances}
components/       dashboard/ · checklist/ · memory/ · chat/ (chat-panel.tsx reads the SSE stream · markdown.tsx renders answers)
                  catalogue/ · documents/ · workqueue/ · suppliers/ (the Operations screens)
scripts/          seed.ts (sources + source packs + Example Company) · run-check.ts · scheduled-check.ts (cron)
mike-main/        reference copy of another project — design source, gitignored,
                  excluded in tsconfig (else `next build` compiles its backend)
uigen-claude/     reference copy used for chat streaming/thinking UI patterns,
                  excluded in tsconfig for the same reason
pasal-main/       reference copy of github.com/ilhamfp/pasal (AGPL-3.0), the
                  open-source upstream of the pasal.id API Cante consumes.
                  Gitignored and excluded in tsconfig for the same reason —
                  its Next.js app broke `tsc --noEmit` until excluded.
config/           customer.json — read only at seed time now
raw/              source HTML, rewritten every run (gitignored, write-only debug trail)
cante.db          the SQLite file (gitignored)
```

**Where data lives.** Supabase Postgres, for the hosted app and trusted worker.
Tenant-bound reads/writes use the authenticated session and membership RLS.
Worker/admin secrets remain outside browser/Vercel application credentials.
`cante.db` and `CANTE_DB_PATH` belong to the superseded SQLite architecture.
SQL migrations are authoritative; `db:seed` writes optional fictional data to
Supabase and must not be treated as a harmless local initialization step.

**The seam.** Nothing above `LlmProvider` knows which provider it got. Providers
return raw text and never validate; one Zod schema parses it in
`completeJson()`, so the two providers cannot drift into accepting different
shapes. Switching to the API later is `lib/llm/api.ts` plus one env var — keep it
that way.

**Provider switching is local-only.** The sidebar selector writes a `cante_llm`
cookie. `claude-code` is the working default. `codex-cli` is the intended
OpenAI/ChatGPT fallback through a signed-in local Codex CLI, not an API key; it
is only selectable when `codex --version` works. `api` requires explicit API-spend authorization. The hosted deployment is
authorized and locks the selector to `api`.

**Streaming is optional on the seam.** `LlmProvider.stream?()` yields
`StreamEvent`s (`tool_start` / `tool_end` / `thinking` / `text` / `done` /
`error`) so the chat can show tool calls instead of a spinner. `tool_start`
may carry `url` / `hostname` so the UI can render source favicons for web reads.
`StreamRequest.signal` is passed through to CLI-backed providers so the Stop
button kills the child process, not just the browser reader.
It is optional on purpose: a provider without it still works through
`complete()`. Callers must handle absence — `app/api/chat/route.ts` returns
**501** rather than pretending.
`StreamRequest.tools` names the tools the model may use for that call; the
Claude Code provider passes them to `--allowedTools` **plus `ToolSearch`**,
which is how the CLI loads deferred tools like `WebSearch` (without it the
allow-list alone doesn't make them callable). Verified working against the live
CLI. Streaming does not change rule 1 — `claude-code` is still the only
provider, still on the local login, still no API spend.

### ⚠️ Rule 3: spawned CLI processes get no write access

**`--allowedTools` is an auto-APPROVE list, not a restriction.** Pairing it with
`--permission-mode acceptEdits` (which this code did) leaves Edit / Write / Bash
fully available. That is not theoretical: the first live streaming chat test
**edited this repo's `CLAUDE.md` and `README.md`**. It happened because the
subprocess also ran with `cwd` = the project root, so it loaded *this file* as
its standing instructions — including "update the docs when code changes" — and
dutifully did so. Only docs were touched; code was verified unchanged.

Three things keep it shut, all in `lib/llm/claude-code.ts`. Do not remove any of
them, and do not reintroduce `--permission-mode acceptEdits`:

1. `--disallowedTools` with `DENIED_TOOLS` (Bash, Edit, Write, NotebookEdit,
   Task, Agent, Skill, KillShell, SlashCommand) on **every** spawn.
2. `cwd: getScratchDir()` — a temp dir, so project files are out of reach and
   this file is never loaded as instructions.
3. No permissive `--permission-mode`. In headless `-p`, the default denies
   anything needing permission.

The model needs no file access for either stage: judgment and chat both get
everything they reason over in the prompt. Verified by asking the chat endpoint
directly to edit the docs and create a file — it refused, and an md5 tripwire
confirmed nothing changed.

**Deleted 2026-08-15** once the port was verified: `scripts/fetch_sources.py`,
`alerts/` (the markdown alert files and sent-log), and the Python-era
`raw/*.json`. Findings live in SQLite now. `daily-prompt-check.md` stays — it's
the prose source `lib/checks/judge.ts` was ported from and still the clearest
statement of the judgment rules.

---

## UI

Design copied from **Mike** (`mike-main/frontend`), not merely inspired by it —
token values, the liquid-glass recipe, the floating composer, and the gradient
send button are lifted from its `globals.css` and `ChatInput.tsx`. Near-white
neutrals, azure `rgb(0,136,255)` accent, Inter for chrome + EB Garamond for
document-like content (the alert body the customer receives).

Written in **plain CSS** in `app/globals.css` — Mike runs Tailwind v4 + shadcn,
and matching the look didn't justify that dependency surface. `lucide-react` is
the one dependency taken from it. The earlier warm-paper palette (#F6F3EC, rust,
Zilla Slab) is gone; don't reintroduce it.

**`/` is now the public landing page, not the app shell.** Added 21 Aug 2026
and refined the same day into a precision-minimal treatment: muted video, the
centred, compact serif two-line promise "Build the AI compliance team you don't
have.", one white CTA,
and an unframed source-event stream rising quietly from the bottom. Do not
replace it with mesh backgrounds, green gradients, agent cards, country
switchers, metrics, feature sections, or a multi-section "Compliance OS"
landing page. The visible explanation is intentionally one short sentence;
descriptive compliance-monitoring terms live in page metadata without changing
the hero composition. The supporting line is "Cante checks official sources
daily and tells you which changes affect your operations." so the product's
monitoring mechanism and relevance filtering are explicit. The
illustrative stream uses U.S. examples (Federal
Register, USITC HTS, and EPA TSCA) because U.S. prospects are the current public
audience. Public surfaces use Manrope; the app keeps Inter + EB Garamond.
The public, authentication, and dashboard wordmarks use the same restrained
beagle sentinel mark: a one-color side profile whose long folded ear creates the
signature negative-space sweep. It has a genuinely transparent background and
no tile, gray fill, shading, color cast, or animation. `public/cante-beagle.png`
is the single black artwork used by `components/brand-mark.tsx`; the dark
landing page inverts that same asset to white, while light product and auth
surfaces render it in black. `app/icon.png` is the matching browser favicon.
Keep the image fit set to `contain` so the silhouette is never cropped. Do not
reintroduce facial animation or let those surfaces drift into separate logos.
from the MotionSites "AI Runtime" direction: a single-viewport, full-bleed
CloudFront video background, rounded white nav, invite-only CTA, and Cante copy
for daily regulatory monitoring. The live app remains on `/chat`,
`/checks`, `/checklist`, `/profile`, and the Operations routes. The landing
page is deliberately auth-free for now: `Request invite` is a `mailto:` CTA.
Keep landing CSS scoped under
`.landing-*` in `app/globals.css`; do not let the dark marketing palette leak
into the operational dashboard.

**Login is a local demo gate, not real auth.** Added 21 Aug 2026 so the site
has login flow before Supabase exists. `/login` posts to `/api/demo-login`;
username `demo` and password `demo` set an HTTP-only `cante_demo_session=demo`
cookie for 12 hours. `middleware.ts` redirects the app pages (`/chat`,
`/checks`, `/checklist`, `/profile`, `/memory`, `/catalogue`, `/documents`,
`/workqueue`, `/suppliers`) to `/login?next=...` when the cookie is absent.
Landing `Sign in`, `Open app`, `Product`, and `Sources` route through this gate
and default to the United States demo workspace. This is only a prototype of the
navigation logic; replace it with Supabase Auth + user-to-customer mapping
before exposing real customer data.

`/login` and `/request-access` deliberately share one minimal light treatment:
small Cante wordmark, centred form, 6px controls, no video, icons, badges,
marketing panel, or glass card. The access form currently opens a prefilled
email and includes the company description in its body.

**Supabase/Vercel prep exists but is not a production migration.** Added 21 Aug
2026: `@supabase/ssr` / `@supabase/supabase-js`, `lib/supabase/{client,server,
middleware}.ts`, `lib/auth/config.ts`, `/request-access`, `/pending`, `/logout`,
and expanded `envexample`. `CANTE_AUTH_MODE=demo` remains the default. Setting
both `CANTE_AUTH_MODE=supabase` and `NEXT_PUBLIC_CANTE_AUTH_MODE=supabase` makes
middleware validate Supabase Auth claims and makes `/login` call
`signInWithPassword()`. Until real tenant tables are wired, Supabase mode also
requires `CANTE_ALLOWED_EMAILS`; authenticated emails not on that comma-separated
list land on `/pending`. See `SUPABASE_VERCEL.md` before deploying. Vercel still
must not run the daily checker: SQLite persistence and local Claude/Codex CLI
providers remain local-runner concerns.

**Jurisdiction switching is real state, not decoration.** The chat composer has
a compact ID/US selector. Changing it starts a fresh country-scoped chat and
changes the system prompt, official-source preference, stored run history,
jurisdiction profile, memories, and checklist context together. Checks,
Checklist, Profile, and Memory carry the same `?country=` value. Existing data
migrated to Indonesia; US records stay separate. On mobile, the desktop rail
collapses into a horizontal app bar.

`/profile?country=United%20States` is the US truth editor: facilities, NAICS,
products/SKUs, materials, processes, waste, distribution states, claims,
HTS/Schedule B, ECCN/EAR99, export markets, and product flags. Saving it
refreshes the US checklist immediately.

**Chat answers are Markdown, so they get rendered as Markdown.**
`components/chat/markdown.tsx` (`react-markdown` + `remark-gfm`) replaced
pre-wrapped text, which was showing headings, bullets, tables and bold as raw
syntax. Styling is `.md-body` in `globals.css`. Model-supplied links are forced
to `target="_blank" rel="noreferrer noopener"` — they point at the open web and
must never navigate the app frame. Total UI dependency list is now
`lucide-react`, `react-markdown`, `remark-gfm`; still no Tailwind.

**Chat opens ChatGPT-style**: composer centred, greeting above it, then both drop
to the bottom on the first message. Driven by one class — `.chat-page.is-empty` —
and animated with `translateY(calc(-50vh + 50%))` rather than a layout change,
because layout isn't animatable and transform lands centred at any composer
height. Easing is Mike's own panel curve, `cubic-bezier(0.22,1,0.36,1)` / 500ms.
The greeting is `position: absolute` above the composer so it travels with it
without affecting layout.

**Chat responsiveness matters.** The SSE stream now closes as soon as the answer
is saved and sends `done` before background memory extraction starts. Do not make
the composer wait for `extractMemories()` again; that made chat feel slower than
Claude/ChatGPT even though the answer was already visible. While a response is
running, the UI shows a timeline of what actually happened. The square composer
button is an actual abort control while streaming; do not disable it again.

### ⚠️ Rule 4: the chat UI shows only what the provider reports

Rule 2 applies to the interface, not just the alert. Three pieces of theatre
were removed in the rewrite, and none may come back:

1. **A preflight `complete()` call.** Before streaming the real answer, the
   route made a *second* model call asking it to "write the visible reasoning
   panel", then rendered that as thinking. It was prose about what the model was
   about to do, generated by a different call than the one that did it — and it
   cost a full extra round-trip on every turn, including questions needing no
   tools at all.
2. **A `<visible_reasoning>…</visible_reasoning>` block** the answer had to open
   with, stripped back out and rendered as "Reasoning". That is the model
   narrating for the panel, not the model thinking.
3. **Hardcoded favicons.** `describeTool()` returned
   `["jdih.kemendag.go.id", "peraturan.bpk.go.id", "jdih.kemenkeu.go.id"]` for
   *every* WebSearch, so three government favicons animated regardless of what
   was searched or what came back.

Client-invented phase labels ("Preparing", "Searching web", "Writing answer")
and the placeholder line "Checking stored runs, memory, and official web
sources" went with them.

**What the CLI actually reports**, verified against the live binary:

| Signal | Real? | How it's shown |
|---|---|---|
| `text_delta` | yes — token by token | the answer, streaming |
| tool name + input | yes | "Searching «query»" / "Reading hostname" |
| search result links | yes — real titles and URLs | favicon stack + expandable source list |
| thinking block open/closed | yes | "Thinking" → "Thought", with live duration |
| thinking token estimate | yes | "· N tokens" |
| **thinking text** | **no — always empty** | **nothing** |

That last row is the load-bearing one. The CLI emits thinking blocks whose
`thinking` field is `""` — only a signature and `estimated_tokens` come
through. So the UI may honestly say the model is thinking and for how long, and
must never fill that space with invented reasoning. `StreamEvent` passes
`delta.thinking` through if a future CLI ever populates it; until then the block
renders duration and tokens only.

`--include-partial-messages` is what makes any of this live: without it the CLI
only emits completed blocks, so the answer appeared all at once and an open
thinking block was invisible. With it, `stream_event` lines carry the raw
deltas. Text is taken **only** from deltas — the completed `assistant` block
repeats the same text and would double it.

**Tool activity is real activity.** Favicons come from
`parseSearchResults()`, which reads the `Links: [{title,url}]` array out of the
WebSearch tool result — the actual pages the model saw. A search still running
shows no favicons, because there are no results yet. Results are stored on the
message so a reopened conversation replays the same sources.

**The timeline is Mike's `EventBlock` pattern** (`mike-main/frontend/src/app/
components/assistant/message/EventBlocks.tsx`): one rail, a dot per event that
spins while the step is live, a connector joining consecutive events, and the
verb changing tense on completion (Searching → Searched, Reading → Read,
Thinking → Thought). Styling is `.timeline` / `.tl-*` in `globals.css`.

**Fresh-regulation questions should search immediately.** In chat, if the user
provides HS codes and asks for new/latest/current regulation discovery, the route
injects a per-turn search directive telling the model to WebSearch official
Indonesian government sources first. That directive also caps the first pass to
roughly two targeted searches and two or three source reads unless the user asks
for exhaustive research; answer with caveats instead of silently researching
forever. Stored run data remains the authority on what Cante already checked;
web findings must be labelled as web context.

**Chat history lives under Chat in the main sidebar.** There is no second chat
rail now. Conversation links route through `/chat?conversationId=...`, and the
client chat panel adopts the selected conversation from that query param. New
conversations dispatch `cante:conversations-updated` so the nested sidebar list
refreshes without a full reload.

**Memory is its own bottom sidebar button and main screen.** `/memory` renders
the editable memory list as full-width cards, with the same add / confirm /
delete actions. Keep this separation: memory feeds future checks, so it needs
room to scan and verify instead of being buried in chat chrome.

**Checklist is its own main screen.** `/checklist` renders the living compliance
checklist generated from customer profile, memory, KBLI records, and source-pack
coverage. It is intentionally operational: KBLI, HS code, OSS, SNI, tax/customs,
regional Perda, and memory-review rows with status, priority, evidence, and open
questions. It can mark a row complete or back to review, but the refresh logic
will continue to surface unverified facts as `needs_review`.

**Operations is its own sidebar group**, below the regulation screens, holding
Work queue, Catalogue, Documents, and Suppliers. The split is the point:
everything in the top nav describes regulations, everything in Operations
describes the customer's business, and an alert is what happens where they meet.

Three display rules carry rule 2 into these screens and must not be softened:

- Every classification code shows a **tier badge**. Without it a CSV guess and a
  PEB-verified code look identical.
- An exposure figure is **never shown without its basis lines**, and
  "not calculable from what is on file" is its own rendered state — never a zero.
- A supplier with no screening on record renders **"never screened"**, and a
  failed screen renders its error. Neither may look like `clear`.

New CSS lives at the end of `globals.css` under an Operations comment and uses
only existing tokens — no new palette, still no Tailwind.

**LLM provider switcher lives at the bottom of the sidebar.** It shows Claude
Code, Codex / ChatGPT, and Hosted API health. Only healthy providers can be
selected. This exists for rate-limit fallback, but still obeys rule 1: Codex is
via local CLI login, not OpenAI API billing.

⚠️ **Don't run `npm run build` while `npm run dev` is running** — the build
overwrites `.next` underneath the dev server and it starts serving stale CSS with
no error. Symptom: edits to `globals.css` silently don't appear. Fix: kill dev,
`rm -rf .next`, restart.

## Scheduling and delivery (added 17 Aug 2026)

`npm run check` is for a human at a terminal. `npm run check:scheduled` is for
07:00 with nobody watching, and the entire difference is failure handling.

**The rule this layer exists to enforce: silence must never be ambiguous.** A
monitor that goes quiet when it breaks teaches its reader that no message means
all clear — which is the most expensive way this product can fail, and it is a
delivery bug rather than a judgment bug. So every outcome produces a message,
including the failures, and the exit code tells cron what happened:

| Exit | Meaning |
|---|---|
| 0 | Ran, delivered (or skipped because no channel is configured) |
| 1 | Setup problem — no customer, or `--verify` found the bot unusable |
| 2 | The check crashed or ended non-`complete`; a failure notice was sent |
| 3 | The check ran but a *configured* channel refused the message |

`alerts.deliveryStatus` distinguishes four states, and the distinction is
load-bearing:

- `pending` — written, nothing attempted yet
- `skipped` — **no channel configured; nobody tried.** Legitimate during the
  pilot, where the last mile is deliberately manual
- `failed` — attempted and rejected. `deliveryError` keeps the reason verbatim,
  `deliveryAttempts` counts
- `delivered` — arrived, with `deliveredAt`

Collapsing `skipped` and `failed` would report a broken bot as a quiet day.
`deliveryHealth()` counts consecutive failures so a channel that has been dead
for a week is visible rather than merely absent.

**Telegram is for the operator, not the customer.** Indonesian businesses live
on WhatsApp, and the WhatsApp Business API needs Meta approval, a verified
business and per-message fees — none of which belongs in a 14-day pilot.
Telegram is free and needs one BotFather token. The pilot shape is: Telegram
notifies the operator, the operator forwards on WhatsApp. Nothing in
`lib/delivery/` should ever be described as delivering to the customer.

Messages are sent as **plain text**, not Markdown: Telegram's parser rejects
unescaped `_`, `*`, `[` and `.`, which appear constantly in regulation numbers
and URLs, and one parse error would drop the whole alert. Long alerts chunk on
line boundaries at the 4096-character ceiling — a truncated coverage caveat is
worse than a second message.

### What Telegram actually receives is a digest, not the alert

`dispatchRun()` sends `formatTelegramDigest(runId)`, **not** `alert.body`. They
are different documents and the distinction matters:

| | Telegram digest | `alert.body` (dashboard) |
|---|---|---|
| Audience | the operator | the customer, after manual forwarding |
| Language | English | Indonesian (or English for US) |
| Content | run header, flagged/noted titles, per-source ✓/✗ list | the model's message **plus every coverage caveat** |

This fits the pilot shape already described above — Telegram notifies the
operator, the operator forwards on WhatsApp — and the digest does carry the
thing that matters most operationally: **every failed source is listed with its
error**, so a broken feed is visible at a glance.

⚠️ **The digest omits coverage caveats, so it must never be forwarded to a
customer as-is.** On run `4a28d566` the digest read "17/18 sources OK · 0
flagged · 1 to look at", which is true and still substantially more complete
than the run was: the alert body for the same run disclosed **41 of 62 fetched
entries went unjudged**. Nothing in the digest says so. That is acceptable for
an operator who opens the dashboard, and actively misleading if pasted onward.
Either keep forwarding from the dashboard, or teach the digest to carry the
unaccounted count before anyone forwards it directly.

### Chat: the model must not talk about its own tooling

`app/api/chat/route.ts` carries a "Memory and Persistent Facts" block in both
system prompts. It exists because rule 3 denies the spawned CLI every write
tool, so when a user said "remember this", the model correctly found it had no
`Write` tool and said so — surfacing Claude Code internals to a customer and
implying the fact was lost. Both are wrong: `extractMemories()` persists facts
to SQLite after the turn, and the CLI's own file tools were never the mechanism.
The block tells the model that memory is database-backed and automatic, and
forbids mentioning file tools or agent internals. Keep that pairing in mind —
denying a tool changes what the model *says*, not just what it can do.

### Trade Compliance Action Suite & Sourcing Architecture (added 19 Aug 2026)

**1. Customer profiles (`config/customer.json`)**
The bundled profile is a fictional domestic manufacturer in the United States.
Configure actual operations and trade lanes before monitoring a real tenant.
Indonesian profiles support both domestic obligations and import/export rules.

**2. INSW / NTR (National Tariff Repository) & LARTAS (`lib/tariff/insw.ts`)**
Maps BTKI / HS codes to authoritative duty rates and restrictions:
- **Taxes & Tariffs:** Bea Masuk (BM MFN and FTA preferential rates), PPN (11%), PPh Pasal 22 Import (2.5% with API / 7.5% without API), and Bea Keluar (BK).
- **LARTAS Restrictions:** PI TPT, PI B2 (Bahan Berbahaya), Laporan Surveyor (LS Import), Surat Pengecualian B3 / KLHK non-hazardous letters, and Border vs Post-Border inspection tracking.
- **Import Tax Calculator:** Computes exact landed tax exposure:
  $$\text{Bea Masuk} = \text{CIF} \times \text{BM}\%$$
  $$\text{Nilai Impor} = \text{CIF} + \text{Bea Masuk}$$
  $$\text{PPN} = \text{Nilai Impor} \times 11\%$$
  $$\text{PPh 22} = \text{Nilai Impor} \times 2.5\% \text{ (or } 7.5\%\text{)}$$
  $$\text{Total Pajak Impor} = \text{BM} + \text{PPN} + \text{PPh 22}$$

**3. Automated Action Drafter (`lib/workflow/draft.ts`)**
Generates 3 communication drafts for any flagged finding or regulatory change:
- **📱 PPJK (Customs Broker) WhatsApp Draft:** Natural Bahasa Indonesia message citing regulation reference, HS code, and specific operational verification questions (PI quota validity, surveyor inspection at port of origin, PIB billing adjustments).
- **📋 Internal Ops Checklist (No PPJK):** Step-by-step checklist for factories managing clearance directly without a broker (verifying OSS/INSW quota balance, supplier technical document readiness before vessel departure, and customs billing).
- **✉️ Foreign Supplier Inquiry:** Formal English inquiry requesting updated Certificate of Analysis (COA), Certificate of Origin (Form E/AK/D), Non-B3 statement, or SDS with chemical CAS numbers.

**4. US Trade Controls & Remedies (`lib/screening/us-trade-controls.ts`)**
Evaluates US shipments against:
- **Section 301 / 232:** Additional 7.5% - 25% China tariffs on polymers, textiles, and chemicals.
- **AD/CVD Scope:** Antidumping and countervailing duty orders on PVC sheeting, vinyl flooring, and polyester yarns from East/Southeast Asia.
- **UFLPA:** Rebuttable presumption forced labor screening on PVC polymers and synthetic textile supply chains.
- **PGA:** EPA TSCA Section 6/13 positive certification statements and CPSC flammability compliance.

**5. Work Queue UI Integration (`components/workqueue/workqueue-panel.tsx`, `app/api/workqueue/route.ts`)**
- Added 1-click copy buttons (`📱 Copy PPJK WhatsApp`, `📋 Copy Ops Checklist`, `✉️ Copy Supplier Inquiry`) to each finding card in the work queue.

**6. US Trade Compliance & Enforcement Suite (`lib/screening/`, `lib/tariff/`, `lib/substances/`, `lib/workflow/`)**
- **ISF 10+2 Pre-Arrival Compliance ([`lib/screening/us-isf.ts`](file:///Users/a/Desktop/cante/lib/screening/us-isf.ts))**: Enforces 19 CFR 149 24-hour pre-loading transmission deadlines for ocean shipments and calculates $5,000 liquidated damages risk per violation.
- **USMCA Rules of Origin Engine ([`lib/tariff/usmca.ts`](file:///Users/a/Desktop/cante/lib/tariff/usmca.ts))**: Evaluates Chapter/Heading/Subheading Tariff Shifts (CC, CTH, CTSH), computes Regional Value Content (RVC Transaction Value and Net Cost methods), and produces compliant 9-element USMCA Origin Certifications.
- **Dual-Use Export Controls & ECCN Screener ([`lib/screening/us-export-controls.ts`](file:///Users/a/Desktop/cante/lib/screening/us-export-controls.ts))**: Determines ECCN (Commerce Control List Categories 0-9) vs EAR99, evaluates Country Group matrix licensing (15 CFR 740 Supp. 1), and blocks comprehensive embargoed destinations (Cuba, Iran, North Korea, Syria).
- **EPA TSCA PFAS & CA Prop 65 Controls ([`lib/substances/us-chemical-controls.ts`](file:///Users/a/Desktop/cante/lib/substances/us-chemical-controls.ts))**: Identifies EPA TSCA Section 8(a)(7) reportable PFAS, verifies TSCA Section 6 PBT prohibited flame retardants (DecaBDE, PIP 3:1), and formats California Prop 65 safe harbor warning copy for plasticizers (DINP, DEHP).
- **CBP Form 28 / Form 29 Response Drafter ([`lib/workflow/us-cbp-response.ts`](file:///Users/a/Desktop/cante/lib/workflow/us-cbp-response.ts))**: Generates formal legal response letters to CBP Port Directors and Import Specialists citing General Rules of Interpretation (GRI 1, GRI 3(b) Essential Character, GRI 6) and binding CROSS ruling precedents.

**7. Enterprise Core Suite (`lib/documents/`, `lib/tariff/`, `lib/workflow/`)**
- **Document Cross-Check & Discrepancy Engine ([`lib/documents/discrepancy.ts`](file:///Users/a/Desktop/cante/lib/documents/discrepancy.ts))**: Cross-references Commercial Invoice, Packing List, Bill of Lading, COA, and COO to detect HTS mismatches, Net > Gross weight discrepancies, Incoterm/freight conflicts, missing chemical CAS numbers, and container discrepancies.
- **Live Quota & Permit Ledger ([`lib/tariff/quota-ledger.ts`](file:///Users/a/Desktop/cante/lib/tariff/quota-ledger.ts))**: Tracks government-allocated import/export quotas (PI Bahan Baku, PI TPT, PI B2), deducts realized shipments, calculates monthly burn rates, and issues 60/30/14-day renewal alerts.
- **Customs Post-Clearance Audit Vault ([`lib/workflow/audit-vault.ts`](file:///Users/a/Desktop/cante/lib/workflow/audit-vault.ts))**: Compiles 1-click sealed "Reasonable Care" defense dossiers for Bea Cukai Audit Pabean and US CBP Focused Assessments.

**8. UI/UX Architecture & Chat Auto-Sync Engine**
- **AI Copilot Landing as Primary Entry**: Root `/` routes directly to the AI Copilot (`/chat`), welcoming users with an interactive, context-grounded conversational agent.
- **Categorized Sidebar Hierarchy ([`components/dashboard/sidebar.tsx`](file:///Users/a/Desktop/cante/components/dashboard/sidebar.tsx))**:
  - *AI Assistant*: AI Copilot (`/chat`)
  - *Compliance & Action*: Checklist & Permits (`/checklist`), Action Work Queue (`/workqueue`), Daily Checks & Feeds (`/checks`)
  - *Company & Operations*: Company Profile (`/profile`), Product Catalogue (`/catalogue`), Shipment Documents (`/documents`), Suppliers & Evidence (`/suppliers`)
  - *Intelligence*: Memory & Facts (`/memory`)
- **Chat Auto-Sync (`lib/checks/remember.ts`)**: Automatically extracts durable facts stated in chat and populates them directly into `products` (Catalogue), `kbliRecords`, `suppliers`, and triggers immediate `refreshChecklistForCustomer`.

**9. Future Enterprise Roadmap (Deferred External Connectors)**
- **ERP & PO Sync Connectors**: Direct webhooks and ingestors for SAP, NetSuite, Oracle, and Indonesian ERPs (Accurate, Jurnal) to evaluate purchase orders before issuance.
- **Direct Push Notification Connectors**: Interactive Slack App, Microsoft Teams bot, and official WhatsApp Cloud API integration for operational approvals.
- **Cloud SaaS Migration**: PostgreSQL / AWS RDS migration, SSO (Okta, Azure AD SAML), and SOC 2 Type II compliance audit trails.

### Setting it up

Secrets live in **`.env`**, which is gitignored. `scripts/load-env.ts` is
imported first by both check scripts and calls `process.loadEnvFile()` (built
into Node 22 — no dependency), so the same file serves the terminal, launchd and
cron alike.

This is not convenience. A LaunchAgent inherits **no** shell environment — no
profile, no exports. Without the loader, a scheduled run silently loses
`TELEGRAM_BOT_TOKEN` and records every alert as `skipped`, while testing
perfectly by hand. Real environment variables still win, because `loadEnvFile`
never overwrites a value that is already set.

```bash
# 1. Token from @BotFather, chat id from @userinfobot
cat > .env <<'ENV'
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=987654321
CANTE_HEARTBEAT_URL=https://hc-ping.com/your-uuid
ENV
chmod 600 .env

# 2. Press Start on your own bot first — Telegram forbids a bot messaging
#    anyone who has not opened a conversation with it.

# 3. Confirm before trusting it nightly
npm run check:scheduled -- --verify   # want: "Telegram OK — bot @yourbot"
```

The LaunchAgent then carries **no secrets at all** — it only needs to `cd` into
the repo so `.env` resolves.

**Schedule with `launchd`, not `cron`, on macOS.** launchd runs a missed
`StartCalendarInterval` job **on wake**; cron silently skips it. For a machine
that sleeps — which is every laptop — that difference is the whole job. It
needs no `EnvironmentVariables` block for tokens because `scripts/load-env.ts`
reads `.env` once the working directory is the repo.

⚠️ **`zsh -lc` does NOT load `.zshrc`, and this broke the first live run.**
`-c` makes the shell non-interactive; login shells only source `.zshrc` when
interactive, `-l` alone does not do it. Both nvm's Node (`.nvm/versions/node/
vX/bin`) and the `claude` CLI (`~/.local/bin`) get onto `PATH` via lines in
`.zshrc` here, so a naive `/bin/zsh -lc "cd … && npm run check:scheduled"`
silently ran the wrong `npm` (a Homebrew-installed Node 26, not the tested
Node 24) and then failed with `spawn claude ENOENT` once PATH was fixed halfway.
Fix: export `PATH` explicitly inside the plist command rather than relying on
shell startup files:
```xml
<string>export PATH="$HOME/.nvm/versions/node/vX.Y.Z/bin:$HOME/.local/bin:$PATH"; cd /path/to/cante && npm run check:scheduled</string>
```

⚠️ **A project under `~/Desktop` (or Documents/Downloads) needs Full Disk
Access granted to the interpreter, not just the terminal.** Those folders are
TCC-protected; Terminal.app is normally granted access the first time it asks,
but a process `launchd` spawns directly is a different, unprivileged identity
and gets a silent `EPERM: process.cwd failed with error operation not
permitted, uv_cwd` — indistinguishable from a Node bug, and identical across
Node versions, which is what proved it wasn't one. Fix: System Settings →
Privacy & Security → Full Disk Access → add both `/bin/zsh` and the actual
`node` binary path, toggled on. No code change fixes this; it is host
configuration and must be redone on every new machine — including the second,
always-on Mac in `HANDOFF.md`.

Verified 18 Aug 2026 end to end on `com.cante.dailycheck`: after both fixes,
run `76285f64-576c-48f3-9d78-b17a5ad002cb` fetched 13/13 Indonesian sources,
produced a quiet (0 flagged, 0 noted) result, and delivered to Telegram in one
message — confirming the full `launchd` → `.env` → `claude` CLI → Telegram path
works unattended, not just interactively.

Verified 17 Aug 2026: `~/Library/LaunchAgents/com.cante.dailycheck.plist` runs
`/bin/zsh -lc "cd /Users/a/Desktop/cante && npm run check:scheduled"` daily at
07:00 via `StartCalendarInterval`, with `StandardOutPath`/`StandardErrorPath`
at `~/Library/Logs/cante-dailycheck.log` and `RunAtLoad` false so loading it
does not immediately fire a real Telegram send. `launchctl load` registered it
successfully (`launchctl list` showed `com.cante.dailycheck` with status `0`).
The `--verify` Telegram round-trip was confirmed working the same day after the
initial `chat not found` error (bot not yet started by the user) was resolved.

**Not GitHub Actions.** Two independent blockers: a runner cannot use the local
Claude Code login (so it needs an API key, breaking rule 1), and runners are
ephemeral while `cante.db` holds the run history and the seen-log that stops a
regulation being reported twice. Scheduled workflows are also routinely delayed
and are auto-disabled after 60 days of repo inactivity.

### The dead-man's switch

`notifyRunFailure()` covers a check that ran and broke. It cannot cover **the
machine being off** — power cut, OS update reboot, unplugged laptop — and that
produces exactly the silence this layer exists to prevent.

So a successful run POSTs to `CANTE_HEARTBEAT_URL` and a failed one POSTs to
`<url>/fail`. If the ping stops arriving, the watcher tells you from
infrastructure the Mac cannot take down with it. Any provider works
(Healthchecks.io, Better Stack, Cronitor). Unset the variable and the mechanism
disappears entirely.

Heartbeat errors are swallowed on purpose: a watcher that is unreachable must
never turn a healthy run into a failed one.

⚠️ **Cron does not solve rule 1.** The check still runs through the local
`claude-code` CLI, so the machine must be awake and logged in. Running it on a
server means implementing `lib/llm/api.ts` and accepting API spend — roughly
$4/month, half that on the Batch API. That decision is the user's and has not
been made; nothing here presumes it.

## Memory

Two separate things, both new:

**Conversations** (`conversations` + `chat_messages`) — saved chats, listed under
Chat in the main sidebar, reopenable. History is read **from the database**,
never trusted from the client. The CLI has no session of its own, so prior turns
exist only because we put them in the prompt; before this the chat couldn't
answer "what did I just ask?".

**Memory** (`memories`) — durable context about the customer, scoped by
`customer_id`. Read by the chat **and by `lib/checks/judge.ts`**, which is the
entire point: memory only the chat sees changes nothing about the product, while
memory the daily check sees makes every future alert sharper. This is the path
that finally fixes the unconfirmed-HS-code gap.

`confirmed` carries the same discipline as `customer_profiles.hsCodesConfirmed`:

- Model-extracted memories (`origin: "chat"`) always land **`confirmed: false`**.
- Hand-entered ones (`origin: "manual"`) are confirmed — a person typed them.
- `renderMemoryForPrompt()` renders the two groups under separate headings, and
  both consumers use it, so chat and judgment can't develop different ideas
  about what counts as established.
- Promotion to confirmed is a human click on the Memory page. Never automate it.

### HS codes have three tiers, and confusing them is a bug

`lib/checks/facts.ts` resolves conflicts between seed-time guesses and
human-confirmed memories. A prompt must not assert both sets as established facts.

| Tier | What it means | Who may call it verified |
|---|---|---|
| `document` | Read off a real PEB/invoice. This is what `hsCodesConfirmed` means. | Yes |
| `human` | A person clicked confirm in Memory. Better than a guess; still not paperwork. | No |
| `lead` | Model-extracted from chat, unconfirmed. | No |
| `guess` | Seeded from the product description. **Superseded** once any `document`/`human` code exists — do not judge against it, do not repeat it to the customer. | No |

`resolveHsCodes()` + `renderHsCodesForPrompt()` produce that block for the
judgment stage, and `lib/checks/checklist.ts` uses the same resolver — which is
why "Confirm HS codes from PEB or invoice" is `needs_review` again. It had gone
`completed` on a Memory click, which is exactly the row's whole point missed.
Only a document closes it. `resolveKbliCodes()` does the same job for KBLI.

Extraction (`lib/checks/remember.ts`) runs **after** the answer has streamed and
after the SSE response has closed, so it costs the user no latency and cannot
keep the composer disabled. It now extracts KBLI, OSS/NIB/licensing, SNI, tax,
and location facts in addition to HS/product/market/contact facts. When it saves
anything new, it calls `refreshChecklistForCustomer()` so the checklist updates
from chat memory. Manual memory add / confirm / unconfirm / delete does the same
through `/api/memories`. It swallows its own failures — a missed memory is a
small loss, a broken chat is not. It is told that an empty result is the correct
and common answer.

Verified end to end: told the chat a real HS code in one conversation, then asked
from a **fresh** conversation — it recalled it and volunteered "an unverified
lead from chat, not human-confirmed", and separately noted the stored runs still
used the guessed codes.

## Source realities (tested, not assumed)

| Source | Status | Note |
|---|---|---|
| `jdih.kemendag.go.id` | **working** | Polled in three views: `semua`, `ekspor`, `perizinan`. |
| `jdih.setneg.go.id/api/hukumproduk` | **working** | No-auth JSON API. Cante exhausts every page for the current and prior year across UU, Perpu, PP, Perpres, Keppres, and Inpres. Latest source-only probe parsed 263 records. |
| `jdih.kemenkeu.go.id/home` | **working** | Polled for PMK/customs/duty/tax entries; latest smoke test parsed 7 entries. |
| `peraturan.beacukai.go.id` | **working** | Official DJBC newly-added regulation listing; latest probe parsed 10 records. A malformed displayed year is corrected only when the official URL carries the coherent year, with a parse caveat. |
| `pajak.go.id/peraturan` | **working** | Official DJP regulation listing; latest probe parsed 5 records. |
| `jdih.kemenlh.go.id` | **working** | No-auth JSON API with legal dates and official PDFs; latest probe parsed 30 records. |
| `jdih.kemnaker.go.id` | **working** | Official latest-regulation HTML listing; latest probe parsed 15 records. |
| `gw.oss.go.id/v2/portal/kbli/version` | **working** | No-auth JSON gateway used by the official OSS frontend. Reports published KBLI catalogue versions as a heartbeat; specific KBLI mapping still requires confirmed codes. |
| `jdih.surabaya.go.id/peraturan/ajax` | **working** | No-auth JSON listing. Cante exhausts current/prior-year pagination; latest probe parsed 123 records. Activated for Surabaya operations. |
| `lh.surabaya.go.id/weblh/data-pengumuman-dokumen` | **working** | Official AMDAL/UKL-UPL/DELH/DPLH notices in a rolling 45-day window; latest probe parsed 13 records. |
| `peraturan.bpk.go.id` | **blocked** | Confirmed bot detection. Manual lookups only, never automated — and not a bypass candidate: its `robots.txt` (checked 17 Aug 2026) explicitly disallows `ClaudeBot` by name alongside the standard AI-crawler blocklist (GPTBot, CCBot, Bytespider, etc.), a direct statement that this operator does not want Claude-driven automated access. It is also broader than "BPK's own regulations" — it aggregates UU/PP/Perpres, ministry Permen/Kepmen, and Perda/Pergub/Perwali from many agencies, so losing it is a real coverage gap, not a niche one. The fix is ministry-specific portals (e.g. `jdih.kemenperin.go.id` for manufacturing regulations), not a replacement aggregator. |
| `jdih.kemenperin.go.id` | **blocked — long-dead, not transient** | Ministry of Industry's own JDIH — the ministry responsible for industrial policy. Checked 17 Aug 2026 (`ECONNREFUSED` 202.47.80.10:443); re-checked 18 Aug from **three vantage points**: this machine (timeout, both ports), Anthropic's fetch infrastructure (`ECONNREFUSED`), and the Wayback Machine's crawlers — whose **last successful capture is February 2024** (SIINas: April 2024). The entire `kemenperin.go.id` web presence (JDIH, SIINas, main site) has been dark to the outside world for ~2 years; `api.` subdomain doesn't resolve. Do not wait for recovery. The one live host found, `itjen.kemenperin.go.id` (Inspectorate General, HTTP 200, server-rendered), was probed and **rejected as coverage**: its Permenperin list is 8 curated internal-governance entries spanning 2010–2025 (kode etik, SAKIP, pengawasan intern) — a false heartbeat for industrial-policy coverage. ⚠️ Web search also surfaces `jdih.kementrianhukumdanham.com` and `jdih.kemenkumhamri.com` — misspelled `.com` squats of official JDIH sites; never treat these as sources. The realistic route is pasal.id's authenticated API (below). |
| `peraturan.go.id` | **unreachable from here — but alive** | Not a dead host: Wayback recorded HTTP 200 crawls through 24 Apr 2026, and pasal.id crawls it daily from Southeast Asia. It times out from this machine and from Anthropic's fetch infrastructure, so this is a geo/network restriction. Still not polled: it publishes **only PDFs** (no search, no structure, no API), so using it needs an Indonesian egress path *and* the PDF/OCR pipeline this project declines to build. Superseded for six national instrument types by Setneg; reached second-hand for Kemenperin via pasal.id. |
| `jdihn.go.id` | **blocked** | The old central host times out and the replacement is not a dependable public document API. Member ILDIS feeds remain an expansion route. |
| East Java JDIH (`jdih.jatimprov.go.id`) | **blocked** | Works interactively but Cloudflare rejects unattended fetches — reconfirmed 17 Aug 2026 with a plain `fetch()` matching production headers (HTTP 403, Cloudflare challenge page). Not retried directly; superseded by the row below. |
| East Java JDIH (`api.jdih.jatimprov.go.id`) | **working** | Discovered 17 Aug 2026: same JDIH Jatim CMS, served from this subdomain without the Cloudflare challenge — confirmed with a real `fetch()` from this machine, not a proxy. Four views (`peraturan-daerah`, `peraturan-gubernur`, `keputusan-gubernur`, `instruksi-gubernur`) all returned HTTP 200 with genuine 2026-dated content; the Kepgub probe parsed 7 anchors, 6 real entries and 1 false positive (a news article whose headline cited a Perda by number — `looksLikeRegulation()` matches link text only, so this is a known, disclosed limitation, not a regression). `surat-edaran` (circulars) was checked at the equivalent slug and does not exist on this host (404); that gap stays manual. |
| `pesta.bsn.go.id/produk` | **working** | Live probe parsed 19 SNI records. Server-rendered HTML, not a public API; one retry handles transient transport/server failures. |
| `pasal.id/api/v1/laws` | **working — private re-publisher, NOT official** | The only route to Kemenperin, whose own JDIH is dead and whose official record (`peraturan.go.id`) is unreachable from here. Authenticated (`PASAL_API_TOKEN`); live run parsed 23 Permenperin 2026 rows. Every row is the publisher's unreviewed parse and the API carries **no date** — dates are filled in separately by `lib/sources/pasal-dates.ts`. Never present its entries as an official record; see the pasal.id sections below. |

**`pasal.id` — evaluated 17 Aug 2026, not integrated.** A private/commercial
Indonesian legal database (177k+ regulations, 3.84M structured articles, 1945–
2026), not an official government service — it re-publishes "publikasi resmi
lembaga negara" rather than being one. It offers a real REST API
(`pasal.id/api/v1/search`) and an MCP integration, gated behind an account (an
unauthenticated probe returned `401`); free tier is 5 lookups/day. Worth
revisiting as a **cross-check or gap-filler** — e.g. for BPK's aggregated
content now that the official aggregator is off the table — but it cannot
replace an official source under rule 2: judgment and the customer-facing
alert need to know when a fact came from a private re-publisher rather than
the primary government record, so any future integration must carry that
label through, not blend it in as if it were `jdih.kemendag.go.id` or Setneg.

**Re-evaluated 18 Aug 2026 — API docs read in full, integration is a go once
the user creates a token.** The user explicitly asked for unofficial routes to
the blocked/dead sources, which is the green light the paragraph above was
waiting for. What the docs (`pasal.id/api`) establish: `GET /api/v1/laws?type=
&year=&status=&limit=&offset=` is a **paginated listing feed** — `type=PERMEN
&year=2026` filtered client-side for "Perindustrian" is the Kemenperin gap
closed in 2–3 calls/day; type codes also cover `KEPMEN`, `SE`, `PERDA_PROV`,
`PERGUB`. `GET /api/v1/laws/{frbr_uri}` returns full metadata plus
`relationships` with `Mengubah`/`Amends` edges (maps directly onto
`lib/checks/lifecycle.ts`), and rows carry `content_verified` plus a
`verification.tier` of `automated_source` vs `human_golden` — the same tier
discipline this project uses, so the label can be carried through faithfully.
Auth is `Authorization: Bearer` or `x-api-key`; token is created free at
`pasal.id/akun` — **an account only the user can create**. On access ethics:
pasal.id's robots.txt disallows `ClaudeBot` (crawling), but the authenticated
API is the operator's own sanctioned integration surface — its 401 error
literally instructs you to sign up and points at the docs. Being an API
customer is not crawling. `peraturan.bpk.go.id` remains off-limits entirely.
**Built and live-verified 18 Aug 2026.** The user created the token; the
adapter is `kemenperin-pasal` in the registry with parser `pasal-laws-json`.
Live end-to-end through `fetchAllSources()`: **23 Permenperin rows for 2026,
zero failures**, including 8 mandatory-SNI / revocation rules
(`Pemberlakuan Standar Nasional Indonesia`, `Pencabutan …`) that Cante was
previously blind to — this is the ministry responsible for industrial policy.

⚠️ **This is the only non-official regulation source in the registry**, and
four mechanisms keep it from reading like an official one. Do not weaken any
of them:

1. **`RegulationEntry.provenance`** is a new optional field, set *only* by
   this parser and serialized straight into the judgment prompt. It carries
   pasal.id's own `verification.tier` verbatim. Every observed Kemenperin row
   is `parsed_unreviewed` with `content_verified: false` — the publisher
   stating nobody reviewed the parse, which makes it the weakest evidence in
   the system. Official sources set no `provenance` at all, because saying
   nothing there is correct: Setneg and Kemendag *are* the record. Both
   Indonesian and US judgment prompts now explain the field and require the
   customer-facing message to name the private re-publisher and prefer
   "worth a manual look" over asserting an obligation.
2. **Dates come from a separate enrichment step, never from the listing.**
   See the section below — the API returns no date, so `lib/sources/pasal-dates.ts`
   fills them in and `effectiveOn` still stays `null`.
3. **`issuing_body=permenperin` is load-bearing, and the parser re-checks
   it.** `type=PERMEN` alone is not a Kemenperin filter — a live probe
   returned an unrelated *Keputusan KPU* under it. Rows whose issuing body
   is not the requested one are dropped rather than counted as ministry
   coverage.
4. **The citation URL is built from the returned `frbr_uri`, never guessed.**
   `https://pasal.id` + `frbr_uri` was verified to return HTTP 200, while
   the slug-shaped `/peraturan/…` forms 404. The detail endpoint's
   `source_url` names `peraturan.go.id` as pasal.id's own upstream.

### What pasal.id actually is (source read 18 Aug 2026)

It is **open source** — `github.com/ilhamfp/pasal`, AGPL-3.0, cloned to
`pasal-main/` (gitignored, and **excluded in `tsconfig.json`** — it ships a
full Next.js 16 app whose 131 TS files broke `npx tsc --noEmit` until it was
excluded, the same trap `mike-main` and `uigen-claude` document). Reading the
pipeline settles several things guesswork could not:

- **It stores its own copy.** A Python worker crawls `peraturan.go.id` listing
  pages → seeds a `crawl_jobs` queue → downloads each PDF → extracts text with
  PyMuPDF → deterministic OCR correction → a regex state machine parses
  BAB/Pasal/Ayat structure → loads into Supabase Postgres. It is not a
  passthrough proxy, so its freshness is its crawler's freshness, not the
  government's.
- **It refreshes daily.** `discovery_progress` caches per regulation type with
  a **24-hour** TTL, and the Railway service runs `worker.run continuous` in a
  permanent discover → process → sleep loop. So a daily Cante run is well
  matched to a source that re-discovers about that often.
- **It is not a bulk dump.** There is no snapshot to download; retrieval is
  page-by-page crawling. The REST API is the only sane integration surface,
  which is what Cante uses.

⚠️ **`content_verified: false` / tier `parsed_unreviewed` is narrower than it
sounds, and knowing this matters.** Migration 009 defines `content_verified` as
"whether any human has verified the parsed **content** matches the source PDF"
— it is about `document_nodes.content_text`, the PDF-extracted article body.
**Cante consumes none of that.** Cante reads title, number, year, and issuing
body, and `worker/discover.py` builds those by scraping the listing page's
anchor text and parsing the URL slug — no PDF, no OCR anywhere in that path.
So the weak tier attaches to the part Cante does not use, while the part it
does use is a deterministic HTML scrape. The provenance label stays as written
regardless: it is still second-hand, and the judgment prompt should still hedge.

**This also explains the KPU row that justified the `issuing_body` filter.**
`_infer_type_from_prefix()` ends with `# Safe default: most regulations on
peraturan.go.id are ministerial` and returns `PERMEN` for any unrecognised slug
prefix. `kepkpu` is unrecognised, so a Keputusan KPU is *typed* as PERMEN at
crawl time. The pollution is structural and permanent, not a one-off — the
parser's issuing-body check is load-bearing and must stay. The same slug
parsing explains malformed numbers like `pmk11`: `SLUG_RE` captures whatever
sits between `-no-` and `-tahun-`.

### Enactment dates: `lib/sources/pasal-dates.ts` (added 18 Aug 2026)

The pasal.id API returns **no date field anywhere** — not in `/laws`, not in
`/laws/{frbr_uri}`, and not through any MCP tool (`get_law_context` accepts only
`summary` / `outline` / `relationships`, all checked live). Only `year`. That
breaks the oldest rule here — never assert recency from a listing alone — in a
harder form than Kemendag, where at least a detail page carries the real date.

**The dates exist; they were just not exposed.** pasal.id's crawler scrapes them
off peraturan.go.id's detail-page tables into `works.tanggal_penetapan` /
`tanggal_pengundangan` (migration 018, written by `_extract_metadata_from_soup()`
in `worker/process.py`), and **its own web page renders them**. Verified on
Permenperin 22/2026: *Penetapan: Jakarta, 15 Juli 2026*, *Pengundangan:
31 Juli 2026*, *LN 2026 No. 529*.

Both halves of the fix were done, on the user's instruction:

1. **`enrichPasalDates()` reads them from the rendered page.** It parses the
   `<dt>Penetapan</dt><dd>…</dd>` definition list, which deliberately ignores
   the React server payload earlier in the document — that payload also carries
   the UI's *translation bundle*, where the word "Penetapan" appears as a label
   with no date attached, and a looser match would happily read it.
2. **An upstream request is drafted at `pasal-upstream-issue.md`** (not filed —
   `gh` is unauthenticated and it posts under the user's identity). It asks them
   to expose the two columns they already populate.

Four properties matter:

- **It runs after the ledger diff, not in the parser.** `runCheck()` calls it
  once `report.regulations` has been narrowed to new/changed entries, so only a
  handful cost a lookup rather than the whole year every day. At ~23 Permenperin
  a year, steady state is roughly two fetches a month. Live: 4/4 resolved in 6s.
- **It writes `datesNote`, not `effectiveOn`** — the same choice the Setneg
  parser already makes with these two dates. Signing and promulgation say when a
  rule was *made*; the date it takes legal *effect* is set by its own closing
  article and can be later. `effectiveOn` stays `null` because no source here
  established it, and the note says so in as many words.
- **It cannot fail a run.** Every error path leaves the entry exactly as
  dateless as it already was and appends a code-written caveat. Lookups are
  capped at 25/run so a bad ledger diff can never become a crawl.
- **It is forward-compatible.** `parsePasalLawsJson()` already reads
  `tanggal_penetapan`/`tanggal_pengundangan` if they ever appear, and
  `enrichPasalDates()` skips entries that already carry dates. The day upstream
  merges, the date arrives free and this module quietly does nothing. There is a
  test pinning that contract.

The judgment prompt was updated to match: it now says to read `datesNote` and
reason from a date when present, treat its absence as "year only, do not imply
recency", and never present a promulgation date as an effective date.

**Verified in a real run, 18 Aug 2026** — `725945ce-a124-4ad1-b2f5-af07040d069b`,
not just a probe. The source fetched 23 Permenperin, the ledger baselined 13 and
sent 10 into judgment, `[pasal-dates] 10 of 10 enactment dates resolved`, and all
10 came back `clear` — correctly, since they cover safety glass, wheat flour,
palm cooking oil, halal certification, aircraft-repair imports and agro
machinery, none of which touch PVC tarpaulin. The one-line quiet alert also
landed as designed: `*Aman* — tidak ada yang baru atau relevan buat Example Company hari
ini.`

⚠️ **A stale caveat shipped with it, and it is the exact failure rule 2 exists to
catch — in reverse.** The selection caveat still read "pasal.id tidak memuat
tanggal penetapan maupun pengundangan sama sekali, hanya tahun", written before
the enrichment existed. So the same alert that logged 10 of 10 dates resolved
also told the customer no dates were available. A caveat that *understates*
coverage is as much a lie as one that overstates it, and it is easier to miss
because it reads as appropriately humble. Fixed to describe the separate lookup
and to keep the honest part — that a missing date means the age is genuinely
unknown, and that the closing-article effective date is still unestablished.
**When a capability lands, grep the caveats for what they claim about it**; the
prompt and the parser were updated in the same turn as the enrichment, and this
line was still missed.

⚠️ **On access ethics.** pasal.id's `robots.txt` disallows `ClaudeBot`, and the
authenticated API remains the sanctioned surface for bulk work — that is why the
listing goes through the API and only this narrow, ledger-gated, ~2/month date
lookup reads a page. The upstream issue exists precisely so this step can be
deleted. If pasal.id ever objects, delete `enrichPasalDates()`; everything
degrades to the honest "year only" disclosure it replaced.

### Kemenkeu fallback — and why East Java and BSN were refused (18 Aug 2026)

`lib/sources/fallback.ts`. `jdih.kemenkeu.go.id` — the customs, duty and tax
feed — timed out on two of the last three real runs. The alert correctly said
PMK changes went unchecked, but the customer still learned nothing about tax
exposure that day. pasal.id re-publishes the same ministry (57 PMK for 2026,
clean numbers), so a failed day can now carry a partial answer.

**It is a fallback, not a source.** Running it daily would report every PMK
twice under two URLs that dedup cannot match. `selectFallbackSources()` returns
it only when the primary actually failed *in that run*, so a healthy day costs
nothing.

**It is additive and disclosed, never a swap.** A backup that silently stood in
for an official source would convert "we could not check tax" into what reads as
a completed check — the exact rule 2 failure. The primary's failure row is left
untouched, the backup arrives as its own source with its own `provenance`, and
`fallbackCaveat()` states plainly that the official record was unreachable and
these rows are leads. There is a test asserting the caveat contains
"bukan pengganti".

**Two others were asked for and refused, on evidence:**

| Asked | Verdict |
|---|---|
| East Java | **Refused — already covered officially.** `api.jdih.jatimprov.go.id` returned 48 entries on the last run. pasal.id does carry it, under `PERDA` (53,752 all-years) and `PERGUB` (25,216) — **not** `PERDA_PROV`/`PERDA_KAB`, which are empty despite existing as type codes. Adding a private re-publisher beside a working official feed is a downgrade, not coverage. |
| BSN / SNI | **Refused — not in pasal.id at all.** Its `PERBAN` bucket holds BPOM, OJK, BSSN, BI, BMKG, Perpusnas, BPS, BRIN, BPJPH and LAN; no BSN. SNI are *standards*, not regulations: pasal.id has laws that make an SNI mandatory (e.g. Permenperin 22/2026), never the standard itself. No wiring fixes this. |

⚠️ **A type code existing in pasal.id's documented list does not mean data
exists behind it.** `PERDA_PROV`, `PERDA_KAB` and `KEPMEN` all return **0** rows
across all years. Always probe a code before building on it.

### Regional Perda by customer location (added 18 Aug 2026)

Indonesia has 38 provinces and 500-plus regencies and cities, each issuing its
own Perda. Cante had official adapters for exactly two jurisdictions — Surabaya
city and East Java province. A
customer in Sidoarjo, or one distributing into Banten, had **no regional
coverage at all**, and no route to it without hand-building an adapter per city.

`regionalPasalSources(profile, options)` in `registry.ts` generates one source
per matched region from `PASAL_REGIONS`, activated by recorded customer
locations — so a new region is a row, not an adapter. It composes with
everything already built: the parser's `issuing_body` check, `provenance`, and
`enrichPasalDates()` all key off data that is already there.

Verified live: a Surabaya-only profile activates **zero** pasal regions, while
`["Sidoarjo, Jawa Timur", "Banten"]` activates two and fetches 8 and 137
regulations.

| Rule | Why |
|---|---|
| Every slug was verified live | Coverage is genuinely patchy and **cannot be guessed from a pattern**: `perda-kabupaten-mojokerto` holds 99 while `perda-kota-mojokerto` does not exist, and Gresik has neither. A wrong slug returns `{"error":"Unknown issuing body"}` and fails the source loudly — correct, but not a discovery mechanism. |
| Officially covered regions are excluded | Surabaya and East Java have working official adapters. A re-publisher beside them duplicates findings under two URLs dedup cannot match, and downgrades the evidence. |
| A recorded location matching nothing is disclosed | It says the location is *belum dipantau sama sekali* rather than being silently absent. |

⚠️ **Regional feeds carry no `year` filter, and that is deliberate.** Sidoarjo
had **0** Perda in 2026 and 8 across all years; Banten had 0 and 137. Windowing
a regency to the current year returns nothing and reads as coverage. The feeds
fetch all years and the `source_documents` ledger decides what is new — the same
shape as the official Surabaya adapter. `refreshDynamicUrl()` therefore only
refreshes `year` on sources that already carry one, which is how ministry feeds
and regional feeds share a parser without sharing a window.

They carry `emptyStateMarker: '"total":0'` so a regency genuinely passing no
Perda is a *validated* empty rather than a silent parser failure.

⚠️ **Label bug found while wiring this up.** The parser built every label as
`Peraturan Menteri ${issuer}`, which was right for the only source that existed
at the time. A Perda whose `issuing_body.name` is "Kota Surabaya" came out as
**"Peraturan Menteri Surabaya"** — a city bylaw presented as a ministerial
regulation. Labels now come from `PASAL_TYPE_LABELS[law.type]`, so a PERDA reads
"Peraturan Daerah Kota Surabaya" and a PERGUB "Peraturan Gubernur Provinsi
Banten". Titles are also whitespace-normalised: they arrive with embedded CRLFs
from the source PDF.

### Perpajakan — where tax actually stands

Asked directly, so recorded here. Tax is one of the better-covered areas:

| Layer | Source | State |
|---|---|---|
| PMK (tax, customs, duty) | `jdih.kemenkeu.go.id` | official, **plus** the pasal.id fallback above when it fails |
| Customs and excise | `peraturan.beacukai.go.id` (DJBC) | official, working |
| Tax administration | `pajak.go.id/peraturan` (DJP) | official, working |
| Regional tax (pajak/retribusi daerah) | Perda feeds — Surabaya and East Java official, other regions via pasal.id | working |

The Kemenkeu fallback was the real perpajakan gap: that feed failed on two of
the last three runs, and PMK is where tariff and duty changes land. It is now
the only source in the registry with a backup. The tax-law *characterisations*
in the taxation section above remain assumed, not verified — that has not
changed.

### ⚠️ Pagination: `total` is not the page (found by live probe, 18 Aug 2026)

The pasal.id API caps `limit` at 50 and reports the true size in `total`.
Kemenperin has 23 rows a year so a single request held the year and this was
invisible. **Kemenkeu has 57 — the first fallback fetch returned 50 and
reported success, silently dropping 7 PMK.** A source that looks checked and
is not is the failure this project exists to prevent, and it took a live probe
against a *different* ministry to surface it.

`fetchAllPasalPages()` now follows `total` through `offset`, verified live:
Kemenkeu 57/57, Kemenperin 23/23. A page that fails, returns nothing, or
disagrees with the first page's `total` fails the whole source rather than
presenting a partial set as complete — the same rule the eCFR fetcher follows.

**Not every pasal.id row has a date, and that is honest.** The probe found PMK
rows (e.g. the oddly-slugged `permenkeu/2026/61+`) whose pages carry no
Penetapan block at all — pasal.id's crawler never captured metadata for them.
`enrichPasalDates()` correctly resolves nothing, leaves the entry dateless, and
discloses the count. Malformed numbers like `61+` come from upstream slug
parsing and are rendered as-is rather than cleaned, so the citation still
matches what the publisher holds.

### ⚠️ Correction: `peraturan.go.id` is alive, just not reachable from here

Recorded above as dead alongside `jdih.kemenperin.go.id`. That was wrong, and
the difference matters. Wayback CDX, checked 18 Aug 2026:

| Host | Last successful crawl | Verdict |
|---|---|---|
| `peraturan.go.id` | **2026-04-24** (200s through Feb–Apr 2026) | alive, network-restricted from here |
| `jdih.kemenperin.go.id` | 2024-02-19 | genuinely dead, ~2 years |

pasal.id's own worker entrypoint recommends running on Railway in **region:
Southeast Asia**, and its source registry rates `peraturan.go.id` as
`"anti_scraping": "Minimal — standard HTTP works"`. A host that answers
Indonesian infrastructure and Wayback but times out from this machine *and*
from Anthropic's fetch infrastructure is geo/network-restricted, not down. So
"no scraping technique fixes a refused TCP connection" is true of Kemenperin
and **not** of peraturan.go.id.

That does **not** make it a Cante source, for a reason that also justifies the
whole integration: peraturan.go.id publishes **only PDFs** — pasal.id's README
exists because it offers "no search, no structure, no API". Consuming it
directly would require the OCR/PDF extraction pipeline this project explicitly
declines to build. pasal.id is doing exactly the work Cante deliberately does
not, which is the honest argument for depending on it. If direct official
access ever becomes worthwhile, it needs an Indonesian egress path *and* a PDF
parser — two decisions, not one.

**Secrets stay out of the registry.** `SourceDefinition.requiresEnv` holds the
*variable name*; `fetch.ts` reads `process.env` at request time. `SOURCE_REGISTRY`
is a module-level export that tests import and code logs, so a live bearer token
has no business in it. Verified the token appears in no repo file but `.env`
(gitignored). A source whose variable is unset is **deactivated by
`sourceIsActive()` and disclosed as a caveat**, not left to fail every run —
a permanent red row trains the reader to skim failures, which is the same
reasoning as the per-domain circuit breaker.

**No date field also means no date window.** The whole current year is fetched
each run (23 rows, one page at the API's 50 max) and new rows are found by the
`source_documents` fingerprint ledger. Do not "read page 1 for what's new":
the API returns rows in **no chronological order**, verified live, so that
would silently miss things. `refreshDynamicUrl()` rewrites `year` per run
because the registry is built once at module load.

Scope checked and deliberately narrow: `KEPMEN` and `SE` return **0** rows for
Kemenperin, so only Permen exists here. Kemendag (22) and Kemnaker (11) rows
are available but **not** wired up — both already have working *official*
sources, and replacing an official record with a private re-publisher's
unreviewed parse would be a straight downgrade.

**Whole-set verification, 16 Aug 2026.** A source-only probe of the selected
Indonesia set (no profile, so the Surabaya rows stayed inactive) fetched
**11 of 11 sources with zero failures and 380 parsed entries**: Kemendag 10/10/10,
Setneg 263, KLH 30, BSN 19, Kemnaker 15, DJBC 10, Kemenkeu 7, DJP 5, OSS 1
heartbeat. The immediately prior set was 5 of 12 with 38 entries. The two
reclassified hosts were confirmed dead at the transport layer, not bot-blocked:
`peraturan.go.id` (103.145.96.87) and `jdihn.go.id` (103.145.96.88) are adjacent
IPs in one government subnet and refused TCP connections from two independent
networks, so `blocked` is a fact about the host and no retrieval change will fix
it. `insw.go.id` behaves differently — unreachable locally but reachable from
other networks — so it is a routing/geo question, not a dead service, and remains
an unexplored lead for HS-code-to-lartas mapping.

API research on 16 Aug 2026 found usable official read endpoints at Setneg,
KLH/BPLH, OSS, Surabaya JDIH, and Surabaya DLH. Setneg replaces the failed
national portal for six instrument types, but no reliable central feed covers
all nationwide Permen and Kepmen. JDIHN/ILDIS documents a decentralized member
feed convention, commonly `/feed/document.json`; adoption and quality vary, so
member feeds must be verified one agency at a time. OSS remains a catalogue
heartbeat rather than evidence of a company's private licensing status.

`source_packs` is the broader coverage inventory, not a claim of automation.
Seeded Indonesia packs include Kemendag trade, KBLI/OSS, the Setneg national
hierarchy, Permen/Kepmen, tax/customs, BSN/SNI, environment, labor/OHS, and East
Java/Surabaya regional rules. Location activates regional rows. All selected
non-blocked sources are attempted by `selectMonitoredSources()`; failures become
`source_results` rows and coverage caveats. See `indonesia-source-coverage.md`
for the exact automation boundary. `db:seed` also removes the superseded
`id-national-law` aggregate pack while leaving user-created packs alone.

### United States pack (verified 2026-08-16)

| Source | Status | Note |
|---|---|---|
| Federal Register API | **working** | Fourteen no-key agency feeds were live-probed: EPA, OSHA, FTC, CPSC, FDA, USDA, FCC, DOT/NHTSA, BIS, Census, OFAC, CBP, State/DDTC, and **IRS**. Each agency gets its own result window instead of competing in one broad query. Queried with an explicit `fields[]` list — see below, this is load-bearing. |
| eCFR versioner API | **working** | Titles 15, 16, **19**, 21, **26**, 29, 31, 40, and 49. Each run resumes inclusively from the last completed run; a first run uses a disclosed seven-day bootstrap window. Every API page and every substantive dated amendment is retained. Export and sector titles activate from profile facts. |
| OSHA Federal Register RSS | **working** | Official targeted feed; latest test parsed 5 entries and intentionally overlaps Federal Register. |
| CPSC Recall API | **working** | Official API, rolling 45-day window; live probe parsed 30 recalls. Activated only for a recorded consumer-product flag. |
| OFAC recent list actions | **working** | Official list-change page; live probe parsed 10 updates. This detects list changes but does not screen counterparties. |
| USITC HTS REST API | **working** | Current-release detection plus profile-scoped HTS-6 searches. Live code `6306.12` returned the official 10-digit row, description, units, and duty fields. A lookup monitors a recorded classification; it does not create or legally validate one. |
| CBP CROSS | **working** | Profile-scoped HTS-6 searches exhaust result pagination and retain only exact tariff-code overlaps. The live `6306.12` probe returned no exact overlap and was recorded as a validated quiet result. The endpoint is an undocumented official application contract, so schema drift fails visibly. |
| CBP CSMS RSS | **working** | Official rolling operational feed; live probe parsed 20 current messages. The rolling window is not a historical archive. |
| Targeted Federal Register overlays | **working** | Section 301, Section 232, AD/CVD, import injury, and UFLPA queries use a run-aware publication-date window and complete pagination. A live Section 301 window with zero documents was validated as quiet rather than broken. |
| USITC IDS | **working** | No-key advanced-search POST is fully paginated. The live import-injury inventory parsed 1,927 records; the source ledger limits first-run judgment while retaining all fingerprints. This tracks cases, not shipment liability. |
| USTR Section 301 HTS overlay | **working** | Full official product dataset is filtered against recorded customer HTS codes; live `6306.12` matching returned one overlay row. Federal Register notices and the HTS remain controlling evidence. |
| Trade.gov CSL | **working, exact matching only** | Bulk snapshot change monitoring plus `POST /api/screening` for cached local exact normalized primary/alias matching. Live verification returned two Huawei candidates and an explicit no-hit. Responses are `no-store`; every candidate requires human review, and no-hit does not clear ownership, end use, or licensing. |
| DHS UFLPA / CBP WRO and Findings | **working** | Live probes parsed 193 unique UFLPA entities and 67 WRO/Findings rows; CBP forced-labor RSS parsed 4 announcements. These are current source inventories and change signals, not automatic supply-chain clearance. |
| NC OAH / DEQ / NCDOL / NCDOR | **working** | NC Register (12 issues), DEQ releases (15), open air notices (3), labor releases (10), and tax updates (11) parsed in live probes. Facility/distribution facts control activation. |
| Mecklenburg air notices | **working, validated empty** | Local Charlotte/Mecklenburg-only adapter. The latest page had no open permit rows; a known page marker distinguishes that from parser failure. |
| CA / NY / TX registers | **working** | Official state rulemaking registers parsed 2 / 1 / 1 current issues. Activated only when the profile or confirmed Memory names the state. |
| FTC direct guidance page | **blocked** | The direct page rejects automation. FTC rule changes remain covered through the official Federal Register API; the page is not polled as a fake heartbeat. |

`selectMonitoredSources()` is profile-driven. Confirmed Memory facts participate;
unconfirmed chat extraction cannot activate coverage. Missing facilities,
distribution states, product flags, or export facts produce deterministic alert
caveats listing what was not activated. An empty profile currently polls eight
general federal rows. A fully populated synthetic Charlotte/multistate/export
profile selects 51 source rows, including one HTS and one CROSS source for its
recorded HTS-6 code. Only NC, CA, NY, and TX have state-register
adapters; topic-specific EPR, PFAS, packaging, tax, consumer, and permit mapping
is still incomplete even in those states.

Things about this feed that will mislead you if forgotten:

- **The listing carries a year, not a date.** Detail pages carry the real
  `Tanggal Penetapan / Pengundangan`. Never assert recency from the listing alone.
  This is not theoretical: Permendag 12/2026 reads like a major export-policy
  change from its title and was enacted 28 April 2026. Title-only judgment sends a
  false alert on day one.
- **Each view shows ~10 of ~2,386 entries.** Fine for a daily poll; a multi-day gap
  lets items scroll past unseen, and the alert has to say so.
- **`entriesParsed: 0` on a successful fetch normally means the parser broke**,
  not that it was a quiet day. The sole exception is a source definition with an
  explicit `emptyStateMarker`; it is reported as a validated empty listing only
  when that marker is present and its `emptyStateDisqualifier` is absent.
- **Volume is not signal.** The unfiltered feed is dominated by Harga Patokan
  Ekspor decrees — commodity reference prices for mining, palm, agriculture,
  forestry. They never cover PVC tarpaulin. The `ekspor` view is where the
  export-policy Permendag rules live.
- Judgment is reading, not keyword matching. Most relevant regulations will not
  contain "PVC" or "tarpaulin" in the title.
- **A dead domain is one fact, not five.** `fetchAllSources()` keeps a per-run
  circuit breaker: once a source fails at the connection level, its siblings on
  the same domain are recorded without a second network attempt, with
  `errorMessage` starting `"Not attempted — "`. Five identical peraturan.go.id
  timeouts cost ~60s and produced five identical caveat lines, which trains the
  reader to skim the section rule 2 depends on. Skipped is still **unchecked**,
  never a pass — the prompt, the alert and the dashboard all say so, they just
  say it once per domain.
- **Retries are narrow and source-owned.** `maxAttempts` retries only connection,
  timeout, HTTP 429, and HTTP 5xx failures. BSN PESTA uses two attempts. Parser
  errors and zero-row warnings are never retried into a false success.
- **A heartbeat is not a regulation.** Sources marked `heartbeat: true` (OSS
  KBLI) prove a portal answered; their entries go to `report.heartbeats`, not
  `report.regulations`. The OSS ping used to be stored as a `baseline` finding —
  a liveness check wearing a regulation's clothes, and it sits in the seen log
  forever. The pre-existing `baseline` row from run `fc108a73` was left in place
  rather than rewriting history.
- **The anchor parser must find a citable rule, not a page mentioning one.**
  `looksLikeRegulation()` tests link text only and requires both a regulation
  word and a number/year. The earlier version tested `text + URL` against a list
  including bare `uu`/`pp`/`oss` — and the URL *is* `peraturan.go.id/pp`, so
  every anchor including nav and footer passed. It looked harmless only because
  that fetch always fails; the first success would have produced 30 junk entries,
  each costing a detail-page read and a judgment.

### Taxation, and why the two countries look nothing alike (added 16 Aug 2026)

Indonesia has been covered from the start — `jdih.kemenkeu.go.id` (PMK),
`peraturan.beacukai.go.id` (DJBC customs and excise) and `pajak.go.id/peraturan`
(DJP) — plus the `tax-customs-monitor` checklist row and the `id-tax-customs`
pack. The US pack had **thirteen agency feeds and no tax authority at all**; its
only tax source was NCDOR, a North Carolina state feed that activates only when a
profile names NC. Title 31 was present but that is the *sanctions* title, not the
customs one.

Three rows closed it, all live-probed on 16 Aug 2026:

| Source | Gate | Probe |
|---|---|---|
| Federal Register — IRS (`internal-revenue-service`) | ungated | 4 entries; `Backup Withholding on Third Party Network Transactions` carried `effective_on: 2026-08-10` |
| eCFR Title 19 — Customs Duties | `export` | 1 substantive change in 7 days, 3 in 30 |
| eCFR Title 26 — Internal Revenue | ungated | 3 substantive changes in 7 days, 9 in 30 |

**19 CFR is the important one, not 26 CFR.** The US cannot tax exports at all —
Constitution, Article I §9 cl. 5, "No Tax or Duty shall be laid on Articles
exported from any State" — so there is no US export-duty regime to monitor. An
exporter's money moves on the customs side: duty drawback (19 CFR 190) on inputs
that are later re-exported, plus entry, valuation and origin. That is why 19 CFR
follows the `export` gate while 26 CFR is ungated like EPA and OSHA: federal
income tax reaches any company with US operations, but customs duties only matter
once trade facts exist.

The two federal tax feeds are a deliberate cross-check and will overlap. The
probe caught it working: the IRS Federal Register rule on backup withholding
(effective 2026-08-10) and the 26 CFR §31.3406 codified text arrived the same day
through independent feeds — the rule as published and the rule as codified.

An empty US profile now selects **10** general federal rows (was 8): EPA, OSHA,
FTC, IRS, USITC HTS release, eCFR 16/26/29/40, and the OSHA RSS feed.

`us-tax-customs` is the checklist counterpart, taking US rows from 17 to 18. It
is `monitored` rather than `completed` and asks the two questions that decide
whether any of this is worth money to the customer: whether duties are paid on
imported inputs that are later re-exported (drawback), and whether an FTZ, FDII
or IC-DISC position exists and who reviews it.

**Assumed, not verified.** The source coverage above is verified by live probe.
The tax-law characterisations — export-tax prohibition, drawback under part 190,
Indonesian export VAT zero-rating and bea keluar scope — are reasoning from
general knowledge, not something Cante has checked against a source. They must be
confirmed by an Indonesian tax consultant and a US customs broker before any of
it reaches a customer. Related and already recorded elsewhere in this file: bea
keluar applies only to listed commodities (CPO, minerals, wood, leather, cocoa),
which is the same fact as the HPE decrees flooding the Kemendag feed never
touching PVC tarpaulin.

### `sideOfTrade` is a real switch, and import is not export

`customer_profiles.sideOfTrade` existed from the beginning, was rendered into
prompts as a bare string, and drove no behaviour. Source selection instead
*inferred* export from stray HTS/ECCN/country facts, which made "domestic
manufacturer" indistinguishable from "exporter whose facts are missing" — the
one thing rule 2 is supposed to prevent. It now threads from the customer
profile into `SourceSelectionProfile` and gates the cross-border packs. A stated
fact beats an inferred one: `domestic` suppresses those sources even when a
stray code is on file.

**The gate was also split, because conflating import with export hid the segment
that actually pays.** A domestic manufacturer buying Chinese inputs eats Section
301, AD/CVD and UFLPA directly, and none of it was reaching them.

| Gate | Covers | Activates for |
|---|---|---|
| `export` | EAR/CCL, Census AES/EEI, ITAR, 15 CFR | `export`, `both` |
| `trade` | Section 301/232, AD/CVD, import injury, UFLPA, forced labour, CBP, CSMS, OFAC, CSL, 19 CFR, 31 CFR | `import`, `export`, `both` |

Measured after the split — US has 52 active rows, 5 export-gated, 18 trade-gated:

| Side of trade | Sources selected | Section 301 | 19 CFR | EAR |
|---|---|---|---|---|
| `domestic` | 10 | no | no | no |
| `import` | 28 | **yes** | **yes** | no |
| `export` / `both` | 33 | yes | yes | yes |

Indonesia has **zero** export-gated rows: `domestic` and `both` select the same
13 sources. Any future export-only Indonesian source must be gated rather than
added to the default set — there is a test asserting this.

The Indonesian judgment prompt was also export-framed ("one specific exporter's
product") and now reads the side of trade and says plainly that a domestic
manufacturer is normal, with KBLI/OSS/SNI/environment/labor/tax/Perda as the
substance instead of export licensing.

### ⚠️ Both US APIs must be asked for what you need

Two defaults quietly gutted the US side. Neither failed; both returned 200 and
looked healthy.

**Federal Register — `fields[]` is not optional.** Without it the API returns a
short default set carrying **no dates at all**. `parseFederalRegisterJson()` was
already reading `effective_on` and `abstract`, so it read `undefined` every run,
and every US alert had to disclose that effective dates and comment deadlines
were unverified. `FR_FIELDS` in `registry.ts` now requests `effective_on`,
`comments_close_on`, `dates`, `type`, `action`, `abstract`, `citation` and
`raw_text_url`. Measured before and after on the same feeds: **0 of 16 entries
carried a date, then 16 of 16.**

This is the one place the US side beats the Indonesian one. Kemendag's listing
carries a year and nothing else, so judgment must fetch a detail page per
candidate to learn an enactment date. The Federal Register returns the dates
*in the listing*, so "never assert recency from a listing alone" is satisfied
with zero extra fetches.

**Never fetch a Federal Register HTML page.** It is ~100KB and intermittently
302s to `unblock.federalregister.gov` — it did exactly that mid-run, which is
what put "detail pages blocked" in an earlier alert. `raw_text_url` is the same
document as ~7KB of plain text through the documented API, and entries carry it
as `textUrl`. `url` stays the human-facing citation link; the judgment prompt is
told to fetch `textUrl` only when the structured fields leave a real question.

**eCFR — the unfiltered endpoint returns the *oldest* versions.** Asking for
Title 29 with no parameters gives 268KB of section versions beginning in
**2017**. `runCheck()` therefore reads the previous completed run before source
selection, and `issue_date[gte]` resumes from that run's UTC date. The boundary
is deliberately inclusive because the API has day precision; duplicates are
removed by versioned identity. A first run starts seven days back and appends a
code-written caveat that older amendments were not historically audited.

There is no parser cap. `fetchAllEcfrPages()` follows `meta.total_pages`; if any
page fails or is malformed, the whole source fails rather than presenting a
partial page set as checked. An empty `content_versions` array is the one valid
quiet result for these sources and is protected by an explicit empty-state
marker. This matters because an incremental daily window commonly contains no
changes.

Each identity is the human eCFR citation plus
`#cante-amendment-YYYY-MM-DD`. The fragment makes a later amendment to the same
section new to exact-URL dedup without breaking the citation. Do not collapse to
one row per section: live data included the same section on multiple amendment
dates.

> ⚠️ **Open bug (found 16 Aug 2026, not yet fixed): `identity()` discards this
> fragment.** `lib/checks/source-changes.ts` strips the URL hash before keying
> the ledger, so two amendments of one section collapse to a single identity and
> violate the `source_documents` unique index. It is inside `db.transaction()`,
> so it aborts the **whole run**, not one source. Reproduced against the real
> schema: `SQLITE_CONSTRAINT_UNIQUE`. Measured exposure from live eCFR data —
> Title 40 has 0 colliding sections in a 7-day window, 1 in 30 days, and 234
> since 1 Jan 2026; Title 49 has 178 since 1 Jan. Daily runs are safe; a stalled
> monitor is not, and the failure is self-reinforcing because the window resumes
> from the last *completed* run, so each failure widens the window that caused
> it. Fix is to preserve `#cante-amendment-` fragments in `identity()`. Two
> related nits: `revisionUrl()` overwrites the amendment fragment with
> `#cante-revision-`, dropping the amendment date from the customer-facing
> citation; and the bootstrap `slice(0, 10)` takes source order while its own
> comment disclaims that order is chronological.

API `appendix` rows use `/appendix-`, not `/section-`; the latter returns
404/406. Live verification parsed all 17 Title 15 changes since 23 July 2026,
and its generated Supplement No. 5 appendix URL resolved to the official page
with HTTP 200.

`amendedOn` is the eCFR amendment date. It is **not** a legal effective date;
`effectiveOn` remains explicitly `null` unless a separate official source
establishes one. Federal Register nullable date/action fields are also preserved
as explicit nulls so absence and parser omission cannot look the same.

---

## Operating data (built 16 Aug 2026)

Everything described above this section is about **regulations**. This section is
about the customer's own business — the products, lanes, suppliers, documents and
decisions a regulation has to be matched *against*. Cante monitored well and
connected nothing; competitors connect regulations to products, shipments,
classifications and money. These are items 2–10 of that gap analysis.

### The reference-data layer (added 17 Aug 2026)

The competitive gap that survived items 2–10 was not a feature. It was that
**Cante observed and never computed.** It could say a rule changed and which SKU
it touched; it could not say what that cost, because every rival's money pitch
comes from calculating against reference data — rate tables, substance lists —
and Cante had feeds and judgment but no reference data at all.

`lib/impact/assess.ts` showed it exactly: `AssessInput.duty` was an **optional
parameter the caller passed in**. The arithmetic existed; the operands never
did, so almost every US assessment rendered "not calculable". Meanwhile the
USITC HTS source was already fetching `general`, `special`, `other` and
`additionalDuties` on every run and flattening them into prose.

**`lib/tariff/` closes it.** `lookupTariff()` reads the official row,
`quoteDuty()` prices a shipment, `compareDuty()` prices a misclassification.
Verified live: HTS 6306.12.00.00 general 8.8%, and a fictional example computes —
the seed guess 3921.90 (4.2%) against the document's 6306.12 (8.8%) on a $400k
lane is a **USD 18,400/year** difference.

Three rules keep the arithmetic as honest as the coverage:

1. **A rate this parser does not fully understand is `parsed: false`, never a
   partial number.** The dangerous failure is `"4.4¢/kg + 8.5%"` being read as
   8.5% — a confident, materially under-stated duty. A compound rate with no
   quantity in the matching unit returns `amount: null` and says why.
2. **Rates are rounded at parse time.** `8.8 / 100` is `0.08800000000000001` in
   binary floating point, and that noise would ride into every figure.
3. **The general (NTR) column is the default and says so.** Claiming an FTA
   preferential rate needs a certificate of origin and a rules-of-origin
   analysis Cante does not perform, so `special` is quoted only on an explicit
   claim and always with a caveat that eligibility is unverified. Chapter 99
   measures (Section 301/232) are flagged as **excluded from the figure**.

**`annualDutyAtRisk` is not `estimatedAnnualExposure`.** The published schedule
gives today's rate, not tomorrow's. For a misclassification both codes have a
rate right now, so the delta is real. For a regulation that will change a rate,
the "after" rate does not exist yet — so `enrichDraftsWithTariff()` fills the
duty currently flowing through the affected lane and leaves the delta alone.
Magnitude without inventing a difference.

### Model-suggested classifications (added 17 Aug 2026)

Quickcode's core capability, with this project's discipline welded on.
Classification is a legal determination with money and liability attached, so a
model that emits a plausible code is the most dangerous thing this codebase
could contain. Four constraints hold it down.

**1. The model chooses; it never invents.** Candidate rows are fetched from the
official USITC schedule *first*, and a returned code outside that set is
rejected rather than recorded. The model is only ever picking from real,
declarable lines.

**2. It may decline, and declining is the preferred answer.** The first live run
proved why. The model correctly judged that none of the retrieved candidates
covered a PVC-coated tarpaulin and said so in its uncertainties — but the prompt
told it to "pick the closest anyway", so a nonwoven-fabric code was written to
the database for a good that belongs in heading 6306. **Being unable to decline
turned an honest model into a wrong row.** `noSuitableCandidate` fixed it:
nothing is recorded, and the error names the heading the model expected.

**3. A suggestion is always `lead` tier.** `recordSuggestion()` takes no tier
parameter, so no refactor can quietly strengthen it, and
`approveClassification()` already refuses leads. A suggestion is *structurally*
unable to become approved without a human in between.

**4. Adoption is its own act.** `adoptSuggestion()` promotes lead → human and
demands a named person and a written reason. Adopting says "I have read this and
I stand behind it"; approving says "this is the code we use". Collapsing them
would let one click carry a model's guess to an approved classification.

⚠️ **Retrieval is the accuracy ceiling, not the model.** Three retrieval bugs
made the first run fail, all found by live probe and all fixed:

- **`PVC` was dropped by a `length > 3` filter.** The most discriminating term a
  materials list carries. The minimum is now 3.
- **Multi-word phrases return garbage.** The USITC endpoint does keyword, not
  phrase, matching: `"coated tarpaulin"` finds nothing while `"tarpaulin"` alone
  returns exactly 6306.12.00.00. Single words only, longest first.
- **One broad term flooded the candidate cap.** `"coated"` filled all 25 slots
  with chewing gum, confectioners' coatings and medicated dressings before
  `"tarpaulin"` was ever queried. `PER_TERM_CANDIDATES` now reserves slots per
  term.

After the fix, the same product classified to **6306.12.00.00 at high
confidence under GRI 1**, citing Chapter 39 Note 2(p) and Chapter 59 — and the
official rate on that row (8.8%) matches what `lib/tariff/` independently
returns. CBP CROSS rulings are attached as `supportingRefs`; they are research
evidence, never binding for another product.

### Structure: bills of materials and substances

`products.materials` is a string array — enough for "PVC coated polyester",
useless for PFAS, REACH or RoHS, which restrict a *substance* at a
*concentration* inside a *component*. `lib/substances/bom.ts` adds
`product_components` (self-referencing, so assemblies nest), `substances` keyed
on CAS number, `component_substances` with concentration and tier, and
restriction lists as stored snapshots.

`assessRestrictions()` returns **four verdicts, and they are not two**:

| Verdict | Means |
|---|---|
| `over_threshold` | Declared at or above the restricted level. |
| `below_threshold` | A real pass. |
| `present_unknown_amount` | The substance is there and nobody said how much. **Not a pass.** |
| `undeclared` | Nobody ever asked. Reported separately, never as clean. |

`productsContainingSubstanceNamedIn()` is the join `matchProducts()` cannot
make: a PFAS rule names a chemical, not an HS heading, so the affected SKU is
whichever one has that chemical somewhere in its bill of materials. Matching is
by CAS number first, then name, then synonym.

### Regulation lifecycle

`lib/checks/lifecycle.ts` links a rule to the rule it changes. Permendag 12/2026
is the *fifth amendment to 23/2023* and nothing connected them — which made the
monitor look like it read documents rather than law.

Detection is **regex over the citation sentence, not a model call**: Indonesian
and US drafting both signal these in fixed language ("Perubahan Kelima atas",
"mencabut", "amending", "revokes"). Deterministic, auditable, and it cannot
hallucinate a relationship. Every link stores the sentence it was read from.

⚠️ **Bug found and fixed 18 Aug 2026 by running this against real data: the
Indonesian patterns were case-sensitive and verb-only.** They matched
"Perubahan **a**tas" but not "Perubahan **A**tas", and "mencabut" (the verb, how
a rule's *body* reads) but not "Pencabutan" (the noun, how its *title* reads).
Titles capitalise what prose does not, and this monitor usually has only the
title. Measured on a live batch of 23 Kemenperin regulations: **1 link detected
before, 9 after** — eight amendments and revocations were being silently
dropped, including one title typed entirely in capitals. The Indonesian
patterns now carry the `i` flag (the English ones always had it) and there is a
`pencabutan` pattern beside `mencabut`. This was never pasal.id-specific; it
affected every Indonesian source, and it stayed invisible because the regexes
were only ever tested against hand-written prose sentences rather than real
listing titles.
`supersededFindings()` reports what the newer rule *claims* — never a legal
determination that the older rule stopped applying, because transitional
provisions routinely keep parts of it in force.

`classifyDirection()` adds favourable / unfavourable / neutral / unknown. A
monitor that only ever reports bad news trains the reader to dread it, and a
duty reduction or an exclusion grant is worth surfacing. Both signals present is
`unknown`, not a coin flip.

**`products` is the keystone.** Lanes, impact, document audit and supplier
evidence are all meaningless without a first-class SKU to hang them on, so it was
built first and everything else references it. `jurisdiction_profiles.products`
and `.skus` stay as they are — they describe the company in prose for source
activation, and they are not the catalogue.

| # | What | Where | State |
|---|---|---|---|
| 2 | Product catalogue, CSV import | `lib/catalogue/products.ts` | built, tested |
| 3 | Trade lanes, suppliers | `lib/catalogue/lanes.ts` | built, tested |
| 4 | Action workflow | `lib/workflow/actions.ts` | built, tested |
| 5 | Impact calculation | `lib/impact/assess.ts` | built, tested |
| 6 | Classification workspace | `lib/catalogue/classifications.ts` | built, tested |
| 7 | US trade depth | `lib/sources/registry.ts` | was already built; PGA-per-code still missing |
| 8 | Document audit | `lib/documents/audit.ts` | built, tested — **text only, no OCR** |
| 9 | Supplier evidence | `lib/suppliers/evidence.ts` | built, tested — **records requests, does not send them** |
| 10 | Screening persistence | `lib/screening/persist.ts` | built — restricted-party only, no licence determination |

### The tier discipline now reaches the SKU

`product_classifications.tier` reuses `lib/checks/facts.ts` exactly — `document`
/ `human` / `lead` / `guess` — so the customer-level and SKU-level answers to
"is this established?" cannot drift apart. Three structural rules enforce it,
and all three are verified over HTTP:

1. **A CSV cannot produce a verified code.** Codes in an imported spreadsheet
   land as `lead`/`proposed`. A spreadsheet is not an export document.
2. **`approveClassification()` refuses `lead` and `guess` tiers**, and requires a
   named approver plus a written rationale. Approving a model suggestion without
   first establishing it is the laundering step this project exists to prevent.
3. **`POST /api/classifications` refuses `tier: "document"` outright.** That tier
   is produced only by `promoteCodesFromDocument()`, which can cite the paperwork.

Nothing is ever overwritten. A superseded code gets `supersededAt` and stays in
the table, because "what did we declare in March" is a question customs asks.

### Document audit is the roadmap unblocker, not just parity

The `document` tier is the only one that counts as verified, and until now
nothing could produce one — it needed a human to read a PEB and type the code
into Memory. `promoteCodesFromDocument()` is that path, automated but not
weakened: the document must have a readable number **and** date (otherwise it is
uncitable and nothing is promoted), the line must name a known SKU, and the
result still arrives `proposed` for human approval.

Two things the parser must keep doing:

- **`parseStatus` distinguishes `parsed` / `partial` / `failed`.** A document
  nobody could read must never present like one that was read and found clean.
  Rule 2 applied to the customer's own paperwork.
- **An HS code needs a separator or 8+ digits, and chapter 01–99.** The naive
  regex read the PEB's own registration number `000123` as heading `0001.23` and
  invented a phantom line item. Chapters 98/99 are deliberately allowed —
  `9903.*` is where Section 301/232 duties are declared, so rejecting them would
  blind the parser to the measures the US pack cares most about.

### File upload (added 18 Aug 2026)

Until now a PEB or a catalogue had to be **copy-pasted as text**, which is the
single most annoying thing about using this product. `lib/documents/extract-file.ts`
adds the one missing step — getting text *out of a file* — and changes nothing
downstream: `ingestDocument()`, `importProductsCsv()`, the audit and the tier
rules never learn that files exist.

| Format | Support |
|---|---|
| `.xlsx` / `.xlsm` | full — shared strings resolved, all sheets read |
| `.docx` | full — runs joined within a paragraph, paragraphs kept apart |
| `.pdf` | **text layer only** — a scan is refused |
| `.csv` / `.txt` / `.md` | passthrough |
| `.xls` / `.doc` | refused, with the "re-save as…" fix named |

Two endpoints accept `multipart/form-data` alongside their existing JSON:
`POST /api/documents` (a PEB or invoice) and `POST /api/products` (a catalogue
of SKUs and HS codes). The documents page has a file picker.

**Dependencies were chosen to stay small**: `.xlsx` and `.docx` are ZIP archives
of XML, so `fflate` (~30KB) unzips and **`cheerio`, already a dependency**, reads
the XML — one small library between two formats rather than a spreadsheet
framework. `unpdf` reads a PDF text layer. Neither does OCR nor calls a network
service, so rule 1 is untouched.

⚠️ **The failure this module exists to prevent: a scanned PEB extracting to `""`
would sail through the audit and come back with no discrepancies — identical to a
document that was read and found correct.** Most Indonesian PEBs *are* scans, so
this path fires often. `extractPdf()` therefore checks for an empty text layer
explicitly and throws, rather than letting an empty string flow onward. Every
refusal names the reason and, where one exists, the fix.

Verified end to end over HTTP, 18 Aug 2026: a real text-layer PDF ingested with
`documentNumber: 000123` and `documentDate: 2026-08-12`; a no-text PDF was
refused with **HTTP 400** and the OCR explanation; an `.xlsx` of SKUs imported
and its code landed **`lead`/`proposed`** — the spreadsheet-is-not-evidence rule
holding through a new transport. Probe rows were deleted afterwards.

**A multi-sheet workbook is flattened in sheet order and says so** in
`extraction.warnings`, surfaced in the UI. Silently concatenating sheets nobody
mentioned is how the wrong rows come to look right.

### ⚠️ Rule 5: the tier discipline points at the monitor, not at the customer

Found the hard way, 18 Aug 2026. The customer uploaded their own KBLI and HS
codes and the chat replied that it could not confirm them. Every instruction it
followed was one this file had written — and the result was a product telling
a paying customer it did not believe their own registration documents. The user
called it "unprofessional and embarrassing", and they were right.

**The mistake was mine, not the model's.** `origin: "chat"` → `confirmed: false`
exists because the model *infers* facts from conversation, and an inference is
not evidence. An upload is a different act entirely: the customer is asserting
their own facts and attaching the paperwork. That is precisely what the `human`
tier in `lib/checks/facts.ts` already meant — "a person asserts it; better than
a guess, still not a PEB". Applying the chat rule to it was a category error.

So the rule, stated properly: **scepticism belongs in what the monitor claims
about itself, never in what the customer says about their own business.** Never
tell a source it failed when it didn't; never tell a customer you cannot verify
who they are. The two are not the same discipline, and conflating them makes
the product worse in both directions.

The same correction reaches chat memory (19 Aug 2026). `extractMemories()`
saved everything as `origin: "chat", confirmed: false`, so a customer could say
"our KBLI is 22292" and the monitor would treat it as a guess forever unless
they also went and clicked confirm. The extraction schema now carries
`statedByUser`, and a fact the customer asserted about their own business is
stored `origin: "user-stated", confirmed: true` — the human tier. Only genuinely
*inferred* facts stay unconfirmed, which is what that tier was always for.

Concretely, `lib/chat/attachments.ts`:

- Facts extracted from an upload are stored `origin: "upload"`, **`confirmed:
  true`** — the human tier, usable by judgment immediately.
- They are still **not** promoted to `document` tier.
  `promoteCodesFromDocument()` continues to demand a readable document number
  *and* date, so a spreadsheet can never manufacture customs evidence. That
  distinction is the one that is genuinely real, and the prompt now says it
  **once, briefly**, instead of as a standing disclaimer.
- Code extraction is **regex, not a model call**. It decides what gets stored
  as confirmed, so it has to be inspectable and unable to invent a code. An HS
  code must be labelled to count — an unlabelled 8-digit number in a
  spreadsheet is as likely to be an invoice number as a tariff code.

### Chat attachments are acted on, not just read (added 18 Aug 2026)

The first version put the file's text in the prompt and nothing else, so a
dropped document never reached the Documents screen, the catalogue or Memory.
`fileAttachments()` now runs **before** the answer is generated, and the model
reports what was done rather than telling the customer to go do it:

| Attachment | What happens |
|---|---|
| Spreadsheet with a `sku` column | `importProductsCsv()` — catalogue rows, codes as leads |
| Anything else | `ingestDocument()` + `auditDocument()` + `promoteCodesFromDocument()` |
| Any file | labelled KBLI/HS codes saved to Memory, confirmed; checklist refreshed |

`renderAttachmentOutcomes()` renders the completed actions into the prompt with
an explicit instruction not to contradict them. That instruction is load-bearing
and there is a test for the exact sentence a live run produced before it existed
("logged as a lead, not a confirmed fact") while the database said `confirmed=1`.

An uploaded spreadsheet can establish confirmed memories and expose conflicts
with previously recorded classifications. Ask which conflicting code is current
rather than asking the customer to reconfirm the entire upload.

⚠️ **Failures are absorbed, never raised.** A filing error becomes a caveat the
model reads out; the conversation must not break because an import failed.

### Drag and drop in chat (added 18 Aug 2026)

Files can be dropped, pasted, or picked on the chat composer. `POST
/api/files/extract` turns one into text with the same extractor; the composer
holds it as a chip and `POST /api/chat` takes an `attachments` array. Verified
live: an `.xlsx` dropped with **no typed question** streamed back a correct
reading of the SKU and its HS code.

Four decisions worth keeping:

1. **`/api/files/extract` itself stores nothing** — it only converts a file to
   text. The filing is a separate, deliberate step in `fileAttachments()`; see
   rule 5 above. Keeping extraction pure is what lets the same endpoint serve
   the composer without deciding anything about evidence.
2. **Attachment text is fenced and labelled as data.** The prompt block states
   it is document content and that imperative wording inside is to be reported
   on, never obeyed — a trade document is untrusted input, and a chat that will
   read arbitrary uploaded files is exactly where prompt injection would land.
3. **History stores the typed question plus `[Attached: name]`, not the dump.**
   The model gets the full text for that turn; a reopened conversation stays
   readable instead of replaying a whole spreadsheet.
4. **Text is capped at 20,000 characters and truncation is disclosed** in the
   attachment's warnings. A model answering from the first half of a document
   with no sign the rest existed is the same failure as a source that silently
   parsed only its first page.

`dragDepth` counts dragenter/dragleave rather than using a boolean, because
those events fire for every child element and the highlight otherwise flickers
as the pointer crosses the textarea. CSS is at the end of `globals.css`; every
token it uses was checked to exist — an earlier draft used `--accent` and
`--surface`, neither of which is defined in this project (`--blue`/`--azure`
and `--app-surface` are).

### Impact may not invent precision

`lib/impact/assess.ts` is the file most able to damage credibility, because a
dollar figure reads as fact in a way prose does not.

- **A missing input produces `null`, never `0`.** Zero exposure and unknown
  exposure are different answers, and a customer reading "$0" concludes there is
  nothing to do.
- **`basis` is mandatory and rendered with the figure**, in both the API and the
  UI. Every number is reconstructible from the assumptions beside it.
- **`confidence` is capped by the weakest input.** An exposure computed from a
  `lead`-tier code is `indicative` however precise the arithmetic.
- **A 6-digit rule against an 8-digit catalogue code is a `code_prefix` match**,
  never silently promoted to exact. Tariff measures are usually written at 6
  digits; the caveat says to confirm at the full code before acting.
- **An empty catalogue is a coverage gap, not "no impact."** An unmatched
  regulation and an unclassified catalogue look identical otherwise.

### Workflow is separate from evidence on purpose

`finding_actions` is its own table rather than columns on `findings`. A finding
is what the monitor observed on a given day and must stay immutable; the action
is the mutable human response. Merging them would let a workflow click rewrite
the monitoring record, and "what did we know on the 14th" would stop being
answerable. Marking a finding `irrelevant` requires a written reason — it is the
one transition that destroys information, so it costs a sentence.

### What these deliberately do NOT do

Stated here because each is a place where looking finished would be worse than
the gap:

- **No OCR.** File upload now exists (see below) and reads a PDF's text layer,
  but a *scanned* PDF is still refused rather than accepted and turned into an
  empty, clean-looking audit.
- **No supplier outreach delivery.** `requestEvidence()` records that a request
  was made and returns a draft message with `delivered: false`. Sending needs the
  delivery infrastructure item 1 defers; the UI must never render this as "sent".
- **No licence determination or ECCN classification.** Item 10 covers
  restricted-party screening against one official US list. `outcome: "error"` is
  a first-class value and must never render as `clear` — a failed screen is an
  unscreened party.
- **Item 1 (scheduling and push delivery) remains out of scope.** It is still
  listed under "explicitly not yet". Items 2–10 make the alert worth more; they
  do not make it arrive on its own.

## Data model

Multi-tenant from day one — everything keys off `customer_id`, sources key off
country + regulation_type, so "add customer #2" or "add Vietnam" is a row, not a
refactor. Supabase Postgres is the runtime store; SQL migrations and tenant RLS are authoritative.

`customers` · `customer_profiles` · `jurisdiction_profiles` · `kbli_records` · `source_packs` · `sources`
· `check_runs` · **`source_results`** · **`source_documents`** · `findings` · `alerts` · `conversations`
· `chat_messages` · `memories` · `checklist_items`

Operating data (the customer's own business, not regulations):
**`products`** · `product_classifications` · `trade_lanes` · `suppliers`
· `supplier_documents` · `trade_documents` · `document_findings`
· `finding_actions` · `impact_assessments` · `screening_results`

Structure and reference data:
`product_components` · `substances` · `component_substances`
· `restricted_substance_lists` · `restricted_substance_entries` · `regulation_links`

`substances` is unique on `cas_number` — CAS is how restriction lists cite a
chemical, so it is the identity. `product_components.parentComponentId` is
self-referencing, so an assembly nests. `regulation_links` is its own table
because the target is usually a rule Cante never fetched: an amendment names its
parent whether or not we saw the parent.

`products` is unique on `(customer_id, sku)` — SKU is the merge key, so a
re-import updates rather than duplicating. `finding_actions` is unique on
`finding_id`: one current response per finding, with the history in its own
timestamps rather than in extra rows.

`check_runs`, `conversations`, `memories`, and `checklist_items` carry a
`jurisdiction`. That prevents Indonesian evidence and US evidence from being
mixed. `jurisdiction_profiles` stores the structured operating facts needed by
country-specific judgment and checklist generation.

`source_results` is load-bearing — it's what makes a failed fetch visible in the
UI instead of silently absent.

`source_documents` is the per-customer inventory ledger. Every successfully
fetched regulation/list record in either supported jurisdiction is fingerprinted
even when it is not sent to the model. The first inventory judges at most ten
unseen records per source and baselines the remainder; later runs judge only new
or changed fingerprints.
HTS and CROSS sources are generated per recorded HTS-6 code, so `runCheck()`
upserts every selected source instance before writing foreign-keyed source
results or inventory rows; static seeding alone cannot create those IDs.
This gives paginated sources full discovery coverage without repeatedly spending
minutes judging the same backlog.

`checklist_items` is also load-bearing now. It is the living work queue that
turns customer facts into obligations and evidence gaps. A chat-extracted KBLI or
HS code becomes an unconfirmed lead and a review task; it does not become
verified monitoring coverage until a human confirms the underlying memory or
enters evidence.

`checklist_items.key` is the stable identity of a system row. Refresh matches on
it, adopts pre-key rows by title once, and **prunes any `origin: "system"` row
whose key it no longer generates** — so renaming a row is just editing its title.
The previous approach was a hardcoded list of old titles to delete, which only
grows and only catches renames somebody remembered to add to it. Rows a person
created are never pruned.

`check_runs` left in `running` are reaped by `reapStaleRuns()` (called from
`runCheck()` and `getRunHistory()`): a run only leaves that state from inside its
own process, so a killed `npm run check` stranded the row and the dashboard
showed a check that never finishes. Anything older than an hour is marked
`failed` — its source results stay accurate, its judgment never ran.

Finding relevance values: `flagged` (send it) · `noted` (worth a manual look) ·
`baseline` (pre-existing backlog, recorded so tomorrow doesn't treat it as fresh)
· `clear` (looked at, not relevant).

---

## Current status

- Fetch, judgment, storage, dashboard, and chat all working locally, verified
  against the expanded live source set.
- **FIXED 19 Aug 2026 — the "unjudged entries" defect was a false alarm in the
  audit, not a model failure.** See the section below; the retry had nothing to
  resolve because the entries had already been judged.
- **FIXED 19 Aug 2026 — lifecycle links are now stored.** `runCheck()` calls
  `linkRegulation()` for each `flagged`/`noted` finding as it is inserted, so
  "PP 20/2026 — Perubahan atas PP 55 Tahun 2022" records its `amends` edge.
  `clear` verdicts are skipped deliberately: nobody is tracking the lifecycle of
  a rule that was ruled irrelevant. Failures are swallowed — a missing amendment
  link must not cost a run.
- **First unattended cron run with the new sources: `4a28d566`, 19 Aug 2026,
  delivered to Telegram.** 17 of 18 sources OK. pasal.id Kemenperin returned 23
  entries in a real scheduled run, not a probe; Kemenkeu recovered on its own
  (7 entries) so the fallback correctly did not fire; all four East Java rows
  worked; Surabaya rose 135 → 148, so incremental discovery is working. BSN
  PESTA was the single failure and is listed as such in the digest. One `noted`
  finding (PP 20/2026, income tax) and 21 `clear`. The 41-unjudged defect above
  is from this same run.
- **Kemenperin coverage exists for the first time (18 Aug 2026), via pasal.id.**
  122 tests pass (up from 111: 9 new pasal tests, 2 new lifecycle regressions),
  `npx tsc --noEmit` clean. Live end-to-end through `fetchAllSources()` parsed
  23 Permenperin 2026 rows with zero failures. The same probe exposed a
  case-sensitivity bug in `lifecycle.ts` that was dropping 8 of 9 amendment and
  revocation links across *all* Indonesian sources. `npm run build` was **not**
  run because `npm run dev` was live — see the warning above; run it after
  stopping dev.
- **The operating-data layer (items 2–10) is built and verified locally,
  16 Aug 2026.** 65 tests pass (up from 34), `npx tsc --noEmit` and
  `npm run build` are clean, and all four new pages return HTTP 200. Verified end
  to end against the real `cante.db`: a CSV import created products and filed its
  codes as leads; a lane referencing an unknown SKU was rejected with a reason; a
  pasted PEB parsed to `parsed` with number and date; the audit caught the exact
  drift CLAUDE.md documents (seed guess `3921.90` vs the document's
  `6306.12.00`); promotion moved the code to `document` tier as `proposed`; and
  approval superseded the old code while retaining it in history. Both guardrails
  were then re-confirmed over HTTP — approving a `lead` returned 400, and
  asserting `tier: "document"` via POST returned 400. All demo rows were deleted
  afterwards; `cante.db` holds no fabricated catalogue data.
- **US federal tax and customs coverage added and live-probed, 16 Aug 2026.**
  IRS Federal Register, eCFR Title 19 (customs duties) and eCFR Title 26
  (internal revenue), plus the `us-tax-customs` checklist row (US rows 17 → 18)
  and the `us-federal-tax-customs` pack (US packs now 25). An empty US profile
  selects 10 general federal rows, up from 8. 67 tests pass. See the taxation
  section above for why 19 CFR matters more than 26 CFR here.
- **The reference-data layer is built and live-verified, 17 Aug 2026.** 85 tests
  pass (up from 75), typecheck and `npm run build` are clean. Verified end to end
  against the real `cante.db` and the live USITC service: a customs entry
  declaring 6306.12 against a catalogue holding 3921.90 priced the difference at
  **USD 18,400** with the arithmetic printed; promoting and approving the
  document code then produced `annualDutyAtRisk` of **USD 35,200/year** on a
  $400k lane via "USITC HTS general 8.8%"; the Permendag 12/2026 text linked
  `amends → Peraturan Menteri Perdagangan Nomor 23 Tahun 2023`; and a PFAS list
  flagged PFOA at 40 ppm against a 25 ppm threshold while reporting the
  undeclared scrim separately. All probe data was deleted afterwards.
- **Still not done, and deliberately**: customs *filing* (Descartes/CargoWise
  territory — losing there costs nothing), supplier outreach delivery, licence
  determination and FTA qualification (both need rules-of-origin logic Cante
  does not have), cross-tenant network effects, and model-suggested
  classifications. Rates cover **US import duty only** — there is no Indonesian
  tariff schedule behind `lib/tariff/`.
- **What is NOT done in that layer**: OCR/PDF ingestion, supplier outreach
  delivery, export-licence determination, and PGA-requirements-per-HS-code
  (item 7's one remaining gap). Each is disclosed in code and in the section
  above rather than stubbed to look finished.
- **United States foundation is built.** Official feeds, country-specific
  judgment/chat grounding, structured profile, a 17-row domestic/distribution/
  export checklist, country-scoped history/memory, and the composer nation
  switch work locally. Empty US fields produce `needs_evidence`, not guessed
  applicability. See `US-plan.md` for the evidence-dependent boundary.
- **The deeper US source layer is built and source-tested.** Federal feeds are
  agency-specific; CPSC recalls and OFAC list changes are structured entries;
  North Carolina/Charlotte and CA/NY/TX state registers are real adapters rather
  than heartbeats. Profile and confirmed-Memory facts activate them, and code
  appends caveats for inactive or unsupported packs.
- **The free US trade-data pass is integrated and live-verified.** USITC HTS,
  CBP CROSS and CSMS, targeted Federal Register overlays, USITC IDS, USTR
  Section 301, Trade.gov CSL, DHS UFLPA, and CBP WRO/forced-labor sources all
  have adapters. Full inventories use the same per-customer source ledger as
  Indonesia, so the 1,927-case IDS inventory does not become 1,927 first-run
  model judgments. `/api/screening` performs exact normalized primary/alias CSL
  matching only; it is not fuzzy identity or beneficial-ownership clearance.
- **The eCFR monitor is incremental and version-safe.** It paginates without a
  hidden entry cap, resumes from the last completed run, gives repeated section
  amendments distinct identities, resolves appendix citations, and keeps
  amendment dates separate from effective dates. The 34-test focused regression
  suite, type checker, and live source probes passed on 16 Aug 2026.
- **US run `2405fb73-d714-4f2d-804b-ce6c4ddfe3be` is the current reference.**
  The empty profile selected seven general federal sources; all succeeded and
  produced 37 entries. Judgment accounted for every one: 21 new verdicts, 16
  prior exact-URL matches, 0 unaccounted. The alert appended all four
  deterministic inactive-pack caveats and made no EAR99 claim. Federal Register
  detail pages blocked model reads, which was separately disclosed. That gap is
  now closed — see the Federal Register field notes above.
- **Historical pre-depth run `47c65faf-1b70-4313-9a0d-153126127b8f`.** All
  17 source rows succeeded; 44 regulations were fetched; 1 exact-URL-unseen
  entry was judged, 43 matched prior URLs, and 0 were unaccounted. The alert
  stayed in English and disclosed the empty profile, heartbeat-only portals,
  uncovered state distribution track, and unknown export classifications.
- Checklist is working locally at `/checklist`. `/api/checklist` refreshes rows
  from profile, memory, KBLI records, and Indonesia source-pack coverage. Surabaya
  city automation is distinguished from the blocked East Java provincial gap.
- **Indonesia full-inventory automation is verified.** Source-only probes parsed
  459 records from the seven new adapters with zero failures. Full run
  `282f54b9-6a60-4bda-849f-f14c93440707` fetched 513 records across 13 active
  sources, judged 76 bootstrap documents, and stored 403 older documents as
  baseline. Immediate repeat run
  `6c05be50-b142-47f3-80b5-ba9300895d3d` fetched the same 513 records, detected
  zero new or changed documents, made zero judgment calls, and produced zero
  findings. This is the current Indonesia reference behavior.
- Expanded run verified: `npm run check` completed as run
  `fc108a73-d887-40d8-a17d-d45eaf741229`. It attempted 12 non-blocked sources:
  Kemendag 3 views OK, Kemenkeu OK with 7 entries, OSS KBLI OK with 1 heartbeat
  entry, and peraturan.go.id/JDIHN/BSN failed and were disclosed. It produced 8
  findings: PMK 58/2026 as `noted`, six PMK entries as `clear`, and OSS KBLI as
  `baseline`.
- **Indonesia source recovery probe (16 Aug):** BSN PESTA succeeded with 19 SNI
  entries and OSS's no-auth JSON gateway succeeded with a KBLI catalogue
  heartbeat listing versions 2020 and 2025. Focused parser/retry tests and
  `npx tsc --noEmit` pass. Historical failed source rows remain unchanged.
- **Run `695357de-f968-4da3-b66a-dcb60890ec85` (15 Aug) verified all of the
  above at once**, and is the reference for what correct output looks like now:
  - 12 sources registered, **9 requests made** — peraturan.go.id failed once and
    its 4 sibling views were recorded as `Not attempted`, disclosed to the
    customer as one line ("plus 4 tampilan lain yang otomatis tidak dicoba").
  - The alert distinguishes human-confirmed codes from document-verified codes
    and does not repeat superseded guesses.
  - OSS produced **no finding**; the alert says the portal was only checked for
    reachability and "itu bukan sumber peraturan".
  - `[coverage] 35 entries — 0 judged, 34 already seen, 1 unaccounted`. The
    coverage audit caught a real gap on its first live run: the model returned
    zero verdicts, 34 entries were legitimately suppressed as already-seen, and
    one ("36 Tahun 2022") was neither — so the alert discloses it as unchecked
    rather than letting it pass as "nothing found".
- **Chat can reach the internet** — it streams over SSE and may call `WebSearch`
  and `WebFetch`. This makes the grounding rules in the chat system prompt load
  bearing, not decorative: stored run data is the only authority on what the
  monitor actually checked, and anything from the web must be labelled and
  attributed as web. A confident web answer that reads like a check result is
  precisely the failure rule 2 exists to prevent. Verified: the second run of
  15 Aug (20:09) produced **zero findings**, and the chat correctly answered a
  Permendag 23/2023 question from the web while stating the monitor had never
  seen that rule — only its fifth amendment, 12/2026, as `noted`.
- First real run: 28 findings — 1 `noted`, 1 `baseline`, 26 `clear`. Correctly
  read Permendag 12/2026's enactment date off the detail page and declined to
  flag it.
- **The fictional seed profile has no confirmed HS codes or destination markets**
  (`hsCodesConfirmed: false`). The judgment stage discloses this in every alert.
  They stay false until they come off a real export document (PEB/invoice).
- Not scheduled. Local cron via `npm run check` works today; no push, no deploy.
- Delivery is manual: open the run, copy the "ready to send" block into WhatsApp.

## Next

1. Get the customer's real KBLI from OSS/NIB and real HS code(s) from PEB/invoice;
   confirm those Memory rows so Checklist can move from leads to verified facts.
2. Add ministry-specific Permen/Kepmen feeds based on the customer's confirmed KBLI,
   products, permits, and markets; there is no reliable all-ministry central feed.
   Kemenperin is now covered via pasal.id (private re-publisher, disclosed as
   such). Next: run a real `npm run check` and read how the 23 Permenperin rows
   land in the alert — in particular whether the model honours the provenance
   hedge, and whether the 8 mandatory-SNI rules match the customer's products. Those
   SNI rules are the most likely first genuine `flagged` finding this monitor
   produces, so it is worth watching closely rather than assuming.
3. East Java provincial coverage is now automated via `api.jdih.jatimprov.go.id`
   (Perda, Pergub, Kepgub, Instruksi) — verify it in a real `npm run check` run,
   not just the source-only probe, then add verified INSW/lartas discovery.
   Surabaya city regulations and environmental notices remain automated.
4. Enter a real US pilot profile and add topic-specific state agency adapters for
   its actual distribution states; general state registers are discovery, not
   full EPR/PFAS/tax/product coverage.
5. Add persisted screening cases, fuzzy candidate generation, ownership review,
   and transaction evidence before presenting restricted-party screening as a
   complete workflow.
6. Run for ~14 days, delivering each alert by hand.
7. Ask a prospective customer directly about $200–400/month. That answer decides what happens next.

Explicitly not yet: auth, cron, deploy, WhatsApp API, billing, signup.

---

## Keeping these docs current

### HTS semantic retrieval (7 Oct 2026 historical implementation notes; see October 9 status)

The prior finding was independently verified: there was no embedding-generation
call anywhere in the repository. The existing `document_chunks` and `memories`
columns are nullable `vector(384)`; chat still uses text retrieval. Their embedding
pipeline remains separately unfinished. No chat attachment/retrieval code changed.

The owner selected OpenAI `text-embedding-3-small`, requesting `dimensions: 384`
through a dedicated REST helper, `lib/classification/embed.ts`, using the existing
`OPENAI_API_KEY`. The model supports shortened embeddings via its dimensions
parameter, matching the existing 384-dimensional convention without altering any
existing column. This does not use the chat/completion provider abstraction.
See [OpenAI API reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
and [model pricing](https://developers.openai.com/api/docs/models/text-embedding-3-small).
Standard synchronous embedding price is $0.02 per million input tokens. Batches
contain at most 75 descriptions and 8000 UTF-8 bytes (a conservative token upper
bound); oversized descriptions fail explicitly rather than being truncated.
Returned vectors, indexes and usage are validated. Logs calculate cost from actual
reported tokens and distinguish requests whose billed usage is unknown.

`supabase/migrations/202610070001_hts_schedule_embeddings.sql` adds the global
public-reference table, 384-dimensional HNSW cosine index, read grants for app
roles, and service-role-only writes. Both RPCs use `search_path = ''`; cosine
expressions use `OPERATOR(extensions.<=>)`. `publish_hts_chapter` upserts and removes
obsolete codes atomically per chapter. A failed chapter preserves its old snapshot;
retrieval filters on the live `currentRelease` so old-revision rows are excluded.
A partial run therefore supplies only successfully published current chapters,
not complete schedule coverage. Re-run failed chapters before claiming full coverage.

Commands:

```bash
npx supabase db push
node --import tsx scripts/ingest-hts-schedule.ts                  # all 01–99
node --import tsx scripts/ingest-hts-schedule.ts --chapters=39,85 # minimum regression coverage
node --import tsx scripts/verify-hts-semantic.ts
```

Re-ingest monthly or whenever USITC `currentRelease` changes. The unchanged
`flattenHtsChapter()` preserves full description ancestry and inherited rates.
The ingestion script waits one second between chapters, logs individual failures
and continues, paginates existing rows, and reuses vectors by code plus description
hash while refreshing rates/revision. It checks the release again before each
chapter publication. Failed fetches/publications produce nonzero exit status and
explicit counts, including chapters never attempted when preflight fails.

`semantic.ts` embeds name + exact description + materials and retrieves 30 rows.
`suggest.ts` unions those with the unchanged keyword retrieval, deduplicating by
code and keeping full semantic descriptions. Semantic errors stop the suggestion
explicitly. The candidate-membership check, noSuitableCandidate escape, lead tier,
and human adoption requirements remain unchanged. The feature flag remains
**disabled by default**. The optional retrieval argument isolates upstream fixtures
in existing guardrail tests; their tenant persistence still uses real Supabase.

The network/migration failures originally recorded here were October 7
observations, superseded by the October 9 rollout: all 25 migrations are now
applied, the HTS Edge Function is active version 4, signed-in historical RPC
and RLS validation passed, and 861 tests passed with no failures. Successful
migration/function deployment does not prove semantic recall or a complete new
99-chapter ingestion. Those remain separate acceptance checks; do not invent
candidate results or embedding cost measurements.

When you change the code, update the docs in the same turn — a stale CLAUDE.md is
worse than none, because the next agent trusts it.

| If you change… | Update |
|---|---|
| Anything in `lib/`, `app/`, schema, or commands | `CLAUDE.md` (this file) |
| Architecture decisions, or the plan changes | `appplan.md` |
| Positioning, competitors, pricing, or TAM | `market.md` |
| Source reliability, status, or next steps | `readme.md` |
| Scope, sequencing, what's in/out of v1 | `plan.md` |

`AGENTS.md` is a symlink to this file — edit `CLAUDE.md`, never `AGENTS.md`, so the
two can't drift.

This is enforced, not just requested: `.claude/hooks/check-docs.sh` runs on every
Stop and sends you back if anything under `lib/`, `app/`, `components/`,
`scripts/`, or the root configs is newer than `CLAUDE.md`. Updating the doc clears
it. If a change genuinely doesn't belong in any doc, say so in one line and stop —
the hook won't nag again for 15 minutes. Disable via `/hooks` if it ever gets in
the way.

Record what was *verified* versus what is *assumed*. Most of this file's value is
that its claims were tested against the live source, and that distinction is the
first thing to erode.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
