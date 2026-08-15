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
lib/checks/       judge.ts (prompt + Zod schema) · run.ts (fetch → judge → store)
lib/db/           schema.ts · client.ts · queries.ts
app/              page.tsx (Checks) · chat/ · api/{checks,chat,customers}
components/       dashboard/ · chat/ (chat-panel.tsx reads the SSE stream · markdown.tsx renders answers)
scripts/          seed.ts · run-check.ts
mike-main/        reference copy of another project — design source, gitignored,
                  excluded in tsconfig (else `next build` compiles its backend)
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
`error`) so the chat can show tool calls instead of a spinner. It is optional on
purpose: a provider without it still works through `complete()`. Callers must
handle absence — `app/api/chat/route.ts` returns **501** rather than pretending.
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

**Chat history lives under Chat in the main sidebar.** There is no second chat
rail now. Conversation links route through `/chat?conversationId=...`, and the
client chat panel adopts the selected conversation from that query param. New
conversations dispatch `cante:conversations-updated` so the nested sidebar list
refreshes without a full reload.

**Memory is its own bottom sidebar button and main screen.** `/memory` renders
the editable memory list as full-width cards, with the same add / confirm /
delete actions. Keep this separation: memory feeds future checks, so it needs
room to scan and verify instead of being buried in chat chrome.

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

Extraction (`lib/checks/remember.ts`) runs **after** the answer has streamed, so
it costs the user no latency, and swallows its own failures — a missed memory is
a small loss, a broken chat is not. It is told that an empty result is the
correct and common answer.

Verified end to end: told the chat a real HS code in one conversation, then asked
from a **fresh** conversation — it recalled it and volunteered "an unverified
lead from chat, not human-confirmed", and separately noted the stored runs still
used the guessed codes.

## Source realities (tested, not assumed)

| Source | Status | Note |
|---|---|---|
| `jdih.kemendag.go.id` | **working** | The only one polled. Three views: `semua`, `ekspor`, `perizinan`. |
| `peraturan.bpk.go.id` | **blocked** | Confirmed bot detection. Manual lookups only, never automated. |
| `peraturan.go.id` | **unstable** | Its own homepage says "Website dalam perbaikan". |
| `jdihn.go.id`, `jdih.kemenkeu.go.id` | untested | In the registry, not polled. |

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

---

## Data model

Multi-tenant from day one — everything keys off `customer_id`, sources key off
country + regulation_type, so "add customer #2" or "add Vietnam" is a row, not a
refactor. SQLite via Drizzle; the schema is portable to Postgres.

`customers` · `customer_profiles` · `sources` · `check_runs` · **`source_results`**
· `findings` · `alerts`

`source_results` is load-bearing — it's what makes a failed fetch visible in the
UI instead of silently absent.

Finding relevance values: `flagged` (send it) · `noted` (worth a manual look) ·
`baseline` (pre-existing backlog, recorded so tomorrow doesn't treat it as fresh)
· `clear` (looked at, not relevant).

---

## Current status

- Fetch, judgment, storage, dashboard, and chat all working locally, verified
  against the live Kemendag source.
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

1. Get MA's real HS code(s), destination markets, compliance contact.
2. Run for ~14 days, delivering each alert by hand.
3. Ask MA directly about $200–400/month. That answer decides what happens next.

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
