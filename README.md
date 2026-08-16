# Cante — Indonesia Export Compliance Monitor

A daily automated check of official Indonesian government trade sources, matched against one exporter's product, that produces a plain-language alert (Bahasa Indonesia + a one-line English gloss) **only when something genuinely relevant changed**. Nothing to report is the expected outcome most days — accuracy over always having something to say.

First customer: **MA**, PVC tarpaulin manufacturer, Surabaya. Real, live, in progress.

**v1 costs nothing to run.** It uses the Claude Code login already on the machine instead of an API key. That's a hard constraint, not a preference: nothing bills until the live test says the idea is worth paying for.

---

## Running it

Needs Node 22+ and the [Claude Code](https://claude.com/claude-code) CLI installed and logged in (`claude --version` should work in your terminal).

```bash
npm install
npm run db:push     # create cante.db from the schema
npm run db:seed     # seed the sources + MA
npm run dev         # http://localhost:3000
```

Open localhost:3000 and press **Run check now**. It fetches the monitored
Indonesian source set, reads what it finds, and stores the result. Takes a few
minutes — it fetches listings first, then detail pages for plausible candidates.

### Other commands

| Command | What it does |
|---|---|
| `npm run check` | Same check, from the terminal. Identical code path to the button — this is what a cron entry would call. |
| `npm run build` | Production build. |
| `npm run db:push` | Apply `lib/db/schema.ts` to `cante.db`. |
| `npm run db:seed` | Seed sources + customer from `config/customer.json`. |

### Where things are stored

**One SQLite file, `cante.db`, at the repo root.** No database server, nothing to start — the app opens the file directly. Delete it and rebuild with `db:push && db:seed`; you lose run history, not code. `raw/` holds the fetched source HTML from the last run as an evidence trail. Both are gitignored.

### If it can't find the model

The app spawns the `claude` CLI per request and inherits the `PATH` of whatever shell started `npm run dev`. The sidebar shows provider health on every page load. If it's red:

```bash
CLAUDE_BIN=/path/to/claude npm run dev
```

---

## How it works

Two stages, kept separate because a **fetch failure** and a **bad judgment call** are different problems and were getting silently conflated:

**1. Fetch — `lib/sources/fetch.ts`.** Plain fetching and parsing, no AI. Pulls three listing views with browser headers and a 25s timeout, saves the raw HTML, and parses each page into structured entries — recovering the full title from each detail-URL slug, because the listing truncates titles exactly where the useful part is. Writes one `source_results` row per source per run: success, error, entries parsed, parse warning.

**2. Judge — `lib/checks/judge.ts`.** Reads the parsed entries plus the customer profile and the dedup log, and judges relevance the way a person would — not keyword matching, since most relevant regulations won't contain "PVC" or "tarpaulin" in the title. Returns a Zod-validated verdict per regulation (`flagged` / `noted` / `baseline` / `clear`) plus a ready-to-send message.

The model sits behind a provider seam in `lib/llm/`. The working default shells
out to the local `claude` CLI. The sidebar can also select a local Codex /
ChatGPT CLI provider when `codex --version` is healthy. `lib/llm/api.ts` is a
deliberate hosted-API stub — switching to paid API usage later is an explicit
decision, not something an unset variable can trigger. Validation lives *above*
the seam (providers return raw text; one Zod schema parses it), so they can't
drift into accepting different shapes.

Delivery is manual: open the run, copy the "ready to send" block into WhatsApp. Automating that is a deliberate fast-follow, not a v1 blocker.

### The design constraint everything follows from

**Honest failure beats useful-looking output.** A source that failed and a regulation that isn't relevant are different facts, and neither may be rendered as "checked, nothing found". That's why `source_results` is its own table, why a fetch that succeeds but parses zero entries is tracked separately from a failure, and why every alert carries explicit coverage caveats.

Two properties of the source that can't be engineered away, so the judgment stage is told to respect them:

- **The listing carries a year, not a date — but detail pages carry the real enactment date** (`Tanggal Penetapan / Pengundangan`). Recency is knowable, at the cost of one extra fetch per candidate. This is not theoretical: Permendag 12/2026 reads like a major export-policy change from its title and was enacted 28 April 2026. Title-only judgment sends a false alert on day one.
- **Each view shows ~10 of ~2,386 entries.** Fine for a daily poll; a multi-day gap lets items scroll past unseen, and the alert has to say so.

### Layout

```
lib/llm/          types.ts (the seam) · claude-code.ts (works) · api.ts (stub) · index.ts
lib/sources/      registry.ts (sources as data) · fetch.ts
lib/checks/       judge.ts · run.ts (fetch → judge → store) · checklist.ts
lib/db/           schema.ts · client.ts · queries.ts
app/              page.tsx (Checks) · checklist/ · chat/ · memory/ · api/{checks,checklist,chat,customers,memories}
components/       dashboard/ · checklist/ · memory/ · chat/
scripts/          seed.ts (sources + Indonesia source packs + MA) · run-check.ts
config/           customer.json — read at seed time only
```

Multi-tenant from day one: everything keys off `customer_id`, sources key off country + regulation type. Adding customer #2 or a second country is a row, not a refactor. SQLite via Drizzle, portable to Postgres if deploy ever happens.

---

## Data sources (tested directly, not assumed)

- **jdih.kemendag.go.id/peraturan** — reliable and fetchable. Kemendag's own regulation list, the primary source. Fetched in three views: unfiltered newest-first, plus `Tematik: Ekspor` and `Tematik: Perizinan`. The Ekspor filter matters — it surfaces the "Kebijakan dan Pengaturan Ekspor" Permendag rules that don't appear in the unfiltered top 10 at all.
- **jdih.kemenkeu.go.id/home** — reliable in the latest run. Monitored for PMK, customs, duty, tariff, and tax-administration entries.
- **oss.go.id/id/kbli** — reachable as an OSS/KBLI portal heartbeat. Complete KBLI obligation mapping still needs a confirmed KBLI code from OSS/NIB.
- **Caveat on HPE:** the unfiltered feed is dominated by Harga Patokan Ekspor decrees — commodity reference prices for mining, palm, agriculture and forestry. They never cover PVC tarpaulin. Volume here is not signal.
- **Official Kemendag newsletter** ("Berlangganan Newsletter JDIH Kemendag") — signed up. The government pushing updates directly is more reliable than scraping anything.
- **peraturan.bpk.go.id** — confirmed blocks bots. In the registry as `blocked`; never fetched automatically. Still the deepest archive for manual lookups.
- **peraturan.go.id** — unstable. UU, PP, Perpres, Permen, and homepage monitor attempts are recorded; latest local fetch failed.
- **jdihn.go.id** — attempted and recorded; latest local fetch failed.
- **pesta.bsn.go.id/produk** — attempted for SNI catalogue coverage; latest local fetch failed.

The wider Indonesia monitor is tracked in `source_packs`, separate from daily
fetch rows. Seeded packs now cover Kemendag trade, KBLI/OSS, UU, PP,
Perpres/Kepres, Permen/Kepmen, Kemenkeu/DJBC/DJP tax-customs, BSN/SNI, and East
Java / Surabaya regional rules. All non-blocked source rows are attempted by the
monitor; failures are shown as coverage caveats, not hidden.

---

## Status

- **Working end to end locally.** Dashboard → Run check now → expanded live fetch, judgment, stored result, rendered alert. Chat Q&A grounded in stored run data also works.
- **Expanded Indonesia monitor verified.** Latest full run attempted 12 non-blocked sources: Kemendag 3 views OK, Kemenkeu OK, OSS KBLI OK, and peraturan.go.id/JDIHN/BSN failed and were disclosed. It produced 8 findings, including PMK 58/2026 as `noted`.
- **Checklist is now first-class.** `/checklist` shows a living compliance work queue generated from customer profile, memory, KBLI records, and source coverage. Chat-extracted or manually entered facts refresh it automatically. Current MA state creates 9 rows covering KBLI-to-rule mapping, national law, HS codes, OSS, SNI, tax/customs, regional Perda, and memory review; 7 remain open because evidence/source retrieval is still incomplete.
- **Chat now streams and can search the web.** Answers arrive token by token over SSE with live tool activity shown as it happens: elapsed seconds, phase labels, a visible thinking log, search scan pills with official-source favicons, web-read favicons, and an animated thinking card. The stream closes as soon as the answer is saved, while memory extraction runs in the background so the composer is not stuck waiting. HS-code questions asking for new/latest regulation discovery get an explicit search directive to hit official Indonesian sources immediately. The model may call `WebSearch` / `WebFetch` for outside context — what a regulation actually says, background on an HS code. The two sources of truth are kept explicitly separate in the prompt: stored run data is the only authority on what the monitor checked, and web findings must be attributed to their source. "The 14 Aug run flagged X" and "Kemendag's site says X" have to read differently — a web answer dressed up as a check result is the exact failure this product exists to avoid. Still no API spend: it's the same local CLI provider behind the same seam.
- First real judgment run: 28 findings — 1 `noted`, 1 `baseline`, 26 `clear`. It fetched Permendag 12/2026's detail page, read the real enactment date, and declined to flag it. The day-one false alert the design exists to prevent, prevented in practice rather than in theory.
- The alert disclosed the unconfirmed HS codes, unknown destination markets, the ~10-of-2,386 window, and the bootstrap caveat without being prompted per-run.
- **MA's HS codes and destination markets are still unconfirmed placeholders** — `hsCodesConfirmed: false` in the database, so no alert can present them as verified.
- Not scheduled yet. `npm run check` is the identical code path, so a local cron entry needs no new code. Cante isn't its own git repo (the enclosing repo's remote is unrelated), so cloud scheduling would need a repo of its own first.
- The Python-era pipeline (`scripts/fetch_sources.py`, `alerts/*.md`, `raw/*.json`) was deleted once the TypeScript port was verified to produce identical output. `daily-prompt-check.md` is kept — it's the prose the judgment stage was ported from and still the clearest statement of the rules.

## Next

1. Get MA's actual KBLI from OSS/NIB, actual HS code(s), destination markets, and compliance contact; confirm those facts once they come off real evidence (PEB / invoice / OSS).
2. Improve retrieval for peraturan.go.id/JDIHN/BSN, which are now attempted but failing from local plain fetch.
3. Add East Java / Surabaya regional JDIH source discovery.
4. Put the check on a daily schedule — local cron calling `npm run check` is enough.
5. Run it for real for ~14 days, delivering each alert by hand.
6. Ask MA directly whether they'd pay $200–400/month. That answer, not more research, decides what happens next.

Only after that answer is yes: implement `lib/llm/api.ts`, add a key, deploy.

Explicitly not yet: auth, cron, deploy, WhatsApp API, billing, signup page.

---

## Why this idea

Copy Vanta's business model, not its product: watch something automatically, alert people when it changes, charge monthly, sell to businesses too small to hire someone for it. Point that mechanism at Indonesian trade/export compliance instead of security compliance.

Every proven $1M/month+ AI company (Harvey, Decagon, Clay, Vanta itself) took years of execution on one idea, not a better initial pick. The lesson: stop searching for a pre-proven idea and execute on a proven mechanism instead.

**Competitive reality check (verified, not assumed):**

- US/EU import-side trade compliance software already exists and is competed (Gaia Dynamics, Descartes, AEB) — don't rebuild that.
- Nobody found serving the **export side** of a country like Indonesia — a local manufacturer tracking their own government's rules, delivered in Bahasa Indonesia over WhatsApp instead of an English dashboard. That's the actual gap, and it's narrower than first assumed — verify further before assuming it's empty.
- Accounting-for-AI-agents (a rejected pivot) is not open: Xero already has an official MCP server and a 2026 Anthropic partnership; multiple funded platforms (Nango, Composio, Apideck) already cover this. Correctly avoided.
