# Indonesia Export Compliance Monitor — MVP Plan

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

First slice built 2026-08-16: `kbli_records`, `source_packs`, and
`checklist_items` now exist; `/checklist` shows the living work queue; memory
add / confirm / delete and chat memory extraction refresh the checklist. This is
not full source automation yet. OSS, SNI, national law, tax/customs, and regional
coverage stay marked manual-assisted or untested until fetchers are proven.

**Do not build all five at once.** Sequence:
1. Get MA's real KBLI code from their OSS/NIB registration first — it's the filter everything else runs through.
2. Confirm real HS codes from PEB/invoice and promote the corresponding Memory rows.
3. Prove Kemenkeu/DJBC/DJP and BSN/SNI source fetchers before marking those packs automated.
4. Add UU + PP tracking (national, centrally published, highest impact).
5. Add Kepres tracking.
6. Add Perda (regional) last — fragmented by province/city, no single source, and MA is specifically in Surabaya/East Java, so this needs region-specific sources found separately. Lowest priority.

## Data sources to check
Prefer these official sources — they're free, public, and don't need an account:

1. **peraturan.go.id** — national feed of newly enacted regulations across all ministries. Shows "diundangkan X minggu yang lalu" (enacted X weeks ago), so it works as a general "what's new in Indonesian law" page. Good first stop for catching anything recent regardless of which ministry issued it.
2. **jdih.kemendag.go.id/peraturan** — every Ministry of Trade (Kemendag) regulation: Permendag export policy changes, and the monthly Keputusan Menteri Perdagangan on Harga Patokan Ekspor (HPE, export benchmark prices). This is the single most important source for MA.
3. **peraturan.bpk.go.id** — the deepest searchable archive of Indonesian law (UU, PP, Perpres, Permen), filterable by ministry/year/topic, free PDF downloads. Best for looking up a regulation's full text or its history once you know it exists.
4. **jdihn.go.id** — the national legal database network that ties every ministry's JDIH (legal documentation) site together; useful as a fallback search if something isn't showing up on the Kemendag site directly.
5. Bea Cukai (customs/DJBC) regulations and tariff/PMK notices — check via the Ministry of Finance's JDIH (jdih.kemenkeu.go.id) for customs duty and tariff changes specifically.

Use web search grounded to these five sources specifically — don't broaden to "all Indonesian regulations," and don't rely on general web search alone without pointing it at these official domains, since that's how things get missed or mixed up with unofficial summaries.

## Important: scraping reliability, tested directly
- **peraturan.bpk.go.id actively blocks automated requests (bot detection, confirmed).** Do not rely on this as a daily-fetch source. Use it only for occasional manual lookups of a regulation's full text once you already know it exists.
- **peraturan.go.id is currently unstable** (its own homepage says "Website dalam perbaikan" — under maintenance). Treat it as a bonus source, not core — expect it to fail sometimes and don't let that break the daily check.
- **jdih.kemendag.go.id is reliable and reachable** — this is the most important source for MA anyway, since it's Kemendag's own regulation list including HPE decrees.
- **Do not write a custom scraper with raw urllib/requests and no headers** — that's what's getting blocked. Have Claude Code use its own built-in web search and fetch tools for the daily check instead of hand-rolled scraping code; those are far more resilient against bot detection than a bare `urlopen` call.
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

## Explicitly not solving yet
Pricing, contracts, onboarding flow, and expansion to more customers all come after the two-week live test with MA produces a real yes/no on willingness to pay. Do not build billing or a signup page as part of this MVP.
