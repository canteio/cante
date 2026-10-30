# Original Section 301 scope and 2019 PDF identity

October 29, 2026. Audit engine v36; local changes, not deployed.

## Changes

The dated Note 20 compiler previously left some explicitly excluded statistical
codes unresolved because it could not establish complete scope for the original
unconditional Lists 1–3. It now recognizes four exact original clauses, strips
only known publication/compiler annotations and parses the entire fixed-width
list. Unknown instructions, conditional wording, duplicate cells or other
unparsed content cannot establish complete negative scope. Original action dates
and rates are still required; hashes identify parser contracts, not approval.

The original `2019HTSAREV7C` consolidated PDF renders an English cover but extracts
incorrect Unicode from its cover font. Its body rate tables are ordinary English.
A narrow publication-identity contract requires the whole original SHA-256,
observed cover text hash and exact edition/date interval. It does not repair or
transliterate duty text, substitute another edition or trust a member's hash.
Existing exact-code, chapter and row checks remain required.

The shared exact-statistical-code predicate now lives in the existing shipment
module. The finding editor uses it to expose the 2019 shipping confirmation when
a proposed classification correction newly brings the entry into List 3 scope.
A classification decision cannot infer shipping qualification.

Relevant files:

- `app/api/tariff/references/historical-contract.ts`: complete dated original lists.
- `app/api/tariff/references/pdf-rates.ts`: whole-original cover identity.
- `app/api/audits/shipment.ts`: shared exact-code membership.
- `components/audits/audit-workspace.tsx`: evidence controls for corrected codes.
- `scripts/test-initial301.test.ts`: original clauses and rejection contracts.
- `scripts/generate-initial301-audit-fixture.py`: independent Decimal fixtures.
- `scripts/verify-initial301.ts`: real retained-source calculation oracle.
- `scripts/verify-audit-pilot-workflow.mjs`: saved old/new worker acceptance.

## Evidence verified so far

The read-only real-source 100-entry oracle passes all initial and reviewed amounts,
components and CSV fields. There are 24 pinned sources. Initially 68 entries
calculate and 32 remain open. Thirteen explicit fictional shipping decisions
produce 81 calculated / 19 open. Independent expected differences are USD 27
potential overpayment and USD 27 underpayment. These are fictional test amounts.
The separate classification-plus-shipping correction calculates USD 250.34 while
preserving the original declared code. Classification alone stays unresolved.

The earlier five-case failing source golden now passes: two 2018/2019 positive
codes calculate 10%; two explicit exceptions calculate zero; the ambiguous 2018
plastic statistical family stays unresolved. Three exact 2019 Revision 7 codes
now read their own published Free base rows from the original PDF.

473 script tests, 938 library tests, TypeScript, isolated webpack site build,
worker build and isolated REST worker recovery pass. No model calls, human
approvals, source writes or customer-data writes were made by the read-only
oracle. Parser unit tests explicitly label synthetic action proofs; those tests
are separate from the verifier's real retained action evidence.

Real isolated Auth/database/worker/browser v36 acceptance passes. Actual v35
calculates 28 lines; v36 calculates 68 from the same 24 pinned sources, then 81
with 13 shipping decisions and 82 after browser correction. Protected revisions
0/1/14/15 and all output hashes verify. All 100 browser-downloaded CSV amounts
match, as do the explicit classification/shipping decisions, original declared
9401614001, corrected 9401614011 and unchanged product match. Twenty earlier
saved result sets, including the first v36 test attempt, verify. Foreign detail,
export, refresh, RPC and raw result reads are denied. A deliberately blank SKU
stays unmatched; the initial harness assumption that all rows must match was
corrected without changing application behavior.

Audit `14756a3d-89b5-46dc-aba7-35095e7b01ed` ends at 82 calculated / 18 open,
USD28 potential overpayment / USD27 underpayment in fictional entries. Browser
screenshot `output/playwright/cante-v36-initial301-audit.png` was visually checked.
Fixture Auth sessions were revoked and identities banned. Independent SQL:
110 fixture identities banned, zero active, zero sessions. Owned browser and
3132/3133 closed; existing development server PID24938 remains. No customer
workspace, approval, schema, grants, quotas, schedules or deployment changed.
Worker SHA256 `f6aca30e0a18fc7d60620b2e1c7ddb9c6d6ab36e6dd3aced259d509cefe04fa3`
is preserved at `output/watch-v36-worker/api/check.mjs`.

## V37 integrity follow-up verified

A deliberate list-cell deletion demonstrated that minimum row counts and clean
syntax could still accept incomplete original lists: 818 became 817 while
completeScope remained true. The follow-up requires complete original sequence
fingerprints for the unconditional lists. New missing/substituted-cell tests, 474 script tests, TypeScript, the pinned
real-source 100-entry replay, isolated site/worker builds and REST worker recovery
pass. Real saved API, browser correction/export, prior-result integrity and tenant
checks pass. The real audit is `24d4253b-d558-4357-92fc-05e69c1cb6fb`: protected
revisions0/1/14/15 retain engines35/37/37/37. All100 downloaded CSV amounts and
21 prior saved result sets verify. Final82/18 and fictionalUSD28over/27under
match the separate oracle. The original code and original upload remain intact.
Screenshot `output/playwright/cante-v37-initial301-audit.png` was visually checked.

Independent cleanup confirms112 fixture identities banned, zero active and zero
sessions. Owned browser/3132/3133 closed; original development PID24938 remains.
No model, source write, approval, schema/grant/quota/schedule or deployment change.
Actual v37 worker SHA256:
`ce1dd4d83db113435790f90ca5fd603f81bc3b86a5010c2e20c094fe9af0b3a0`,
preserved at `output/watch-v37-worker/api/check.mjs`. Do not claim the
v36 browser run used the v37 hardening. Conditional later-list grammars remain
separate follow-up work; this does not validate all Chapter 99 list extraction.

A read-only reinspection also confirms the ten Canadian instruction blockers.
Some are scope determinations or court/exclusion/correction chains; others have
repeated rate labels, missing/malformed table fields, date spacing, or multiple
operative periods. Original source bodies and hashes are retained locally in
`/tmp/cante-v36-unparsed-canadian-originals.json`. No guessed repair or rate was
applied; these are the next AD/CVD interpretation tasks.

## Limits

This resolves selected early Section 301 and publication-reading gaps. It does
not complete all exclusion definitions, other Section 232 sectors and credits,
AD/CVD assessment instructions, preferences, quotas, special entries or historical
coverage. None of the broad completion checkboxes is closed by these tests.
