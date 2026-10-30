# Earlier Canadian deposits and published preliminary editions

October 30, 2026. Audit engine v38. App code is local and undeployed. Two
reference-schema migrations and public reference captures were applied to the
shared Supabase archive. No tenant imports, human approvals, reviewer appointments,
schedules, grants or RLS policies were changed. Overall historical coverage is
still incomplete.

## Calculation changes

`app/api/tariff/references/adcvd-history.ts` supports complete named-company tables
with leading field indentation, an exactly repeated cash-deposit label and a
missing space before an explicit date. It does not fill missing values. Rates
must end their field; trailing extra numbers or qualifications cannot disappear.

The actual correction 2032411 gives one company 6.31% from December 2, 2021,
through January 9, 2022, and 6.32% starting January 10. A narrow whole-original
contract reads both periods, including the inclusive-through date. Row operative
dates control instruction ordering and explanation; the correction's earliest
header date cannot hide its second period behind another January instruction.
Changed or unknown multi-period text remains unsupported.

A referenced amendment explicitly limited to listed companies supersedes those
company rows. It preserves an unlisted company's rate from the same-date original
instead of silently discarding it or reaching for an older review. Both original
and amendment remain cited. Scope, exact parties, payment stage and complete
case/instruction qualifications still require explicit evidence decisions.

## Official publication coverage

The [USITC announcement](https://www.usitc.gov/press_room/featured_news/official_2021_basic_hts_now_available.htm)
documents the 2021 preliminary editions. The current publisher registry also
lists the early-2022 preliminary edition. Five observed publications now have
retained full schedules and Chapter 99 originals: ten original PDFs, each checked
against printed year/preliminary/revision identity, downloaded bytes and stored
read-back hashes. These are public references, not human-approved rules.

Normalization accepts these observed names; unknown preliminary names remain
excluded. A comparison window cannot start before its edition year. The initial
2021 preliminary book's actual publisher availability was December 31, 2020;
its comparison window starts January 1, 2021. Original publisher dates remain in
the retained registry bytes and source metadata. This is a conservative usable
reference window, not an assertion that every included law took effect on that
date. January 1–3, 2022 still lacks an established publication window; no adjacent
edition or current rate is silently substituted.

The original release registry bytes did not change, but their old parsed snapshot
excluded preliminary editions. The archive now keys registry projections by URL,
original-byte hash and parser version. Old records remain immutable; new metadata
has a separate source ID. The original snapshot has 173 releases; the new
`published-preliminary-v1` snapshot has 178, with the same original-byte hash.
Capture completion requires metadata read-back as well as byte integrity. The
`--registry-only` mode reuses previously verified originals instead of repeatedly
uploading/downloading full books.

Applied migrations:

- `20261030062112_published_preliminary_tariff_references.sql`: observed names and
  a conservative edition-year floor; no access-control change.
- `20261030063951_tariff_registry_projection_versions.sql`: indexed immutable
  projections and the existing invoker publisher's matching lookup. Permissions,
  empty search path, timeouts, body bounds and hash checks remain. The replacement
  index is 304 kB; no generated stored column or evidence-table rewrite remains.

Old registry: `2077acc7-3214-40df-b60a-cedaa7c1998d`.
New registry: `b89dc825-40b3-4bd0-9ed0-c78b9098d79f`.
Original registry SHA256:
`d07d7d022319bf6f1b4c60918565ad528ca3df8be9eb2e6d0c6ee2defd2d0f81`.

## Database incident and recovery

An earlier attempted projection migration added a generated stored column to the
large reference table. During that attempt the connection terminated. Provider
logs at 06:29:30 UTC reported WAL disk exhaustion and database shutdown. The
agent should have checked disk headroom and avoided rewriting the evidence table.

Further writes stopped. No customer data was deleted, no backup restore or
manual plan/compute change was performed. The database subsequently recovered;
its postmaster start time was 06:34:18 UTC. SQL confirmed the failed migration
was not recorded and its column did not exist. Its attempted SQL was moved to
ignored private incident evidence, outside executable migrations. The corrected
expression-index migration above was applied only after live metrics showed
sufficient headroom. No generated stored column remains.

Post-recovery checks: database size about 1550 MB; data disk about 8.4 GB with
6.3 GB available; root disk about 10.5 GB with 2.9 GB available. Those are observed
post-recovery measurements, not evidence of the prior allocated size or cause of
recovery. Four protected v37 snapshots and 21 earlier saved synthetic result sets
still pass all stored/aggregate hash and amount checks. This is a scoped integrity
check, not a blanket assertion about all possible data. Security-advisor results
are unchanged (three existing findings; none new). Authenticated accounts still
cannot insert release rows or execute the publisher; it remains invoker-only and
service-role executable. Recovery dashboard access is no longer needed; its
temporary signed-out browser tab was closed.

## Verification

- 480 script tests pass, including exact period transitions, listed-company
  amendments, malformed actual source fields and publication-window guards.
- TypeScript, isolated website/worker builds and isolated REST worker recovery
  pass. The 938 library tests passed before these changes; no library
  implementation changed in this revision.
- Read-only actual-source 100-entry oracle passes every amount, component date,
  message citation and CSV field. Ninety fictional qualified entries calculate;
  ten incomplete/invalid controls remain open. Fictional potential overpayment
  and underpayment totals are USD30 each; these are not customer savings.
- Without evidence decisions, all 100 stay unresolved. No model, tenant write or
  legal approval is used by the verifier. It pins 100 sources.
- Full case inventory accounts for all 34 retained deposit messages: 27 currently
  parse. Remaining: 0189410, 0189411, 0343402, 3216402, 4018402, 5121401, 6238403.
  The new strict check rejects actual `1.57%2.02` in 0343402; the older parser had
  accepted its prefix. This is not counted as supported or repaired by guessing.
- No new Auth fixtures: existing 112 fixture identities remain banned, with zero
  active fixture users/sessions. The original development server remains running.

The new v38 calculations were tested through retained sources, the deterministic
engine, CSV export and the bundled REST worker fixture. A new real saved/browser
v38 audit was not run. The previous v37 real saved/browser/export/tenant acceptance
remains distinct; it was not relabeled as v38 verification.

Reproduce with `npm run verify:historical-canada-early`. Its explicit `--replay`
uses an identical-input local snapshot; a source/data change requires a fresh run.
Operator capture: `npm run references:backfill-preliminary` previews;
`-- --write` retains verified public originals; `-- --write --registry-only`
refreshes only the versioned projection after verifying the existing originals.
Never use these as routine customer-data setup.

## Remaining scope

The seven messages above need scope, malformed-field, exclusion/court or header
correction treatment. Also unfinished: final assessments, broader AD/CVD cases,
conditional later Section 301 list integrity, other Section 232 conditions and
credits, quotas, preferences/exclusions, quantity edge cases and special entries.
All broad completion checkboxes remain open. Recovery is verified; full legal
coverage, production deployment and a global completion percentage are not.
