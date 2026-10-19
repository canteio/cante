# Historical tariff-rule comparison

October 18, 2026 (U.S. Eastern). Implemented on `dev`; migration
`20261019033002_tariff_historical_source_evidence.sql` is applied to the linked
project. The app was not deployed. No model calls, schedules or notifications
were enabled.

## Implemented workflow

Every live check establishes the current release and discovers its immediately
previous published release from the official USITC registry. Availability intervals
must be continuous and identities unique. Actual archive links are discovered from
up to four publisher index pages; filenames are not guessed.

The check retains:

- Original previous-revision complete JSON schedule.
- Both explicitly versioned Chapter 99 subchapter III PDFs, with checked revision
  labels and bounded extraction.
- The official registry/archive index used to establish the pair.
- Up to six linked modifying Federal Register documents, their available text,
  publication/effective-date metadata and official PDF copies.

It compares exact uploaded product codes and their published ancestors for base
duty, all numbered Chapter 99 heading descriptions/general rates, and normalized
legal text in U.S. notes 16, 20 and 52. Header/footer differences are removed;
numbered article context constrains code matching so neighboring articles are not
falsely treated as affected products. Broader changed text stays marked for review.
Known current engine measure IDs can also connect changed headings to product leads.

The UI separates previous-published/current-published text, same-value base-duty
differences and candidate SKUs needing review. These are not automatic exemptions,
confirmed affected shipments, complete historical stacked-duty calculations or
refund entitlements. Release availability, notice publication and document effective
dates are separate facts. A current release changing during a check invalidates
the historical comparison. Failed/missing sources never become “nothing changed.”

## Source verification

The current notes endpoint returned identical content for requested releases 20
and 21; it was not used as proof of historical notes. The explicitly versioned
PDFs have distinct hashes/revision labels and the actual old/new wording.

The original JSON schedules for these two editions were identical. That did not
mean the legal rules were unchanged: the PDF comparison found the addition in
note 20(vvv)(i)(20), covering statistical reporting number 8479.90.9591 from July 1,
2026 and limiting the preceding code reference through June 30. The modifying
notice was published October 7, 2026. This demonstrates why a base-rate or JSON-only
comparison cannot support an “all unchanged” alert.

Official sources:

- [Release registry](https://hts.usitc.gov/reststop/releaseList).
- [Archive index](https://www.usitc.gov/harmonized_tariff_information/hts/archive/list).
- [Previous schedule JSON](https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_20_json.json).
- [Previous subchapter III PDF](https://hts.usitc.gov/reststop/file?release=2026HTSRev20&filename=Chapter%2099_III).
- [Current subchapter III PDF](https://hts.usitc.gov/reststop/file?release=2026HTSRev21&filename=Chapter%2099_III).
- [Conforming amendment](https://www.federalregister.gov/documents/2026/10/07/2026-20511/notice-of-conforming-amendment-to-product-exclusion-chinas-acts-policies-and-practices-related-to).
- [Official amendment PDF](https://www.govinfo.gov/content/pkg/FR-2026-10-07/pdf/2026-20511.pdf).

## Persistence and boundedness

All original evidence is included in the existing immutable check archive. Large
JSON is losslessly gzip-compressed and base64 encoded. `sha256` checks retained
compressed bytes; `originalSha256`/`original_sha256` checks the original downloaded
bytes after bounded decompression. PDFs are retained as original bytes in base64.
The migration adds this optional metadata and the official USITC/GovInfo hosts;
existing RLS, append-only triggers and authenticated invoker access remain intact.

Fetches have time/byte limits, PDFs have a 700-page limit, and individual/staged
archive capture budgets are checked before retaining oversized bodies. Old code
absence is unresolved, not zero. Evidence exports retrieve one bounded source per
database response with at most three concurrent requests. This avoids combining
many multi-megabyte PDFs into one database response. Export routes have an explicit
300-second maximum duration.

## Verification

- Migration passed on isolated PostgreSQL 14 and was then applied to the linked
  database. The archive/RLS SQL suite passed locally and remotely, rolling back all
  fixtures. Lossless metadata is accepted; incomplete encoding metadata is rejected.
- 36 focused tests passed: real historical source fixture, adjacent-release
  continuity, missing/duplicate exact codes, old/new note text, negative neighboring
  product matches, failed sources, archival integrity, compressed original hashes,
  live-handler guards and existing current-remedy tests.
- 88 existing stack, single/bulk route and business-impact regressions passed.
- TypeScript and an isolated production webpack build passed.
- The real read-only verifier retrieved Rev20/Rev21 and retained 14 historical
  sources (about 12.4 MB), with matching stored/original hashes. Tested base duties
  were unchanged; the actual exclusion-note insertion was found.
- Two actual authenticated checks in a temporary isolated workspace retained their
  separate records. The hosted QA server had no worker/admin or model API keys.
  The matching hypothetical SKU was flagged; an unrelated motor SKU was not.
  Original uploaded classifications/values were explicitly test assumptions.
- Actual history export reopened the comparison and all 26 captured sources,
  verifying each retained hash and the decompressed original JSON hash. The
  compressed source's own download endpoint also passed.
- A verification-harness array was initially sorted in place, causing an expected
  persistence-comparison mismatch; the harness was corrected to sort a copy.
  A later evidence-read request returned 502 while records remained intact;
  direct authenticated reads verified the retained data. Bounded per-source
  retrieval was implemented and the final app export passed.
- Desktop/mobile browser checks exercise saved comparison reopening, original
  wording, the separately stated notice/effective dates and full evidence download.
  Local analytics can log existing 404/MIME errors.
- Temporary QA records/workspace/user and owned servers are removed after checks;
  the existing localhost development server is retained. Cleanup is narrowly scoped
  administrative fixture maintenance, with archive triggers restored transactionally.

Public offline fixture/provenance: `scripts/test-fixtures/historical-rules/`.
Ignored raw source captures and verification exports: `raw/historical-rules/`.
Reproduce with `npm run test:history` or fresh read-only `npm run verify:history`.

## Remaining scope

This is automatic adjacent-revision backfill for a live check, not a complete
archive of all laws since 1989. It does not backfill eCFR, reconstruct every older
amendment chain, prove that an edition was legally applicable to every entry date,
or determine all retroactive/exclusion/transition qualifications. Extensive
changes, unsupported edition labels/formats, missing codes, omitted index pages,
unavailable documents and unexamined legal subjects remain explicit limitations.
Current calculations retain their existing legal-coverage caveats. The broader
monitoring worker is still disconnected and notification delivery remains disabled.

The security advisor showed the existing stacking-review SECURITY DEFINER and
password-protection warnings, with no new archive-specific issue. See the
[prior archive audit](2026-10-18-check-history.md) for remediation references.
