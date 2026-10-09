# MVP status — October 9, 2026

Cante now has a working, supervised CSV pilot for a bounded tariff scope.
It is not yet a general-purpose customs audit product or validated for Toro.
The operator confirmed there is no Toro data: public LulzBot descriptions are
used for the demo, with explicitly synthetic customs entries and qualifications.

## Verified workflow

1. Import the two products in `public/examples/lulzbot-public-products.csv`
   through Catalogue. Public descriptions have citations; demo SKUs, proposed
   HTS classifications and all customs facts are test assumptions.
2. Upload `public/examples/lulzbot-synthetic-imports.csv` through Tariff.
   Deterministic header mapping works without an LLM. Confirm the mapping.
3. Review immutable, tenant-linked entries. Three supported lines assess
   $415, $440 and $380, against paid amounts $415, $415 and $400. Differences
   are $0, +$25 and -$20. The unsupported motor remains unresolved; the full
   total is withheld. A difference is a review lead, never refund entitlement.
4. Review the separately labelled July 24 historical change. Holding the
   supported $4,000 import basket constant gives $100 additional duty. The
   dashboard shows before/after components, sources, dates and assumptions.
   This is neither a newly detected change nor an annual forecast.
5. Export the saved entry results. Browser verification confirmed all four
   entries and their exact amounts. Repeating the same upload reuses one run.

## Automatic monitoring

The existing six-hour Supabase HTS job remains the only active schedule. No
Telegram, launchd or new schedule was activated. HTS Edge Function version 6
splits ingestion into bounded chapter requests. Unchanged vectors stay in
Postgres; chapter publication remains atomic. A function-scoped PostgREST
55-second timeout allows chapter 99 to publish without changing tenant timeouts.

Live execution completed Revision 21 with all 99 chapter markers at
2026-10-09 19:00:37 UTC. The dashboard now exposes checked time, last complete
synchronization, revision and incomplete/failure state. Published rate changes
are stored once and matched to uploaded catalogue-linked HTS codes. Their
base-duty scenario is explicitly separated from legal activation and total duty.
Source-change storage starts with this migration; earlier changes are not
claimed to have been monitored.

## Supported legal scope and limits

Historical assessment: exact HTS 3916.90.30.00, China/Vietnam, July 21–27 or
September 15–27, 2026. Archived Revisions 12/19 establish base rates; cited CBP
and Federal Register sources establish the July 24 transition from Section 122
to the additional Section 301 measure. Classification, origin, transit,
importer-specific relief and special treatment require explicit caller review.
The public LulzBot descriptions do not establish any of these customs facts.

Other codes/dates, general consolidated Section 232 coverage, AD/CVD,
exclusions, preferential claims and broader Chapter 99 applicability remain
unresolved unless separately supported. No Section 232 review was fabricated.
No real manufacturer or broker ledger has been validated. Regulatory notices
beyond the scheduled HTS source still require the trusted worker; a complete
automatic legal-rule activation and customer notification pipeline is not
claimed. Telegram and launchd remain prohibited.

The CSV path is bounded to 500 rows/2 MiB. Larger histories need a background
job path. The minimum next customer step is reviewed classification/qualification
and broker reconciliation of representative real entries, not ERP integration.

## Verification

865 existing/expanded tests passed, plus the new monitoring-status route test
(866 total cases across the suite). TypeScript passed. Live rollback-only SQL
verified vector preservation, missing-vector rejection, atomic markers,
change deduplication and service-only publication. Authenticated browser
acceptance exercised catalogue, historical upload, company scenario, export
and duplicate reuse. See `AUDIT_FIXES.md` for release verification.
