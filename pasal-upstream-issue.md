# Upstream request — draft, not yet filed

Post at: https://github.com/ilhamfp/pasal/issues/new

`gh` is not authenticated on this machine, and filing under your account is your
call. Copy the body below as-is, or trim it.

---

**Title:** Expose `tanggal_penetapan` / `tanggal_pengundangan` in the REST API

**Body:**

First — thank you for building and opening this. `jdih.kemenperin.go.id` has
been unreachable since early 2024 and `peraturan.go.id` is not reachable from
outside Indonesia, so for some of us pasal.id is the only working route to
Ministry of Industry regulations. The API has been solid.

**Request:** include the enactment and promulgation dates in
`GET /api/v1/laws` and `GET /api/v1/laws/{frbr_uri}`.

**Why they're already there.** The data exists and is populated — no new
crawling required:

- `works.tanggal_penetapan` and `works.tanggal_pengundangan` are added in
  migration `018_works_scraping_columns.sql`
- `scripts/worker/process.py` fills them via `_extract_metadata_from_soup()`,
  reading the `Ditetapkan Tanggal` / `Tanggal Pengundangan` rows off the
  peraturan.go.id detail page and normalising with `_parse_indo_date()`
- your own law pages render them — e.g.
  `/akn/id/act/permenperin/2026/22` shows *Penetapan: Jakarta, 15 Juli 2026*,
  *Pengundangan: 31 Juli 2026*, *LN 2026 No. 529*

So this looks like adding the columns to the API's select and response shape.

**Why it matters for API consumers.** Right now the API's only time field is
`year`. For anything that monitors regulations for change, that isn't enough to
tell a rule signed last week from one signed eight months ago — both are
`year: 2026`. We build a compliance monitor for a small Indonesian
manufacturer, and without a date we have to tell the customer the age of a
regulation is unknown, even though pasal.id knows it and shows it on the web
page.

Two smaller things that would help alongside it, if they're cheap:

1. `nomor_pengundangan` (the `LN 2026 No. 529` citation) — it's the official
   Berita Negara reference.
2. A `status`/`type` filter is already documented, but a `sort` or
   `order_by=tanggal_pengundangan` on `/laws` would let consumers page newest
   first. Today `/laws` appears to return rows in no chronological order, so
   detecting "what's new" means fetching a whole year and diffing locally.

Happy to open a PR if you'd like — point me at whether the API route should
select the columns explicitly or whether there's a shared serializer to update.

**Note on one filter that surprised us**, in case it's useful: `type=PERMEN`
returns rows from other issuers — e.g. `/akn/id/act/kepkpu/2026/93`, a Keputusan
KPU. It traces to `_infer_type_from_prefix()` in `worker/discover.py`, whose
final fallback is `return "PERMEN"` for any unrecognised slug prefix, so
`kepkpu` is typed as PERMEN at crawl time. `issuing_body` is a reliable
workaround and we use it, so this is informational, not a blocker.
