# Daily Compliance Check — Judgment Stage

Run this after `scripts/fetch_sources.py` has run. Read the following files before doing anything:

1. `raw/fetch-status.json` — which views succeeded and which failed today. **Read this first.** If a source failed, you must say so explicitly in today's alert — never imply a source was checked if it wasn't.
2. `raw/regulations.json` — the parsed regulation entries, deduplicated across all views and sorted newest-first. **This is your main input**, not the raw HTML.
3. `config/customer.json` — the customer's product, HS codes, destinations, and relevance guidance.
4. `alerts/sent-log.md` — regulations already flagged in past runs. Don't flag the same one again.

The raw `raw/*.html` files are still there as a fallback. Only open them if `regulations.json` looks wrong or incomplete — they're ~90KB each and the parsed JSON already carries everything the listing shows.

## What the source can and cannot tell you

Three things about this feed that will mislead you if you forget them:

- **The listing carries no dates, only years** (`1716 Tahun 2026`) — but **each detail page does**, under `Tanggal Penetapan / Pengundangan`, along with the Berita Negara citation. Absence from `alerts/sent-log.md` means "not seen before", which is *not* the same as "recent": the log was empty at bootstrap, so old regulations look unseen. **Before flagging anything as a change, fetch its detail page and read the enactment date.** Verified on 2026-08-14: Permendag 12/2026 looks like a headline export-policy change from its title, but was enacted 28 April 2026 — flagging it as news would have been wrong.
- **You see about 10 entries per view, out of ~2,386.** Check `run_at` in `fetch-status.json`. If the last run was days ago, items may have scrolled off unseen — say so rather than implying continuous coverage.
- **`entries_parsed: 0` on a view that succeeded means the parser broke**, not that there was nothing there. `fetch-status.json` will carry a `parse_warning`. Treat that view as unchecked and disclose it exactly like a failed fetch.

## Your actual job

Read the titles in `regulations.json` the way a person would — not a keyword search. Use `full_title` (complete, reconstructed from the URL slug); `listing_title` is truncated where `truncated: true`, and the cut-off part is usually the part that says what the rule covers.

Relevant regulations may not name the customer’s products in the title. `config/customer.json` has a `relevance_guidance` block listing what typically matters and what typically doesn't — read it as guidance for judgment, not as a filter to apply mechanically. Something in the "almost never relevant" list still matters if it changes an export procedure that applies to all exporters.

Weight the `found_in_views` field: entries from the `ekspor` view are export-policy-tagged by Kemendag itself and are far likelier to matter than the general `semua` feed, which is dominated by HPE commodity-price decrees. The `perizinan` view is mostly historical (its newest entries are from 2022) — useful as reference, rarely a source of change.

If you're not sure whether something is genuinely new or genuinely relevant, don't guess — it's fine to note "worth a manual look" rather than asserting impact confidently.

## Bootstrap: the first run

`alerts/sent-log.md` starts empty, so on a first run the entire visible backlog looks new. Do not flag all of it. Judge what a person would genuinely act on today, flag at most that, and record the remaining relevant-looking entries in the log with status `baseline` so tomorrow's run doesn't treat them as fresh.

## Write the alert

Create `alerts/YYYY-MM-DD.md` (today's date) with:

- A short header: date, customer, product, HS codes checked.
- **If any HS code or destination list in `customer.json` has `"confirmed": false`**, say so plainly. The alert must not read as if it were checked against verified HS codes when it wasn't.
- **If any view failed or parsed zero entries**, an explicit line: "Catatan: [domain] tidak dapat diakses hari ini, hasil pemeriksaan mungkin tidak lengkap." (Note: [domain] could not be reached today, today's check may be incomplete.) Do not omit this — it's more honest than silence.
- If you found something genuinely relevant: 2-4 lines in plain Bahasa Indonesia explaining what changed and what to do, plus a one-line English gloss. No legal jargon, no long quotes — paraphrase. Include the regulation number and its JDIH link.
- If you found nothing relevant: say so plainly in Bahasa Indonesia. Don't invent something to seem useful. **Nothing-to-report is the expected outcome most days** — genuinely relevant changes for one product category are rare, and a quiet alert is the product working, not failing.
- A "ready to send" WhatsApp-format block at the bottom, matching the tone of a real message to a business owner.

## Update the log

Append a row to `alerts/sent-log.md` for anything you flagged (`sent`), anything you deliberately left as pre-existing (`baseline`), or anything you noted for manual review (`noted`) — date, regulation number, title, customer, status. If it isn't logged, tomorrow's run will see it as new again.

## Do not

- Do not fabricate a regulation or a change that doesn't clearly exist in the source material.
- Do not claim a source was checked if `fetch-status.json` shows it failed or parsed zero entries.
- Do not assert that something is new or recent on the strength of the listing alone — check the detail page's enactment date first.
- Do not use only keyword string-matching — actually read and judge.
