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
npm run db:push    # apply lib/db/schema.ts to cante.db
npm run db:seed    # seed sources + MA from config/customer.json
npm run build      # must stay clean
npx tsc --noEmit   # must stay clean
```

A full check takes several minutes: fetch, then ~28 judgments each fetching a
detail page. `npm run check` is the fastest way to test without the browser.

---

## Layout

```
lib/llm/          types.ts = the seam (+ streaming) · claude-code.ts (works) · codex-cli.ts (local fallback) · api.ts (stub) · index.ts (factory)
lib/sources/      registry.ts (sources as data) · fetch.ts (no AI, plain fetch+parse)
lib/checks/       judge.ts (prompt + Zod schema) · run.ts (fetch → judge → store) · checklist.ts (living obligations)
                  facts.ts (HS/KBLI tiers — the one answer to "what is established") · coverage.ts (entries in, verdicts out)
lib/db/           schema.ts · client.ts · queries.ts
app/              page.tsx (Checks) · checklist/ · chat/ · memory/ · api/{checks,checklist,chat,customers,memories}
components/       dashboard/ · checklist/ · memory/ · chat/ (chat-panel.tsx reads the SSE stream · markdown.tsx renders answers)
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
| `jdih.kemenkeu.go.id/home` | **working** | Polled for PMK/customs/duty/tax entries; latest smoke test parsed 7 entries. |
| `oss.go.id/id/kbli` | **working** | Polled as an OSS/KBLI portal heartbeat. Specific KBLI mapping still requires confirmed KBLI codes. |
| `peraturan.bpk.go.id` | **blocked** | Confirmed bot detection. Manual lookups only, never automated. |
| `peraturan.go.id` | **unstable** | UU, PP, Perpres, Permen, and homepage monitor attempts are recorded; latest local fetch failed. |
| `jdihn.go.id` | **unstable/untested** | Monitor attempt is recorded; latest local fetch failed. |
| `pesta.bsn.go.id/produk` | **unstable/untested** | SNI catalogue monitor attempt is recorded; latest local fetch failed. |

`source_packs` is the broader coverage inventory, not a claim of automation.
Seeded Indonesia packs now include Kemendag trade, KBLI/OSS, UU, PP,
Perpres/Kepres, Permen/Kepmen, Kemenkeu/DJBC/DJP tax-customs, BSN/SNI, and East
Java / Surabaya regional rules. All non-blocked source rows are attempted by
`monitoredSources()`; failures become `source_results` rows and coverage caveats.

Things about this feed that will mislead you if forgotten:

- **The listing carries a year, not a date.** Detail pages carry the real
  `Tanggal Penetapan / Pengundangan`. Never assert recency from the listing alone.
  This is not theoretical: Permendag 12/2026 reads like a major export-policy
  change from its title and was enacted 28 April 2026. Title-only judgment sends a
  false alert on day one.
- **Each view shows ~10 of ~2,386 entries.** Fine for a daily poll; a multi-day gap
  lets items scroll past unseen, and the alert has to say so.
- **`entriesParsed: 0` on a successful fetch means the parser broke**, not that it
  was a quiet day. Treat as unchecked and disclose it.
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

---

## Data model

Multi-tenant from day one — everything keys off `customer_id`, sources key off
country + regulation_type, so "add customer #2" or "add Vietnam" is a row, not a
refactor. SQLite via Drizzle; the schema is portable to Postgres.

`customers` · `customer_profiles` · `kbli_records` · `source_packs` · `sources`
· `check_runs` · **`source_results`** · `findings` · `alerts` · `conversations`
· `chat_messages` · `memories` · `checklist_items`

`source_results` is load-bearing — it's what makes a failed fetch visible in the
UI instead of silently absent.

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
- Checklist is working locally at `/checklist`. `/api/checklist` refreshes rows
  from profile, memory, KBLI records, and Indonesia source-pack coverage. Current
  MA state produces 9 rows, 7 open, including KBLI-to-rule mapping and
  national-law monitoring.
- Expanded run verified: `npm run check` completed as run
  `fc108a73-d887-40d8-a17d-d45eaf741229`. It attempted 12 non-blocked sources:
  Kemendag 3 views OK, Kemenkeu OK with 7 entries, OSS KBLI OK with 1 heartbeat
  entry, and peraturan.go.id/JDIHN/BSN failed and were disclosed. It produced 8
  findings: PMK 58/2026 as `noted`, six PMK entries as `clear`, and OSS KBLI as
  `baseline`.
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
2. Improve retrieval for peraturan.go.id/JDIHN/BSN, which are now attempted but
   failing from local plain fetch.
3. Add region-specific East Java / Surabaya JDIH source discovery.
4. Run for ~14 days, delivering each alert by hand.
5. Ask MA directly about $200–400/month. That answer decides what happens next.

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
