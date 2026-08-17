# Cante — working notes for agents

Daily automated check of Indonesian government trade sources, matched against one
exporter's product, producing a plain-language alert only when something genuinely
changed. First customer: **MA**, PVC tarpaulin manufacturer, Surabaya.

Business model is Vanta's, pointed at Indonesian *export* compliance: watch
something automatically, alert on change, charge monthly, sell to businesses too
small to hire someone for it.

---

## The two rules that govern everything

**1. No API spend.** v1 runs entirely on the local Claude Code login. `CANTE_LLM`
defaults to `claude-code`, so an unset variable can never start billing. Do not
implement `lib/llm/api.ts`, do not add `@anthropic-ai/sdk`, and do not suggest a
deploy that needs a key — until the user explicitly says they're ready to pay.

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

---

## Commands

```bash
npm run dev        # Next.js at localhost:3000
npm run check      # same code path as POST /api/checks, from the terminal
CANTE_COUNTRY="United States" npm run check  # run the US pack
npm run db:push    # apply lib/db/schema.ts to cante.db
npm run db:seed    # seed sources + MA from config/customer.json
npm test           # focused source-window/parser regression tests
npm run build      # must stay clean
npx tsc --noEmit   # must stay clean
```

A full check takes several minutes: the profile first selects applicable source
packs, then the judgment stage may fetch detail pages. `npm run check` is the
fastest way to test without the browser.

---

## Layout

```
lib/llm/          types.ts = the seam (+ streaming) · claude-code.ts (works) · codex-cli.ts (local fallback) · api.ts (stub) · index.ts (factory)
lib/sources/      registry.ts (sources + profile activation as data) · fetch.ts (no AI, fetch+JSON/RSS/Cheerio parse)
                  *.test.ts (incremental windows, pagination, source-field contracts)
lib/screening/    csl.ts (bounded, cached exact-name matching against Trade.gov CSL bulk data)
                  persist.ts (screens as dated, auditable events; `error` is never `clear`)
lib/checks/       judge.ts (prompt + Zod schema) · run.ts (fetch → judge → store) · checklist.ts (living obligations)
                  facts.ts (HS/KBLI tiers — the one answer to "what is established") · coverage.ts (entries in, verdicts out)
lib/catalogue/    products.ts (SKUs + CSV import) · classifications.ts (tiered code history + approval)
                  lanes.ts (trade lanes, suppliers) · csv.ts (quote-correct reader, no dependency)
lib/impact/       assess.ts (finding → affected SKUs/lanes → exposure, or an honest null)
lib/documents/    audit.ts (PEB/invoice text → line items → discrepancies → document-tier promotion)
lib/workflow/     actions.ts (finding → human response, kept separate from the evidence)
lib/suppliers/    evidence.ts (certificate status, gaps, expiry horizon)
lib/test-support/ operating-db.ts (throwaway SQLite + per-test tenant isolation)
lib/db/           schema.ts · client.ts · queries.ts
app/              page.tsx (Checks) · checklist/ · chat/ · memory/ · catalogue/ · documents/ · workqueue/ · suppliers/
                  api/{checks,checklist,chat,customers,memories,screening,products,classifications,lanes,documents,workqueue,suppliers}
components/       dashboard/ · checklist/ · memory/ · chat/ (chat-panel.tsx reads the SSE stream · markdown.tsx renders answers)
                  catalogue/ · documents/ · workqueue/ · suppliers/ (the Operations screens)
scripts/          seed.ts (sources + source packs + MA) · run-check.ts
mike-main/        reference copy of another project — design source, gitignored,
                  excluded in tsconfig (else `next build` compiles its backend)
uigen-claude/     reference copy used for chat streaming/thinking UI patterns,
                  excluded in tsconfig for the same reason
config/           customer.json — read only at seed time now
raw/              source HTML, rewritten every run (gitignored, write-only debug trail)
cante.db          the SQLite file (gitignored)
```

**Where data lives.** One SQLite file, `cante.db`, at the repo root. No database
server, no cloud, nothing to start. `lib/db/client.ts` opens it directly. Delete it
and rebuild with `npm run db:push && npm run db:seed` — you lose run history, not
the code. The `-shm`/`-wal` siblings are WAL-mode bookkeeping; leave them alone.

`CANTE_DB_PATH` overrides the location, useful for testing against a throwaway
database. **`drizzle.config.ts` and `lib/db/client.ts` must both read it** — they
drifted once, and the symptom is silent: `db:push` writes the schema to one file
while the app reads another and fails with `SQLITE_ERROR: no such table`.

**The seam.** Nothing above `LlmProvider` knows which provider it got. Providers
return raw text and never validate; one Zod schema parses it in
`completeJson()`, so the two providers cannot drift into accepting different
shapes. Switching to the API later is `lib/llm/api.ts` plus one env var — keep it
that way.

**Provider switching is local-only.** The sidebar selector writes a `cante_llm`
cookie. `claude-code` is the working default. `codex-cli` is the intended
OpenAI/ChatGPT fallback through a signed-in local Codex CLI, not an API key; it
is only selectable when `codex --version` works. `api` stays visible but disabled
until the user explicitly accepts API spend.

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

`lib/checks/facts.ts` is the single place that answers "which HS codes are in
force", because the profile and memory had drifted into contradicting each
other: `customer_profiles.hsCodes` held the seed-time guesses (3921.90, 6306.12,
3926.90) with `hsCodesConfirmed: false`, while four **human-confirmed** memory
rows named specific codes (6306.19.90, 3920.43.90, 3921.12.00, 3918.90.99). The
prompt asserted both sets at once.

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
| `peraturan.bpk.go.id` | **blocked** | Confirmed bot detection. Manual lookups only, never automated. |
| `peraturan.go.id` | **blocked** | Public service remains unreliable. Superseded for six national instrument types by Setneg; it is not retried on daily runs. |
| `jdihn.go.id` | **blocked** | The old central host times out and the replacement is not a dependable public document API. Member ILDIS feeds remain an expansion route. |
| East Java JDIH | **blocked** | Works interactively but Cloudflare rejects unattended fetches. Disclosed as a manual regional gap. |
| `pesta.bsn.go.id/produk` | **working** | Live probe parsed 19 SNI records. Server-rendered HTML, not a public API; one retry handles transient transport/server failures. |

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
| Federal Register API | **working** | Thirteen no-key agency feeds were live-probed: EPA, OSHA, FTC, CPSC, FDA, USDA, FCC, DOT/NHTSA, BIS, Census, OFAC, CBP, and State/DDTC. Each agency gets its own result window instead of competing in one broad query. Queried with an explicit `fields[]` list — see below, this is load-bearing. |
| eCFR versioner API | **working** | Titles 15, 16, 21, 29, 31, 40, and 49. Each run resumes inclusively from the last completed run; a first run uses a disclosed seven-day bootstrap window. Every API page and every substantive dated amendment is retained. Export and sector titles activate from profile facts. |
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

- **No OCR or PDF extraction.** `ingestDocument()` takes text and says so in its
  error rather than accepting a scan and producing an empty, clean-looking audit.
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
refactor. SQLite via Drizzle; the schema is portable to Postgres.

`customers` · `customer_profiles` · `jurisdiction_profiles` · `kbli_records` · `source_packs` · `sources`
· `check_runs` · **`source_results`** · **`source_documents`** · `findings` · `alerts` · `conversations`
· `chat_messages` · `memories` · `checklist_items`

Operating data (the customer's own business, not regulations):
**`products`** · `product_classifications` · `trade_lanes` · `suppliers`
· `supplier_documents` · `trade_documents` · `document_findings`
· `finding_actions` · `impact_assessments` · `screening_results`

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
  from profile, memory, KBLI records, and Indonesia source-pack coverage. Current
  MA state produces 11 rows, including environment and labor/OHS. Surabaya
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
  - The alert reasons from the **human-confirmed** codes (6306.19.90, 3920.43.90,
    3921.12.00, 3918.90.99), says plainly they have never been matched against a
    PEB or invoice, and no longer repeats the superseded guesses.
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
- **MA's HS codes and destination markets are unconfirmed placeholders**
  (`hsCodesConfirmed: false`). The judgment stage discloses this in every alert.
  They stay false until they come off a real export document (PEB/invoice).
- Not scheduled. Local cron via `npm run check` works today; no push, no deploy.
- Delivery is manual: open the run, copy the "ready to send" block into WhatsApp.

## Next

1. Get MA's real KBLI from OSS/NIB and real HS code(s) from PEB/invoice;
   confirm those Memory rows so Checklist can move from leads to verified facts.
2. Add ministry-specific Permen/Kepmen feeds based on MA's confirmed KBLI,
   products, permits, and markets; there is no reliable all-ministry central feed.
3. Find a structured East Java provincial route and add verified INSW/lartas
   discovery. Surabaya city regulations and environmental notices are automated.
4. Enter a real US pilot profile and add topic-specific state agency adapters for
   its actual distribution states; general state registers are discovery, not
   full EPR/PFAS/tax/product coverage.
5. Add persisted screening cases, fuzzy candidate generation, ownership review,
   and transaction evidence before presenting restricted-party screening as a
   complete workflow.
6. Run for ~14 days, delivering each alert by hand.
7. Ask MA directly about $200–400/month. That answer decides what happens next.

Explicitly not yet: auth, cron, deploy, WhatsApp API, billing, signup.

---

## Keeping these docs current

When you change the code, update the docs in the same turn — a stale CLAUDE.md is
worse than none, because the next agent trusts it.

| If you change… | Update |
|---|---|
| Anything in `lib/`, `app/`, schema, or commands | `CLAUDE.md` (this file) |
| Architecture decisions, or the plan changes | `appplan.md` |
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
