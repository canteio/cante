# October 9 scoped MVP completion follow-up

Built the public-product supervised CSV pilot described in MVP_STATUS.md.
Verified dev preview: https://cante-mc3xgw7z8-jeremygautamas-projects.vercel.app
(Vercel build completed successfully; authenticated workflow was tested locally
against the live Supabase tenant boundary).
The user confirmed no Toro data is available. Public LulzBot product descriptions
are cited; all customs entries, proposed classifications and qualification facts
in the demo are explicitly synthetic. No result is presented as LulzBot's real
imports or a refund entitlement.

Verified on dev:

- Authenticated browser: two catalogue products imported; historical upload
  produced three computed lines ($415/$440/$380) and one unresolved motor.
  Assessed-minus-paid differences were $0/+$25/-$20; $5 resolved subtotal,
  full total withheld. Before/after company scenario used $4,000 of historical
  values and produced $100, explicitly not annualized or newly detected.
- Browser duplicate submission reused the same immutable run. CSV download
  contained four entry identities, exact amounts, status and citations.
- Browser invalid file: missing HTS, missing origin and repeated entry identity
  produced four errors; unmatched SKU produced one unresolved row; zero computed,
  total withheld. No guessed catalogue match or duty total.
- 865 tests passed in the full suite; a further monitor-status route regression
  passed with the other seven route cases (866 total cases). TypeScript and
  production build passed. Local browser console had only the pre-existing
  development analytics script blocked by CSP; no workflow/API error.
- Live rollback-only SQL verified unchanged vector preservation, missing-vector
  rejection, atomic chapter markers, one rate-change record per change and
  no authenticated permission to publish chapters. No test rate changes retained.
- Three migrations applied (28 total); HTS Edge Function v6 active. Live request
  12 returned HTTP 200, Revision 21 fully ingested, 99/99 markers. Health stored
  complete at 2026-10-09 19:00:37 UTC. Earlier failures remained visible as
  incomplete and resumed correctly. No new schedule/Telegram/launchd activated.

Deployment packaging correction: the first CLI preview included the local `.env`
and browser artifacts because Vercel CLI does not inherit `.gitignore`. That
preview was removed immediately. `.vercelignore` now explicitly excludes local
environment files, databases, references and QA artifacts. The replacement's
source-file listing was checked and contains none of those sensitive/debug
paths. Local credentials were transmitted to the private Vercel build service;
removal is not credential rotation. The operator should rotate affected local
secrets and check earlier CLI deployments made without this exclusion file.
No claim of public access or secret misuse has been established.

Important remaining limits: the historical scope is exact 3916.90.30.00 CN/VN
for July 21–27 and September 15–27, 2026, with explicit qualification review.
General Section 232 and broader Chapter 99 rules remain unresolved. Automatic
monitoring proven here is the existing HTS source job; broad regulatory legal
activation and outbound customer notifications are not claimed. Real customer
or broker entries remain unavailable. Source-rate changes are base-component
scenarios, not approved total-duty changes. See MVP_STATUS.md.

---

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
