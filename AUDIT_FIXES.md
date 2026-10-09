# October 9 implementation follow-up

Code changes are confined to `dev`. On October 9, all 25 SQL migrations were
verified applied to Cante (`nvdsjqzbzsczvmvjxhro`), including the audit schema
and a follow-up enabling RLS on both public tariff reference tables. The HTS
Edge Function was deployed as active version 4. The app is deployed as a dev
preview at https://cante-444ecg7ve-jeremygautamas-projects.vercel.app.
No Telegram delivery, launchd job, or manual scheduler execution was performed.
Telegram credentials were explicitly blanked for test runs.

Implemented:

- Tariff quotes require the exact published statistical code, select Column 2
  for applicable origins, and propagate quantity/unit. Claimed special treatment
  without qualification withholds the business-impact delta.
- Current Section 232 no longer falls back to old static rates after a store
  failure. Annex III calculates the additional gap to the combined threshold.
  Metal/use qualifications and a reviewed consolidated coverage ledger are
  required; an accepted narrow amendment cannot prove full coverage.
- The July 24 forced-labor Section 301 action is disclosed as unresolved by the
  general calculator for covered origins, preventing incomplete aggregate totals.
- Historical entry imports retain entry/line identity, entry date, customs value,
  paid duty, qualification evidence and raw input. Duplicate lines are rejected;
  historical rows cannot become annual monitored exposure. Persisted computed
  entries must have an exact tenant catalogue link. Repeated uploads reuse an
  immutable snapshot when inputs, linkage and calculation evidence match.
- The first bounded historical basis uses archived HTS Revision 19 for
  3916.90.30.00 from China/Vietnam, September 15–27. Qualification must be
  explicitly reviewed by the caller; unsupported cases remain unresolved.
  Differences are assessed minus paid duty, with no automatic refund claim.
- HTS refresh completion uses atomic per-chapter markers and resumes incomplete
  revisions. Partial failures return 503. Chapter 99 uses the verified terminal
  export boundary 9999; the old boundary always returned zero rows.
- XLSX/DOCX extraction checks expanded archive size and entry count before
  allocation. OpenAPI discovery probes work with both module export shapes.
- Customer listing paginates through PostgREST's response limit.

Database validation ran against isolated PostgreSQL 14: migration DDL, historical
persistence, duplicate-upload reuse, paid-duty consistency rejection, reserved
chapter marker publication and rollback after invalid publication. The local
server lacked pgvector, so this harness substituted only the embedding cast/type
with bounded text; it did not verify vector operations or deployed Supabase RLS.

Live verification also passed against the actual Supabase database: schema and
RLS checks, native publication-marker transaction followed by rollback, public
reference reads, and signed-in historical snapshot persistence/idempotency with
fixture cleanup. Supabase's security advisor now reports no SQL security errors;
the separate Auth leaked-password-protection warning remains.

The release sequence is a verified dev preview followed by the user-authorized
main production release. General live
tariff totals remain withheld without reviewed consolidated Section 232 coverage
and evaluation of the July action. No coverage review was fabricated to unlock
a quote. See SUPABASE_VERCEL.md for the schema and pilot prerequisites.
