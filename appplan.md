# Cante — App Architecture (v1)

> **Status: built and working locally as of 2026-08-15.** Everything below was
> implemented as specified, with one addition the plan didn't cover: the model
> runs behind a provider seam (`lib/llm/`) so the local Claude Code CLI and a
> future hosted API are interchangeable. The definition of done at the bottom
> is met. As of 2026-08-16, the Indonesia flagship monitor attempts the broader
> source set and has a living checklist generated from
> memory/profile/KBLI/source-pack coverage. See `CLAUDE.md` for current working
> notes.

> **US expansion built 2026-08-15.** Jurisdiction is now first-class execution
> context. Indonesia and United States runs, chats, memories, profiles, and
> checklist rows are isolated; the composer switch changes actual grounding
> and official sources. See `US-plan.md` for implemented coverage.

## Goal
A properly structured Next.js app at the repo root. `npm run dev` from the root just works. Multi-tenant data model from day one, even though only one customer (MA) exists right now — so adding customer #2 is a database row, not a refactor.

Local-only for now: no GitHub push, no deploy, no cron. But the structure should be deploy-ready when that decision comes.

## Commercial expansion note

See `competitive-roadmap.md` for the post-MVP competitive roadmap. The near-term
commercial direction is global-by-design, not Indonesia-only or US-only: Cante
should become a Telegram-first trade compliance watcher for manufacturers,
organized around product codes, trade lanes, country/source packs, evidence
trails, and broker collaboration. The Indonesia monitor remains the first
working wedge, not the entire category. It should also be the deepest flagship
pack: see `indonesia-monitor-roadmap.md` for KBLI, OSS, SNI, tax/customs,
national-law, Perda, and living-checklist requirements.

## Root structure
```
/                       <- Next.js app lives here, npm run dev works from root
  app/
    (dashboard)/
      page.tsx          <- alert history view
      checklist/page.tsx <- living compliance checklist
      chat/page.tsx     <- Q&A chatbox
    api/
      checks/route.ts   <- POST: trigger a check run; GET: list check history
      checklist/route.ts <- GET/POST/PATCH checklist rows
      chat/route.ts     <- POST: Q&A grounded in stored regulation data
      customers/route.ts
  components/
    ui/                 <- shared primitives (button, card, pill, input)
    dashboard/          <- alert list, status pill, entry card
    chat/               <- message list, composer, bubbles
  lib/
    db/
      schema.ts         <- table definitions
      client.ts         <- db connection
      queries.ts        <- typed query helpers
    sources/
      registry.ts       <- source definitions per country/regulation type
      fetch.ts          <- fetching + honest success/failure reporting
    checks/
      run.ts            <- orchestrates: fetch -> judge -> store
      judge.ts          <- relevance judgment against a customer profile
      checklist.ts      <- refresh living checklist from memory/profile/source packs
  scripts/
    seed.ts             <- seed MA + Indonesian source list
  drizzle/              <- migrations
  package.json          <- at root
```

## Data layer — this is the part that has to be right
Use **SQLite via Drizzle ORM** for local dev (single file, zero setup, no Docker). Drizzle's schema is portable, so switching to Postgres later for deploy is a config change, not a rewrite. Do NOT keep reading markdown files as the data source — that's the thing that doesn't scale.

Tables, multi-tenant from the start:

- **customers** — id, name, country, created_at
- **customer_profiles** — id, customer_id, product_description, hs_codes (json), kbli_codes (json), business_type
- **jurisdiction_profiles** — country-specific facilities, NAICS, products,
  materials/processes/waste, distribution states, labels, HTS, ECCN/EAR99,
  export countries, and product flags
- **kbli_records** — first-class KBLI leads/evidence with OSS licensing metadata and confirmed/unconfirmed status
- **source_packs** — coverage inventory by country/jurisdiction/category, including manual-assisted and untested packs that are not yet fetchable
- **sources** — id, country, name, url, regulation_type (trade/tax/national/regional/standards), reliability_status (working/blocked/unstable), last_success_at
- **check_runs** — id, customer_id, jurisdiction, started_at, completed_at, status
- **source_results** — id, check_run_id, source_id, success (bool), error_message, raw_content_path — *this is what makes failures honest and visible instead of silent*
- **findings** — id, check_run_id, customer_id, regulation_ref, title, summary_id (Bahasa), summary_en, relevance (flagged/clear), source_id, created_at
- **alerts** — id, finding_id, customer_id, delivered_at, channel (whatsapp/email/manual), delivery_status
- **checklist_items** — country-scoped living obligations/evidence gaps generated from customer facts and refreshed when memory changes; `key` gives each system row a stable identity so refresh can prune rows it no longer generates instead of carrying a hardcoded list of renamed titles

Two facts the model is never allowed to decide for itself, both resolved in code before the prompt is built (`lib/checks/facts.ts`, `lib/checks/coverage.ts`): which HS/KBLI codes count as established (document > human-confirmed > lead > superseded guess), and which fetched entries actually received a verdict. Both feed coverage caveats that are written by code rather than by the model being audited.

Key point: everything is keyed by `customer_id`, and sources are keyed by country + regulation_type. That's what makes "add Vietnam" or "add tax regulations" a data change, not a code change.

## Source registry
`lib/sources/registry.ts` defines sources as data, not hardcoded logic — each with country, regulation type, URL, parser, timeout, and known reliability status. Seed it with what's already been tested:
- `jdih.kemendag.go.id` — Indonesia, trade, **working**
- `jdih.kemenkeu.go.id/home` — Indonesia, customs/tax, **working**
- `oss.go.id/id/kbli` — Indonesia, licensing/KBLI, **working heartbeat**
- `peraturan.bpk.go.id` — Indonesia, national, **blocked** (bot detection, confirmed)
- `peraturan.go.id` — Indonesia, national, **unstable** (UU/PP/Perpres/Permen attempts currently fail from local fetch; a per-run circuit breaker attempts the domain once and records the siblings as not attempted)
- `jdihn.go.id`, `pesta.bsn.go.id` — Indonesia, attempted but failing from local fetch

The fetch layer reads from this table through `selectMonitoredSources()`, skips
blocked sources, applies country-profile activation, and records every attempted
source in `source_results`. Confirmed Memory participates in activation;
unconfirmed chat extraction does not. The selector also writes deterministic
caveats for missing profile gates and unsupported state packs.

The US registry uses agency-specific Federal Register JSON, eCFR version-history
JSON, OSHA RSS, the CPSC recall API, OFAC list actions, and Cheerio-backed
official HTML adapters. The North Carolina starter pack now parses the NC
Register, DEQ releases and air notices, NCDOL updates, NCDOR notices, and
Charlotte/Mecklenburg air notices. Official CA, NY, and TX rulemaking registers
activate from facility/distribution states. A page may treat zero rows as valid
only when its source definition supplies an explicit empty-state marker and no
configured disqualifying structure is present.

eCFR selection is run-aware: the source window starts inclusively on the last
completed run's UTC date, while a first run uses a disclosed seven-day bootstrap
window. The fetcher follows every API page and fails the source on a partial page
set. A dated URL fragment is the monitoring identity, so repeat amendments to a
stable CFR citation are not suppressed as already seen. `amendedOn` never stands
in for a legal effective date.

This is deeper change discovery, not a complete state obligation engine. State
registers do not replace topic-specific EPR, PFAS, packaging, tax, product,
consumer, permit, or enforcement sources. Restricted-party screening, ECCN
classification, AES determination, and ITAR jurisdiction remain evidence and
expert workflows even though their official change feeds are monitored.

## Ported logic
The existing Python (`fetch_sources.py`, and the judgment logic in `daily-prompt-check.md`) gets ported into `lib/sources/fetch.ts` and `lib/checks/judge.ts` so everything lives in one runtime. Keep the behavior identical — especially the honest failure reporting and the "don't invent a change to seem useful" rule in the judgment step.

## UI
- Sidebar (customer switcher — one entry now, built to hold many), main panel toggling between **Checks** (alert history), **Chat** (Q&A), and **Memory** (customer facts used by chat and future checks).
- **Superseded 2026-08-15:** the design is now copied from Mike directly, not just "inspired by" it. The warm-paper Cante palette (#F6F3EC / rust / Zilla Slab) is gone.
- Mike's tokens: near-white neutrals (`--app-background: #f9fafb`, `--app-surface: #fdfdfe`), azure accent `rgb(0,136,255)`, `--radius: 0.625rem`, Inter for UI + EB Garamond for document-like content.
- Its signature pieces, copied by value: the liquid-glass recipe (`rgba(255,255,255,.65)` + `blur(40px)` + an inset white top rim), the floating `rounded-[21px]` composer docked at the bottom of the chat, and the neutral-700→black gradient send button with an arrow.
- Built in plain CSS rather than adopting Mike's Tailwind v4 + shadcn stack — same values, far smaller dependency surface.
- A **"Run check now"** button hitting `POST /api/checks` — manual trigger, no cron yet. The API route is written so a scheduler can call the same endpoint later without changes.
- Saved chat conversations are nested under the **Chat** nav item in the main sidebar; there is no second chat rail. Memory moved to a bottom sidebar button and full main-screen management page.
- Checklist is a main sidebar item next to Checks. It shows KBLI-to-rule mapping, national law, HS, OSS, SNI, tax/customs, regional, and memory-review tasks with status, priority, evidence required, source health, and open questions. Memory stays at the bottom because it is the customer fact editor, not the task queue.
- Profile is a main sidebar item. US mode exposes the structured company truth
  editor. Country controls on Checks, Checklist, Profile, Memory, and inside the
  chat composer all drive the same jurisdiction value.

## How the model gets called (added during the build)
The plan assumed judgment would just happen inside the app; it didn't say *how*, and the honest answer is that a Next.js server can't use the Claude Code login the way the markdown pipeline did. So the model sits behind `LlmProvider` in `lib/llm/`:

- **`claude-code.ts`** — spawns the local `claude` CLI headless. Works today, costs nothing, needs no key. Only works where the CLI is installed and logged in, i.e. locally.
- **`codex-cli.ts`** — local OpenAI/Codex fallback using a signed-in Codex CLI / ChatGPT plan, also no API key. The sidebar only allows selecting it when the CLI health check passes.
- **`api.ts`** — a deliberate stub that throws. Implement it only when the decision to pay for API usage has actually been made.
- Selection is `CANTE_LLM`, defaulting to `claude-code`, so an unset variable can never start billing.
- The sidebar selector persists per browser in the `cante_llm` cookie and is used by chat, checks, customer health, and post-chat memory extraction.

Validation lives *above* the seam: providers return raw text, and one Zod schema parses it in `completeJson()`. That's what keeps the two from drifting into accepting different shapes.

## Explicitly not yet
- No hosted API calls and no API key — v1 is local-only on the existing Claude Code login. This is the constraint the seam above exists to protect.
- No auth/login (but the schema is multi-tenant, so adding it later doesn't require a data migration).
- No cron/scheduler — manual trigger only, endpoint designed to be scheduler-callable later.
- No GitHub push, no deploy. Localhost only until data safety is deliberately handled.
- No WhatsApp delivery integration — `alerts.channel` exists in the schema for it, but v1 delivery is manual copy-paste.

## Definition of done
`npm install && npm run dev` at the repo root, open localhost, see MA's dashboard, click "Run check now," watch a real check run against the expanded Indonesia source set, see the result stored in the database and rendered in the UI — including an explicit note if any source failed.
