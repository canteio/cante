# Cante — App Architecture (v1)

> **Status: built and working locally as of 2026-08-15.** Everything below was
> implemented as specified, with one addition the plan didn't cover: the model
> runs behind a provider seam (`lib/llm/`) so the local Claude Code CLI and a
> future hosted API are interchangeable. The definition of done at the bottom
> is met. See `CLAUDE.md` for current working notes.

## Goal
A properly structured Next.js app at the repo root. `npm run dev` from the root just works. Multi-tenant data model from day one, even though only one customer (MA) exists right now — so adding customer #2 is a database row, not a refactor.

Local-only for now: no GitHub push, no deploy, no cron. But the structure should be deploy-ready when that decision comes.

## Root structure
```
/                       <- Next.js app lives here, npm run dev works from root
  app/
    (dashboard)/
      page.tsx          <- alert history view
      chat/page.tsx     <- Q&A chatbox
    api/
      checks/route.ts   <- POST: trigger a check run; GET: list check history
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
- **sources** — id, country, name, url, regulation_type (trade/tax/national/regional/standards), reliability_status (working/blocked/unstable), last_success_at
- **check_runs** — id, customer_id, started_at, completed_at, status
- **source_results** — id, check_run_id, source_id, success (bool), error_message, raw_content_path — *this is what makes failures honest and visible instead of silent*
- **findings** — id, check_run_id, customer_id, regulation_ref, title, summary_id (Bahasa), summary_en, relevance (flagged/clear), source_id, created_at
- **alerts** — id, finding_id, customer_id, delivered_at, channel (whatsapp/email/manual), delivery_status

Key point: everything is keyed by `customer_id`, and sources are keyed by country + regulation_type. That's what makes "add Vietnam" or "add tax regulations" a data change, not a code change.

## Source registry
`lib/sources/registry.ts` defines sources as data, not hardcoded logic — each with country, regulation type, URL, and known reliability status. Seed it with what's already been tested:
- `jdih.kemendag.go.id` — Indonesia, trade, **working**
- `peraturan.bpk.go.id` — Indonesia, national, **blocked** (bot detection, confirmed)
- `peraturan.go.id` — Indonesia, national, **unstable** (site maintenance)
- `jdihn.go.id`, `jdih.kemenkeu.go.id` — Indonesia, untested

The fetch layer reads from this table, skips sources marked blocked, and records every attempt in `source_results`. When a source fails, that fact surfaces in the UI — never silently reported as "checked, nothing found."

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

## How the model gets called (added during the build)
The plan assumed judgment would just happen inside the app; it didn't say *how*, and the honest answer is that a Next.js server can't use the Claude Code login the way the markdown pipeline did. So the model sits behind `LlmProvider` in `lib/llm/`:

- **`claude-code.ts`** — spawns the local `claude` CLI headless. Works today, costs nothing, needs no key. Only works where the CLI is installed and logged in, i.e. locally.
- **`api.ts`** — a deliberate stub that throws. Implement it only when the decision to pay for API usage has actually been made.
- Selection is `CANTE_LLM`, defaulting to `claude-code`, so an unset variable can never start billing.

Validation lives *above* the seam: providers return raw text, and one Zod schema parses it in `completeJson()`. That's what keeps the two from drifting into accepting different shapes.

## Explicitly not yet
- No hosted API calls and no API key — v1 is local-only on the existing Claude Code login. This is the constraint the seam above exists to protect.
- No auth/login (but the schema is multi-tenant, so adding it later doesn't require a data migration).
- No cron/scheduler — manual trigger only, endpoint designed to be scheduler-callable later.
- No GitHub push, no deploy. Localhost only until data safety is deliberately handled.
- No WhatsApp delivery integration — `alerts.channel` exists in the schema for it, but v1 delivery is manual copy-paste.

## Definition of done
`npm install && npm run dev` at the repo root, open localhost, see MA's dashboard, click "Run check now," watch a real check run against the live Kemendag source, see the result stored in the database and rendered in the UI — including an explicit note if any source failed.
