# Cante — Autonomous Compliance OS ("Compliance Done For You")

> **Vision**: An autonomous AI compliance workforce that monitors 52+ official government gazettes, audits 5-way shipping documents, and handles customs defense so the CEO can sleep peacefully.
>
> 📖 **Read the Strategy & Positioning Doc**: [`AGENTIC-COMPLIANCE-POSITIONING.md`](./AGENTIC-COMPLIANCE-POSITIONING.md)
>
> 🚀 **Supabase/Vercel prep**: [`SUPABASE_VERCEL.md`](./SUPABASE_VERCEL.md)

A country-scoped monitor of official regulatory sources, matched against one
manufacturer's actual products and operations. **Export is optional** — a purely
domestic factory is a first-class customer, and `sideOfTrade`
(`domestic | import | export | both`) decides whether cross-border sources are
polled. All 13 Indonesian sources and 29 of 52 US sources apply to a domestic
manufacturer; an importer additionally gets Section 301, AD/CVD, UFLPA and
19 CFR without ever exporting. Indonesia remains the deepest
flagship pack; the United States pack keeps domestic manufacturing,
distribution, and exports as separate coverage tracks. It alerts **only when
something genuinely relevant changed**.

The bundled Example Company profile is fictional, based in Chicago, United States, and contains no verified compliance facts.

The daily monitor still uses the signed-in local Claude/Codex CLI, so that high-volume job does not require a hosted key. The deployed chat uses an explicitly configured OpenAI or Anthropic API because Vercel cannot run a desktop CLI. API spend starts only when `CANTE_LLM=api` is set.

---

## Running it

Needs Node 22+ and the [Claude Code](https://claude.com/claude-code) CLI installed and logged in (`claude --version` should work in your terminal).

```bash
npm install
npm run db:push     # create cante.db from the schema
npm run db:seed     # seed the sources + Example Company
npm run dev         # http://localhost:3000
```

Open localhost:3000 for the public landing page. The operational app is at
`/chat`, `/checks`, `/checklist`, and `/profile`; open `/checks` and press
**Run check now** to fetch the monitored source set for the selected country,
read what it finds, and store the result. Takes a few minutes — it fetches
listings first, then detail pages for plausible candidates.

The public surface is intentionally minimal: a muted video backdrop, the
centred, compact serif "Build the AI compliance team you don't have." hero, one
access button, and an
unframed daily-scan stream rising from the bottom. It deliberately has no mesh,
agent cards, metrics, feature grid, or dashboard preview. Search-oriented
compliance-monitoring language stays in metadata so it does not distort the
visual composition. The illustrative scan currently uses U.S. source examples:
Federal Register, USITC HTS, and EPA TSCA.

The public, authentication, and dashboard wordmarks use the same restrained
beagle sentinel mark: a one-color side profile whose long ear creates a strong
negative-space sweep on a transparent background. `public/cante-beagle.png` is
the shared static artwork and `app/icon.png` is its matching browser favicon.
The dark landing page inverts the same asset to white; light surfaces render it
in black. There is no tile, gray fill, or logo animation.

For the local demo gate, open `/login` and use:

```txt
username: demo
password: demo
```

This only sets a local demo cookie. It is not production authentication.
Both `/login` and `/request-access` use the same minimal light-background form
layout; the latter prepares a prefilled access-request email.

For production, apply the Supabase migration and one-time SQLite import described in [`SUPABASE_VERCEL.md`](./SUPABASE_VERCEL.md), then set:

```txt
CANTE_AUTH_MODE=supabase
NEXT_PUBLIC_CANTE_AUTH_MODE=supabase
CANTE_DATA_BACKEND=supabase
CANTE_LLM=api
CANTE_LLM_LOCKED=true
```
Vercel receives the Supabase URL/publishable key and one hosted AI key. The Supabase secret key belongs only on the trusted local sync worker and must not be added to Vercel.

---

## Tariff-stacking calculator (new, additive — `/chat` is unchanged)

`GET /api/tariff/stack?code=<HTS code>&country=<origin>&value=<USD>` answers the
question Kate Chang (The Toro Company, customer-discovery interview,
2026-10-01 — see `gbrain cante/interviews/kate-chang-toro-company`) described
as Cante's clearest V1: upload an HTS code + country of origin and get back
the total landed duty rate, broken down by component, with the stacking
logic spelled out in plain English and a citation for each applicable rule.

What it computes for real today:
- **Base/Column 1 duty** — live from the USITC HTS schedule (`lib/tariff/rates.ts`).
- **China Section 301** — resolved from the HTS row's own Chapter 99
  cross-reference (e.g. "See 9903.88.03") against a verified table of the
  four List actions (`lib/tariff/section301.ts`), each entry carrying its
  current in-force rate, effective date, and Federal Register citation(s).
  Only applies when country of origin is China; the response says so
  explicitly either way.
- **Section 232 steel/aluminum "basic article" tariffs** — resolved from a
  fixed, enumerated list of Chapter 72/73/76 headings
  (`lib/tariff/section232.ts`) at the current 50% ad valorem rate (25% for
  United Kingdom origin under the US-UK Economic Prosperity Deal), citing
  Proclamations 10895/10896/10947 and their Federal Register notices
  (90 FR 11249, 90 FR 11251, 90 FR 24199). Deliberately does NOT cover
  Section 232 *derivative* products (manufactured goods that merely contain
  steel/aluminum, e.g. washing machines) — that list is actively expanding
  via BIS's inclusions process and a snapshot of it would misrepresent
  coverage as complete.
- **Section 301 supplemental fallback** (`lookupSection301Supplemental`) —
  matches only cited eight-digit subheadings (including statistical children)
  or an exact ten-digit ruling classification, when the row's additional-duty
  text is empty. No six-digit family matching. USTR 84 FR 43304 Annex A
  supports 6404.11.20/.71/.79/.81/.89/.90 as active List 4A; Annex C's
  .41/.49/.51/.59/.61/.69/.75/.85 receive no active fallback and remain
  review-needed without a row reference. List 4B is suspended under
  9903.88.16 (84 FR 69447); CBP CSMS #19-000238 and 84 FR 20459 establish
  9903.88.04 as an active List 3 companion heading at the current 25% rate.
  Missing membership evidence is explicitly unresolved. Both reference and
  supplemental paths withhold the current rate for import dates before its
  effective date. Future entry dates also withhold aggregate totals because
  later legal changes are unknowable. This table does not implement a
  historical rate schedule or establish comprehensive coverage.
- **Section 338 Canada duties** (`lib/tariff/section338.ts`) — new Aug 22,
  2026 additional 50% ad valorem duty on Canada-origin goods under 19 U.S.C.
  1338, imposed by three parallel proclamations (alcohol, dairy, and a
  motor-vehicle-basket proclamation that is mostly non-vehicle consumer/
  industrial goods) citing FR docs 2026-14991/14992/14997. Covers a small
  verified subset of HTS lines (whisky/liqueurs/wine, several dairy/cheese
  lines, lamps and motorboats) — not the full ~554-line combined annex.
  Automatically skipped when a Section 232 basic-article or derivative
  measure already matched the same code, mirroring each proclamation's own
  carve-out for Section-232-covered goods. For goods imported on or after
  **Sept 29, 2026**, three further Sept 8, 2026 proclamations (11061/
  2026-18835 alcohol, 11062/2026-18836 dairy, 11063/2026-18837 motor
  vehicles) convert each basket's 50% duty into an outright import ban for
  lines in a separate ban Annex Cante does not hold — rather than keep
  guessing the pre-ban 50% rate past that date, the engine now reports
  that component as explicitly unresolved (`banDateAmbiguous`), citing the
  relevant ban proclamation, and withholds the aggregate total for that
  row. This is the reliability principle in practice: a known legal status
  change with no verified Annex data must fail closed, not keep returning
  a stale number.

What it deliberately does NOT compute: full-value AD/CVD cash-deposit
amounts (Commerce's own orders say the HTS code is "for convenience only"
and the written scope and exporter-specific rate control — see
`lib/tariff/adcvd.ts` for why this is a scope decision, not a gap). The
AD/CVD advisory table now covers 10 real, cited China/Malaysia/Serbia/
Turkey/Vietnam orders (steel nails, steel threaded rod, aluminum
extrusions, wooden bedroom furniture, quartz surface products, and the
five-country mattress order) in addition to the existing solar cell and
wood flooring entries, each carrying its case number, all-others/
country-wide rate as of a specific cited Federal Register determination,
and a scope note — always flagged `computed: false`, never a dollar
amount, because the order's written scope and exporter-specific rate
control, not the HTS code. IEEPA
or "reciprocal" tariffs (struck down by the Supreme Court in 2026; the
temporary Section 122 replacement expired July 24, 2026 — deliberately
excluded so Cante stays accurate to current law), Section 232 derivative
products outside the verified June 2025 appliance subset, USMCA/FTA
rules-of-origin qualification beyond a claimed programme symbol, the full
Section 338 annex beyond the verified lines above, and forced-labor
(UFLPA) measures. A Chapter 99 cross-reference this table doesn't
recognize is surfaced in `unresolvedMeasures` and voids the total (never
silently under-states it) — see `lib/tariff/stack.ts` for the full policy.

This is the honest-failure discipline the rest of Cante already follows,
applied to the specific narrow tool a real prospect asked for: real accuracy
on the HTS codes it does cover beats broad fake coverage. Demo bar: run
Kate's real HTS codes through it and compare against Toro's spreadsheet,
targeted for after Oracle GTM go-live (mid-December 2026).

The migration qualifies pgvector's cosine operator through the `extensions`
schema so its retrieval function remains compatible with the hardened empty
Postgres search path.

### Other commands

| Command | What it does |
|---|---|
| `npm run check` | Same check, from the terminal. Identical code path to the button. |
| `npm run check:scheduled` | The cron entrypoint: runs the check, sends the result to Telegram, exits with a code cron can act on. Announces its own failures — silence never means "all clear". |
| `npm run check:scheduled -- --verify` | Confirm the Telegram bot and chat work before relying on them. |
| `CANTE_COUNTRY="United States" npm run check` | Run the US source pack from the terminal. |
| `npm test` | Run focused source-window, pagination, and parser regression tests. |
| `npm run build` | Production build. |
| `npm run db:push` | Apply `lib/db/schema.ts` to `cante.db`. |
| `npm run db:seed` | Seed sources + customer from `config/customer.json`. |
| `npm run db:cloud:dry-run` | Inventory and validate the SQLite rows without network writes. |
| `npm run db:cloud:sync` | Upsert the complete SQLite history into Supabase with the local secret. |
| `npm run db:cloud:pull` | Pull live profile, memory, catalogue, lane, and document inputs into the worker ledger. |
| `npm run db:cloud:verify` | Compare local and cloud table counts after migration. |

### Where things are stored

The trusted daily worker keeps `cante.db` as its fetch/judgment ledger. Supabase Postgres is the deployed app's tenant-scoped system of record. With `CANTE_SYNC_SUPABASE=true`, a scheduled check first pulls live customer inputs, then runs, upserts the result, and verifies the cloud copy before its success heartbeat. `raw/` remains the worker's local evidence trail.

### If it can't find the model

The app spawns the `claude` CLI per request and inherits the `PATH` of whatever shell started `npm run dev`. The sidebar shows provider health on every page load. If it's red:

```bash
CLAUDE_BIN=/path/to/claude npm run dev
```

---

## How it works

Two stages, kept separate because a **fetch failure** and a **bad judgment call** are different problems and were getting silently conflated:

**1. Fetch — `lib/sources/fetch.ts`.** Plain fetching and parsing, no AI. Reads official JSON, HTML, CSV, and RSS sources, follows configured pagination, and writes one `source_results` row per source per run: success, error, entries parsed, and parse warning. Full Indonesian and US inventories are fingerprinted in `source_documents`, so later checks judge only new or changed records instead of repeatedly judging the same backlog.

**2. Judge — `lib/checks/judge.ts`.** Reads the parsed entries plus the customer profile and the dedup log, and judges relevance the way a person would — not keyword matching, since most relevant regulations won't contain "PVC" or "tarpaulin" in the title. Returns a Zod-validated verdict per regulation (`flagged` / `noted` / `baseline` / `clear`) plus a ready-to-send message.

The model sits behind a provider seam in `lib/llm/`. Local runs can use Claude
Code, Codex/ChatGPT, or Antigravity CLI sessions. `lib/llm/api.ts` implements
the Vercel-compatible OpenAI Responses API and Anthropic Messages API paths,
including server-side web tools. Validation lives *above*
the seam (providers return raw text; one Zod schema parses it), so they can't
drift into accepting different shapes.

Delivery: `npm run check:scheduled` pushes each run to Telegram — including the quiet days and the failures — so the operator knows the check ran without opening anything. Forwarding to the customer on WhatsApp is still a deliberate manual step. Automating that is a deliberate fast-follow, not a v1 blocker.

### The design constraint everything follows from

**Honest failure beats useful-looking output.** A source that failed and a regulation that isn't relevant are different facts, and neither may be rendered as "checked, nothing found". That's why `source_results` is its own table, why a fetch that succeeds but parses zero entries is tracked separately from a failure, and why every alert carries explicit coverage caveats.

Two properties of the source that can't be engineered away, so the judgment stage is told to respect them:

- **The listing carries a year, not a date — but detail pages carry the real enactment date** (`Tanggal Penetapan / Pengundangan`). Recency is knowable, at the cost of one extra fetch per candidate. This is not theoretical: Permendag 12/2026 reads like a major export-policy change from its title and was enacted 28 April 2026. Title-only judgment sends a false alert on day one.
- **Each view shows ~10 of ~2,386 entries.** Fine for a daily poll; a multi-day gap lets items scroll past unseen, and the alert has to say so.

### Layout

```
lib/llm/          types.ts (the seam) · claude-code.ts (works) · api.ts (stub) · index.ts
lib/sources/      registry.ts (sources + profile activation) · fetch.ts (JSON/RSS/HTML/CSV parsers)
lib/screening/    csl.ts · us-trade-controls.ts · us-isf.ts · us-export-controls.ts
lib/tariff/       insw.ts (INSW / NTR) · rates.ts (live USITC HTS column 1/2) · duty-expression.ts (duty-string parser)
                   · section301.ts (China 301 List 1-4A + verified supplemental fallback) · section232.ts (steel/aluminum)
                   · section338.ts (Canada Section 338, new Aug 2026) · adcvd.ts (AD/CVD advisories) · stack.ts (stacking engine) · usmca.ts
                   · quota-ledger.ts (PI & Quota Ledger)
lib/substances/   us-chemical-controls.ts (EPA TSCA PFAS/PBT, CA Prop 65)
lib/documents/    discrepancy.ts (Doc Cross-Check & OCR Engine) · extract-file.ts
lib/workflow/     actions.ts · draft.ts (PPJK, Ops, Supplier) · us-cbp-response.ts · audit-vault.ts
lib/checks/       judge.ts · judge-batched.ts · briefing.ts · run.ts · checklist.ts
lib/db/           schema.ts · client.ts · queries.ts
app/              page.tsx (public landing) · login/ · request-access/ · pending/ · logout/ · workqueue/ · checklist/ · chat/ · memory/ · api/{checks,workqueue,checklist,chat,customers,memories,screening}
components/       dashboard/ · workqueue/ · checklist/ · memory/ · chat/
scripts/          seed.ts (sources + country source packs + Example Company) · run-check.ts
config/           customer.json — read at seed time only
```

Multi-tenant from day one: everything keys off `customer_id`, sources key off country + regulation type. Adding customer #2 or a second country is a row, not a refactor. SQLite via Drizzle, portable to Postgres if deploy ever happens.

On the first source inventory in either supported country, Cante judges at most
ten unseen records per source and records the remainder as historical baseline. Subsequent runs still
fetch and fingerprint the full configured inventory, but send only new or
changed records to the model. A document changed at the same URL is re-evaluated.

---

## Data sources (tested directly, not assumed)

- **jdih.kemendag.go.id/peraturan** — reliable and fetchable. Kemendag's own regulation list, the primary source. Fetched in three views: unfiltered newest-first, plus `Tematik: Ekspor` and `Tematik: Perizinan`. The Ekspor filter matters — it surfaces the "Kebijakan dan Pengaturan Ekspor" Permendag rules that don't appear in the unfiltered top 10 at all.
- **jdih.setneg.go.id/api/hukumproduk** — official no-auth JSON API. Cante exhausts every page for the current and prior year across UU, Perpu, PP, Perpres, Keppres, and Inpres. The latest source-only probe parsed 263 records.
- **jdih.kemenkeu.go.id/home** — reliable in the latest run. Monitored for PMK, customs, duty, tariff, and tax-administration entries.
- **peraturan.beacukai.go.id and pajak.go.id/peraturan** — official DJBC and DJP listings for customs and tax changes.
- **jdih.kemenlh.go.id and jdih.kemnaker.go.id** — official environment and labor/OHS regulation sources. The latest probes parsed 30 and 15 records.
- **gw.oss.go.id/v2/portal/kbli/version** — the no-auth JSON gateway used by the official OSS frontend. Cante reads the published KBLI versions from this small response and keeps it as `heartbeat: true`, so it reports source health rather than being judged as a regulation. The gateway is live but not a documented public contract, and it does not prove a company's licensing status. Complete obligation mapping still needs a confirmed KBLI code from OSS/NIB.
- **jdih.surabaya.go.id/peraturan/ajax** — official no-auth city regulation JSON, fully paginated for the current and prior year. The latest probe parsed 123 records.
- **lh.surabaya.go.id/weblh/data-pengumuman-dokumen** — official Surabaya environmental notices, monitored in a rolling 45-day window. The latest probe parsed 13 records.
- **Caveat on HPE:** the unfiltered feed is dominated by Harga Patokan Ekspor decrees — commodity reference prices for mining, palm, agriculture and forestry. They never cover PVC tarpaulin. Volume here is not signal.
- **Official Kemendag newsletter** ("Berlangganan Newsletter JDIH Kemendag") — signed up. The government pushing updates directly is more reliable than scraping anything.
- **US federal tax and customs** — the IRS Federal Register feed, eCFR Title 19 (customs duties, including drawback under part 190), and eCFR Title 26 (internal revenue). Live-probed 16 Aug 2026: IRS returned 4 dated entries, Title 19 had 1 substantive change in 7 days and 3 in 30, Title 26 had 3 and 9. Title 19 activates for an export profile; the IRS feed and Title 26 are ungated because federal tax reaches any company with US operations. Note the structural asymmetry with Indonesia: the US cannot tax exports at all (Constitution, Art. I §9 cl. 5), so there is no US export-duty regime — the exposure is import duty on inputs, and drawback when those inputs are re-exported.
- **peraturan.bpk.go.id** — confirmed blocks bots. In the registry as `blocked`; never fetched automatically. Still the deepest archive for manual lookups.
- **peraturan.go.id and jdihn.go.id** — disabled from daily fetching because their public services are not dependable. Measured 16 Aug 2026: they resolve to 103.145.96.87 and 103.145.96.88, adjacent IPs in one government subnet, and both refused TCP connections from two independent networks. So this is a dead host, not bot detection, and no retrieval or header change will recover it. Setneg now covers six national instrument types. JDIHN's ILDIS convention can expose member feeds such as `/feed/document.json`, but each agency's adoption and quality must be verified separately.
- **insw.go.id** — not yet integrated, and the most promising remaining lead. Its NTR service maps an HS code to duty rates *and* lartas (prohibition/restriction) status, which is closer to the product than any regulation listing: "what restricts 6306.19.90 today" is diffable, where "does this Permendag touch PVC tarpaulin" needs judgment. No public developer documentation was found. It times out from the development machine but loads from other networks, so the block is routing or geo, not a dead service. Gated on the same thing as everything else: real HS codes off a PEB.
- **East Java JDIH** — the public site works interactively but Cloudflare blocks unattended collection. The provincial layer remains a disclosed manual gap; Surabaya city coverage is automated.
- **pesta.bsn.go.id/produk** — working server-rendered SNI catalogue. A live probe parsed 19 entries. There is no discovered public read API, so Cante retains the HTML adapter and retries one transient connection, timeout, rate-limit, or server failure.

The wider Indonesia monitor is tracked in `source_packs`, separate from daily
fetch rows. Seeded packs now cover Kemendag trade, KBLI/OSS, UU, PP,
Perpres/Kepres, Permen/Kepmen, Kemenkeu/DJBC/DJP tax-customs, BSN/SNI, and East
Java / Surabaya regional rules. All non-blocked source rows are attempted by the
monitor; failures are shown as coverage caveats, not hidden.

The exact tested boundary, gaps, and expansion leads are recorded in
`indonesia-source-coverage.md`.

Both US APIs are queried through their documented interfaces
(`federalregister.gov/developers/documentation/api/v1`,
`ecfr.gov/developers/documentation/api/v1`), and both need to be asked for what
you want. The Federal Register returns no dates unless `fields[]` names them —
before that was fixed, 0 of 16 entries carried a date and every US alert had to
say effective dates were unverified; now 16 of 16 do. The eCFR versioner returns
the *oldest* section versions unless windowed with `issue_date[gte]`, so Title 29
previously reported 2017 sections as recent changes. Cante now resumes
inclusively from the last completed run, fetches every API page, and retains
every substantive dated amendment without a hidden cap. A first run uses a
disclosed seven-day bootstrap window. Version fragments make a later amendment
to the same section detectable, appendix links use the correct route, and
`amendedOn` is kept separate from the unknown legal effective date. Federal
Register HTML pages are never fetched — they are ~100KB and
intermittently redirect to an access-block page — the API's plain-text
`raw_text_url` is used instead.

The US source set is profile-driven. EPA, OSHA, and FTC Federal Register feeds,
core eCFR titles, and OSHA RSS form the general baseline. Recorded product flags
activate CPSC recalls and FDA/USDA/FCC/DOT agency feeds; export facts activate
BIS, Census/FTR, OFAC, CBP, and export eCFR; facility and distribution facts
activate North Carolina/Charlotte sources plus official CA, NY, and TX state
registers. Confirmed Memory facts can activate a source on the next check;
unconfirmed chat leads cannot. Missing facts and unsupported states are appended
to the alert as code-written coverage caveats.

---

## Status

- **AD/CVD advisory table expanded, 10 new cited orders (7 Oct 2026).**
  Added China steel nails (A-570-909), steel threaded rod (A-570-932),
  aluminum extrusions (A-570-967), wooden bedroom furniture (A-570-890),
  quartz surface products (A-570-084), and the five-country mattress order
  (China A-570-092, Malaysia A-557-818, Serbia A-801-002, Turkey A-489-841,
  Vietnam A-552-827), each with its real case number, all-others/
  country-wide rate as of a cited Federal Register determination, and a
  scope note. Red-teamed against primary sources: case numbers, HTS
  chapters, and FR volume/year pairings all verified real and correctly
  matched; no fabricated rates or citations. Two new regression tests
  guard country-specificity and against over-broad HTS-prefix matching.
  `lib/tariff/adcvd.ts` tests: 8 passed, 0 failed. `npx tsc --noEmit`:
  clean.
- **Public landing page added (21 Aug 2026).** `/` is now a single-viewport
  invite-only landing page adapted from the MotionSites AI Runtime visual
  direction: full-bleed video background, compact rounded nav, request-invite
  CTA, and compliance-monitoring copy.
- **Local demo login gate added (21 Aug 2026).** `/login` accepts
  `demo` / `demo`, sets an HTTP-only `cante_demo_session` cookie, and middleware
  redirects protected app screens there when the cookie is missing. Landing app
  links now pass through login and default to United States demo. This is only
  placeholder navigation logic until Supabase Auth and user-to-customer mapping
  are added.
- **Supabase/Vercel prep added (21 Aug 2026).** The app now has Supabase SSR
  client helpers, dual-mode middleware (`demo` or `supabase`), `/pending`,
  `/logout`, `/request-access`, expanded env placeholders, and a deployment note
  in `SUPABASE_VERCEL.md`. Supabase mode still requires env vars and uses
  `CANTE_ALLOWED_EMAILS` as a temporary access bridge until tenant tables are
  wired.
- **Working end to end locally.** Dashboard → Run check now → expanded live fetch, judgment, stored result, rendered alert. Chat Q&A grounded in stored run data also works.
- **US federal tax and customs are now monitored (16 Aug 2026).** The US pack had
  thirteen agency feeds and no tax authority at all, while Indonesia has watched
  DJP, DJBC and Kemenkeu from the start. Added and live-probed: the IRS Federal
  Register feed, eCFR Title 19 (customs duties — drawback, entry, valuation,
  origin) and eCFR Title 26 (internal revenue). 19 CFR is the one that matters
  most: the US constitutionally cannot tax exports, so an exporter's exposure is
  on the customs side, chiefly duty drawback on inputs that are later re-exported.
  A new `us-tax-customs` checklist row asks whether drawback is being claimed.
- **Model-suggested classifications (17 Aug 2026).** Ask for a code and Cante
  retrieves real USITC rows, has the model pick one with GRI reasoning and
  alternatives, and files it as an unconfirmed lead. It cannot invent a code
  (anything outside the retrieved set is rejected), it can decline when
  retrieval missed the right heading, and it cannot be approved until a named
  person adopts it in writing. Live-verified: a PVC-coated tarpaulin classified
  to 6306.12.00.00 at high confidence under GRI 1.
- **Cante now computes consequences, not just changes (17 Aug 2026).** A duty-rate
  engine reads the official USITC schedule, so a code mismatch on an uploaded
  entry comes back priced and a finding carries the duty currently at risk on the
  affected lane. Products now have bills of materials with declared substances
  and CAS numbers, so a PFAS or REACH rule can be matched to the component that
  actually contains the chemical. Regulations link to the rules they amend or
  revoke. Live-verified: a 3921.90-vs-6306.12 mismatch prices at USD 18,400 and a
  $400k lane shows USD 35,200/year of duty at risk. Rates are US import duty
  only; customs filing, licence determination and FTA qualification remain out of
  scope.
- **The operating-data layer is built (16 Aug 2026).** Cante now holds the
  customer's own business alongside the regulations: a product catalogue with CSV
  import, trade lanes, suppliers, uploaded trade documents, an action workflow,
  and impact estimates. Four new screens — Work queue, Catalogue, Documents,
  Suppliers — sit in an Operations group in the sidebar. 65 tests pass, the build
  is clean, and the whole chain was exercised against the real database: import a
  catalogue, paste a PEB, watch the audit catch a code mismatch, promote the
  document's code to verified tier, approve it, and see the old code superseded
  but retained. Not done, and disclosed rather than stubbed: OCR/PDF ingestion,
  actually sending supplier requests, and export-licence determination.
- **Indonesia source coverage verified whole-set on 16 Aug 2026: 11 of 11 sources fetched, 0 failures, 380 entries parsed** (Kemendag 30 across three views, Setneg 263, KLH 30, BSN 19, Kemnaker 15, DJBC 10, Kemenkeu 7, DJP 5, OSS 1 heartbeat). The set immediately before this work was 5 of 12 with 38 entries. Surabaya rows were not exercised by that probe because it ran without a profile.
- **Known open bug, not yet fixed:** the source ledger's `identity()` strips the URL fragment that gives repeated eCFR section amendments distinct identities, so a run whose window contains two amendments of one section aborts on a unique-index violation. Reproduced against the real schema. Daily runs are unaffected; a monitor stalled for weeks is, and the failure widens its own window. See CLAUDE.md for measured exposure and the fix.
- **US mode is built at the product-foundation level.** The composer switches
  between Indonesia and United States; histories, prompts, memories, profiles,
  checklists, and runs remain country-scoped. The US profile captures
  facilities, NAICS, products, materials, waste, states, labels, HTS/Schedule B,
  ECCN/EAR99, destinations, and product flags. Its 17 checklist rows cover
  OSHA, EPA, permits, product/label rules, distribution, AES, OFAC, EAR, and
  ITAR triage.
- **Deeper US source automation is source-tested.** Thirteen separate Federal
  Register agency queries all passed. Live probes also parsed CPSC recalls (30),
  OFAC list actions (10), NC Register issues (12), NC DEQ/Labor/Revenue and air
  notices, and current CA/NY/TX register issues. Mecklenburg's current permit
  page returned a validated empty listing. The empty-profile baseline fetched
  37 deduplicated entries from seven applicable sources with zero failures.
  General state registers are discovery surfaces, not complete EPR/PFAS/tax/
  consumer-rule coverage.
- **Free US trade-data adapters are working live.** Cante now monitors USITC HTS
  releases and profile codes, CBP CROSS and CSMS, Section 301/232 and trade-remedy
  Federal Register queries, USITC IDS, the USTR Section 301 overlay, Trade.gov
  CSL snapshots, DHS UFLPA entities, and CBP WRO/Findings and forced-labor news.
  `POST /api/screening` performs exact normalized primary/alias matching against
  the current CSL bulk file. It deliberately does not claim fuzzy identity,
  beneficial ownership, end-use, destination, license, or transaction clearance.
- **US reference run:** `2405fb73-d714-4f2d-804b-ce6c4ddfe3be` selected seven
  general federal sources for the empty profile. All succeeded; 37 entries were
  code-audited as 21 new verdicts, 16 exact-URL prior matches, and 0 unaccounted.
  The final alert appended all inactive facility/state/product/export pack
  caveats and refused to infer EAR99. The older pre-depth reference is
  `47c65faf-1b70-4313-9a0d-153126127b8f`.
- **Indonesia full-inventory automation is verified.** The seven new adapters fetched 459 official records without a failure. Full run `282f54b9` fetched 513 records across 13 active sources, judged 76 bootstrap documents, and stored 403 older records as baseline. Immediate repeat run `6c05be50` fetched the same 513 records, detected zero new or changed records, made zero judgment calls, and produced zero findings. This is the current reference behavior.
- **The checklist is first-class.** `/checklist` shows a living compliance work queue generated from customer profile, memory, KBLI records, and source coverage. Chat-extracted or manually entered facts refresh it automatically. Surabaya city automation and the blocked East Java provincial layer are represented separately.
- **Chat now streams and can search the web.** Answers arrive token by token over SSE (`--include-partial-messages`), with a timeline of what actually happened: the searches run with their real queries, the favicons of the pages those searches actually returned, an expandable list of those sources, and a thinking block showing real duration and token count. What it deliberately does *not* show is invented reasoning prose — the CLI emits thinking blocks with empty text, so there is nothing real to display and the UI says how long it thought rather than pretending to know what about. An earlier version faked all three: a second model call wrote "reasoning" before the answer began, the answer had to open with a `<visible_reasoning>` block that was stripped back out, and every search animated the same three hardcoded government favicons regardless of what it found. The stream closes as soon as the answer is saved, while memory extraction runs in the background so the composer is not stuck waiting. HS-code questions asking for new/latest regulation discovery get an explicit search directive to hit official Indonesian sources immediately. The model may call `WebSearch` / `WebFetch` for outside context — what a regulation actually says, background on an HS code. The two sources of truth are kept explicitly separate in the prompt: stored run data is the only authority on what the monitor checked, and web findings must be attributed to their source. "The 14 Aug run flagged X" and "Kemendag's site says X" have to read differently — a web answer dressed up as a check result is the exact failure this product exists to avoid. Still no API spend: it's the same local CLI provider behind the same seam.
- First real judgment run: 28 findings — 1 `noted`, 1 `baseline`, 26 `clear`. It fetched Permendag 12/2026's detail page, read the real enactment date, and declined to flag it. The day-one false alert the design exists to prevent, prevented in practice rather than in theory.
- The alert disclosed the unconfirmed HS codes, unknown destination markets, the ~10-of-2,386 window, and the bootstrap caveat without being prompted per-run.
- **HS codes have evidence tiers.** `lib/checks/facts.ts` distinguishes document-verified codes, human-confirmed memories, unconfirmed leads, and superseded guesses. Only document evidence closes verification gaps.
- Not scheduled yet. `npm run check` is the identical code path, so a local cron entry needs no new code. Cante isn't its own git repo (the enclosing repo's remote is unrelated), so cloud scheduling would need a repo of its own first.
- The Python-era pipeline (`scripts/fetch_sources.py`, `alerts/*.md`, `raw/*.json`) was deleted once the TypeScript port was verified to produce identical output. `daily-prompt-check.md` is kept — it's the prose the judgment stage was ported from and still the clearest statement of the rules.

## Next

1. Get the customer's actual KBLI from OSS/NIB, actual HS code(s), destination markets, and compliance contact; confirm those facts once they come off real evidence (PEB / invoice / OSS).
2. Add ministry-specific Permen/Kepmen adapters selected by the customer's confirmed KBLI, products, permits, and markets; no dependable all-ministry feed exists.
3. Find a structured East Java provincial route and verify an official INSW/lartas integration. Surabaya city rules and environmental notices are already automated.
4. Put the check on a daily schedule — local cron calling `npm run check` is enough.
5. Run it for real for ~14 days, delivering each alert by hand.
6. Ask a prospective customer directly whether they'd pay $200–400/month. That answer, not more research, decides what happens next.
7. Enter a real US pilot manufacturer's facility, NAICS, materials/SDS,
   products, distribution states, and export evidence in the US Profile screen,
   then run the first evidence-grounded US check.

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
