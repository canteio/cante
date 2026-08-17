# Indonesia Export Compliance Monitor — MVP Plan

> **Scope update 2026-08-15:** the app is now multi-jurisdiction. Indonesia
> remains the flagship, and the United States foundation in `US-plan.md` is
> implemented: country-scoped profile/run/chat/memory/checklist records,
> profile-driven official federal feeds, structured CPSC/OFAC updates, working
> North Carolina/Charlotte adapters, CA/NY/TX register adapters, a 17-row US
> checklist, and a nation selector in the chat composer. Confirmed Memory can
> activate new packs; missing facts create coverage caveats. Topic-specific
> state obligation engines remain incomplete. No hosted API, billing, cron, or
> automatic delivery was added.

> **Source-correctness update 2026-08-16:** eCFR monitoring now resumes from the
> last completed run, paginates without a hidden cap, versions repeat section
> amendments by date, handles appendices, and separates amendment dates from
> legal effective dates. First-run history is a disclosed seven-day bootstrap,
> not a claim of historical coverage.

> **Free US trade-data update 2026-08-16:** USITC HTS/IDS, CBP CROSS/CSMS/WRO,
> USTR Section 301, targeted Federal Register trade overlays, DHS UFLPA, and
> Trade.gov CSL are integrated without paid keys. Exact CSL name matching is
> available through `POST /api/screening`; fuzzy identity, ownership, end-use,
> license, and transaction review remain explicit manual/expert gaps.

## Goal
A daily automated check that watches Indonesian government trade sources for changes affecting a specific exporter's products, and sends a plain-language WhatsApp alert when something relevant changes. First real customer: MA (PVC tarpaulin manufacturer, Surabaya, Indonesia).

## Scope for v1 — keep this narrow
IN:
- One customer profile (MA) hardcoded to start, not a multi-tenant system yet
- Daily automated check (no manual trigger needed)
- Three source categories only (see below)
- WhatsApp delivery only (no email, no dashboard yet)
- Dedup logic so the same regulation doesn't get sent twice

OUT (do not build yet):
- Multi-customer signup/dashboard/website
- Any agent orchestration, CFO/marketer agents, or anything beyond this one workflow
- Payment/billing integration
- Any language other than Bahasa Indonesia (with a one-line English gloss)

## Expanded scope — MA's actual request
MA has asked for this to also track regulatory change tied to their KBLI code (Indonesia's business classification code, separate from HS codes — determines which licenses/regulations apply to them) across the Indonesian regulation hierarchy: UU (laws), PP (government regulations), Kepres (presidential decisions), Perda (regional regulations), and tax regulations.

See `indonesia-monitor-roadmap.md` for the updated product version of this
scope. The Indonesia monitor should become a KBLI/OSS/SNI/tax/customs/legal
hierarchy monitor with a living compliance checklist that updates when chat
memory changes, not just an HS-code export feed.

Expanded slice built 2026-08-16: `kbli_records`, `source_packs`, and
`checklist_items` now exist; `/checklist` shows the living work queue; memory
add / confirm / delete and chat memory extraction refresh the checklist.
`npm run check` now selects every applicable non-blocked Indonesia source:
Kemendag, Setneg's national hierarchy, Kemenkeu, DJBC, DJP, KLH/BPLH, Kemnaker,
OSS, BSN/SNI, Surabaya JDIH, and Surabaya DLH. Full inventories are fingerprinted
in `source_documents`; only new or changed documents enter daily judgment.
Verified run `282f54b9` fetched 513 records across 13 active sources, and
immediate repeat run `6c05be50` found zero changes and made zero judgment
calls. Nationwide all-ministry Permen/Kepmen, East Java province, private OSS
status, mandatory-SNI applicability, and INSW/lartas remain explicit gaps.

**Do not build all five at once.** Sequence:
1. Get MA's real KBLI code from their OSS/NIB registration first — it's the filter everything else runs through.
2. Confirm real HS codes from PEB/invoice. The four codes confirmed in Memory (6306.19.90, 3920.43.90, 3921.12.00, 3918.90.99) are now the working set and have superseded the seed-time guesses, but `hsCodesConfirmed` stays false and the checklist row stays open until a document backs them.
3. Add ministry-specific Permen/Kepmen feeds selected by confirmed KBLI, product, permit, and market facts; JDIHN member feeds are candidates, not assumed coverage.
4. Find a structured East Java provincial source and official INSW/lartas route. Surabaya city rules and environmental notices are already automated.
5. Once KBLI and HS evidence are confirmed, tighten the judgment prompt from "leads" to "verified KBLI-to-rule mapping."

## Data sources to check
Prefer these official sources — they're free, public, and don't need an account:

1. **jdih.setneg.go.id/api/hukumproduk** — national UU, Perpu, PP, Perpres, Keppres, and Inpres through a working no-auth JSON API.
2. **jdih.kemendag.go.id/peraturan** — every Ministry of Trade (Kemendag) regulation: Permendag export policy changes, and the monthly Keputusan Menteri Perdagangan on Harga Patokan Ekspor (HPE, export benchmark prices).
3. **JDIH Kemenkeu, DJBC, and DJP** — finance, customs, tariff, and tax changes.
4. **JDIH KLH/BPLH and Kemnaker** — environment and labor/OHS changes.
5. **OSS and BSN** — public KBLI/SNI catalogue discovery, with private licensing status and mandatory applicability kept as evidence gaps.
6. **Surabaya JDIH and DLH** — city regulations and environmental notices for MA's operating location.

Use official adapters for repeat monitoring and grounded web/manual lookup for
blocked archives or document interpretation. The exact boundary is in
`indonesia-source-coverage.md`.

## Important: scraping reliability, tested directly
- **peraturan.bpk.go.id actively blocks automated requests (bot detection, confirmed).** Do not rely on this as a daily-fetch source. Use it only for occasional manual lookups of a regulation's full text once you already know it exists.
- **peraturan.go.id and central JDIHN are disabled from daily automation.** Setneg replaces six national instrument types; no central reliable feed covers every ministry's Permen/Kepmen.
- **jdih.kemendag.go.id is reliable and reachable** — this is the most important source for MA anyway, since it's Kemendag's own regulation list including HPE decrees.
- **A structured official endpoint is preferred over browser scraping.** Every
  paginated adapter must fail honestly if a page is missing, rather than silently
  treating partial inventory as complete.
- **Bonus channel found on the Kemendag JDIH site:** an official email newsletter ("Berlangganan Newsletter JDIH Kemendag") that sends new regulations straight to an inbox, plus an official WhatsApp contact (wa.me/+6287711995515). Signing up for the newsletter is worth doing in parallel — it's the government pushing updates directly, which is more reliable than scraping anything.

## Architecture — no API keys for v1
1. A scheduled job (GitHub Action, or a cron entry) runs once daily and invokes Claude Code (headless mode) on this repo — no separate Anthropic API key to manage, it uses the same Claude Code login already set up.
2. The prompt tells Claude Code to web-search the three source categories above for real, recent (~60 day) changes affecting the customer's registered product/HS code, and write the result as plain-language Bahasa Indonesia (with a one-line English gloss) to a dated file, e.g. `alerts/2026-08-14.md`.
3. Before writing, Claude Code checks a simple running log (`alerts/sent-log.md` or similar) of what's already been flagged, so it doesn't repeat the same regulation two days in a row.
4. If nothing new, it still logs that the check ran, but writes "no relevant change today" instead of inventing something.
5. Delivery for v1 is manual: you open today's alert file each morning and copy-paste it into WhatsApp yourself. This is fine — the hard, valuable part (finding and writing the alert) is fully automated; the easy part (pressing send once a day) stays manual until the idea is proven. Automating that last step is a fast-follow, not a blocker.

## The daily check, in plain terms — this is the whole idea
Every day, the job does roughly this:
1. Search the sources listed above for anything posted or enacted in the last ~60 days.
2. Compare what it finds against MA's profile — product: PVC tarpaulin (terpal PVC), HS code if known.
3. Decide honestly: does this actually affect this product? If yes, explain what changed and what to do about it, in 2-4 short lines of plain Bahasa Indonesia, casual and clear — no legal jargon, no long quotes from the source, just what it means in practice. Add one short English line under it summarizing the same thing.
4. If genuinely nothing relevant happened, say that plainly instead of manufacturing a change — accuracy matters more than always having something to report.
5. Check today's finding against the dedup log before writing it, so the same regulation doesn't get reported two days running.

That's the entire logic. It doesn't need a separate script or its own API key — it's just a daily prompt given to Claude Code, following the five rules above.

## Build tasks, in order
1. **Add scheduling** — a GitHub Action (or cron job) that runs once a day, e.g. every morning at 07:00 WIB, and triggers Claude Code headless with the daily-check prompt.
2. **Add a dedup log** — a simple markdown or text file Claude Code reads before writing a new alert and appends to after, so the same regulation isn't flagged twice.
3. **Write the daily output to a file, not send it anywhere** — one file per day under `alerts/`, plain language, ready to copy-paste.
4. **Config file for the customer profile** — `customers.md` or `customers.json` with business name, product description, and HS code if known. Only one entry (MA) for now, but structured so adding a second customer later doesn't require rewriting anything.
5. **Logging** — a line per day noting whether the check ran, found something, or errored, so you can check later that it's actually running daily without watching it live.
6. **Manual delivery step** — each morning, open the day's alert file and send it to MA yourself over WhatsApp. Track whether you actually did this daily; skipping it breaks the whole test.

## Definition of done for v1
- The daily check runs automatically without you triggering it by hand.
- It has run for at least 14 consecutive days, logged each run.
- It has correctly identified at least one real, relevant change (or correctly identified zero when there was nothing — either counts, as long as it's accurate).
- MA has received at least one real alert whose content was generated entirely by the automated check, even though you sent the WhatsApp message yourself.

## Scope change, 16 Aug 2026 — from monitoring engine to monitoring service

A competitive review (Quickcode, GingerControl, Onyx, Descartes, E2open,
CargoWise, Assent, Altana) found Cante's capabilities were real but all pointed
at regulatory documents rather than the customer's operating data. Items 2–10 of
that review are now built:

| # | Item | State |
|---|---|---|
| 2 | Product catalogue + CSV import | built |
| 3 | Trade lanes | built |
| 4 | Action workflow (acknowledge → assign → broker → close) | built |
| 5 | Impact calculation (affected SKUs, effective date, exposure) | built |
| 6 | Classification workspace (history, rationale, approval) | built |
| 7 | US trade depth (HTS, CROSS, 301/232, AD/CVD, UFLPA) | was already built; PGA-per-code outstanding |
| 7b | US federal tax and customs (IRS, 19 CFR, 26 CFR) | added 16 Aug 2026 — the US pack had no tax authority at all while Indonesia had three |
| 8 | Document audit (PEB/invoice → discrepancies) | built, text only |
| 9 | Supplier evidence tracking | built, outreach not sent |
| 10 | Restricted-party screening, persisted | built |

**Item 1 — always-on service — is still not done, and it is still the most
important gap.** Scheduling, push delivery, retries and delivery logs remain out
of scope alongside auth and deploy. Items 2–10 make each alert worth more; none
of them make an alert arrive on its own. Until that changes, Cante is a better
monitoring engine, not yet a finished monitoring service.

The v1 definition of done below is unchanged: the 14-day live test with MA
and a real answer on willingness to pay still decide what happens next. The
operating-data layer exists to make those 14 days produce a sharper alert, not
to replace the test.

## Explicitly not solving yet
Pricing, contracts, onboarding flow, and expansion to more customers all come after the two-week live test with MA produces a real yes/no on willingness to pay. Do not build billing or a signup page as part of this MVP.
