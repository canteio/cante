# Dated historical rate restoration

October 28, 2026 · historical audit v28 · locally verified; broad goal unfinished.

## Original evidence and implemented scope

The official [2017 Revision 1 change record](https://hts.usitc.gov/reststop/file?release=NTE&filename=Change%20Record)
expressly restores the Column 2 duty for 6907.30.10 effective January 1, 2017,
under PP 9549. The earlier [annual data](https://www.usitc.gov/tariff_affairs/documents/tariff_data/tariff_data_2017.zip)
and [Basic schedule](https://hts.usitc.gov/reststop/file?release=basicCorrections2&filename=Chapter%2069)
really have blank Column 2 fields. [Revision 1](https://hts.usitc.gov/reststop/file?release=NTE&filename=Chapter%2069) prints 55%. These are missing original data, not a
zero rate or permission to apply a later rate retroactively without evidence.

The original change-record PDF is now retained in Supabase and read-back verified:
source `8185ae5e-be90-4eca-96fa-758999b05e98`, 131,343 bytes, SHA256
`de11cbf64ac78634544edeb4e8570035bd89a543054370f5aee242564ce4df4a`.
The existing immutable publisher captures evidence only; no shared rule or
historical snapshot was approved.

The common archive/registry/details identity validation now also recognizes the
exact Change Record file. A bounded complete-wording contract establishes the
named dates. Hash agreement alone is not legal approval: edition provenance,
the operative wording, exact code and separate corrected chapter row are required.
Changed, missing or conflicting evidence withholds the result.

The existing annual Column 2 calculation can now use that explicitly dated
restoration for the three published statistical codes 6907301005, 6907301011 and
6907301051. It requires the corresponding corrected edition, retains the earlier
blank fields and original schedules, and keeps the separate 10% MFN reference.
The compiler interval is bounded to the annual year and explicit restoration date.
Dates of publication/capture are not substituted for legal dates.

This remains a **Cante-validated reference estimate** on declared classification,
legal origin and lawful ordinary-entry scope. It is not human legal approval,
an admissibility determination or a refund entitlement. Country eligibility,
additional-duty clearance and other required facts retain their existing gates.

The source also expressly dates the 2918.17.00 and 2931.39.00 statistical changes
to July 1, 2017. Those facts are parsed and tested, but their calculation routing
is still unfinished. For 4409.22.65, the record gives the restoration date as
**N/A**. That case stays unresolved with an explicit reason; no date was invented.

## Existing code reused

- `ordinary-contract.ts`: shared edition provenance and the strict change-record
  wording contract, including negative tests for changed/missing dates and sources.
- `annual-data.ts`: dated restoration, exact formula, preserved blanks and explicit
  undated-correction handling in the existing Column 2 path.
- `store.ts`: bounded source selection, pinned parent provenance, retained-source
  reading and propagation into calculations/citations. Existing quotas and caches stay.
- Existing audit compiler/engine: deterministic cents, dated intervals and accurate
  explanation of the blank annual field and corrected original.
- Existing finding detail/CSV: correction date, earlier blank and corrected 55%
  rate remain visible. No additional workflow or approval authority is introduced.
- `scripts/backfill-annual-change-records.ts`: read-only by default; `--write`
  retains the verified original. It does not approve law or write tenant entries.

## Verification and its limits

27 targeted tests pass, including provenance, exact original page cells, absent
or altered evidence, wrong editions, missing corrected rates, duplicate correction
proofs, undated changes and preservation of raw blanks. TypeScript, 938 library
regressions, 216 historical regressions, isolated website/worker builds, actual
bundled-worker REST/checkpoint recovery and scheduler-idle checks pass. Test sets
overlap and are not added together.

Nine read-only cases first verify the actual Supabase source-selection path across
all three published codes and January/June/October dates. Separately, 100 fictional
declarations and independent Python Decimal half-up results verify 90 calculations
and ten intentionally incorrect or unsupported cases. All calculated/CSV amounts
match. Potential overpayment and underpayment are each USD 30.00 in this fictional
ledger. Neither fixture establishes customer savings or broad legal accuracy.

Real isolated Auth/Supabase acceptance uses the actual preserved v27 worker followed
by v28 on unchanged pinned sources. Upload/map/save idempotency, engine refresh,
protected completion, report export and foreign-tenant API/RPC/direct-read denials
pass. The old run keeps all 100 unresolved results; v28 calculates the supported 90.

Browser review records a fictional dated classification correction from suffix 05
to 11 for line 1. The original declaration, SKU/product link and earlier runs remain.
Expected duty stays 550.28 on USD 1,000.50; paid duty is 551.28 and the potential
difference is 1.00. The three protected result versions and ten older saved-result
sets verify their hashes. Every downloaded CSV amount matches the independent
oracle, with original blanks, separate MFN, dates and citations retained.

After browser sign-out the harness reports token-revocation HTTP 400. Independent
SQL confirms all 86 audit-pilot fixture identities are banned, none are active and
zero fixture sessions remain. Owned tab 45 and ports 3132/3133 close; the original
development server PID 24938 on port 3000 remains live. No customer records,
schema, grants, quotas, dependencies, shared approvals or schedules changed.

Application and worker changes are **not deployed**. One public government source
was retained in the shared archive; this is distinct from a hosted code release.

Private local artifacts:

- `/tmp/cante-v28-{change-contract-tests,change-record-dry-run,change-record-import,restoration-tests-final,restoration-source,restored-source-goldens,regression,historical-regression,tsc-complete,worker-tests,daily-worker,live-acceptance,browser-proof,export-proof,cleanup}.log`.
- `/tmp/cante-v28-unresolved-source-inventory-final.log` and
  `/tmp/cante-missing-column2-unresolved-diagnostic.json`.
- `/tmp/cante-v28-browser-proof.json`, `/tmp/cante-v28-restored-duty-evidence.png`.
- Isolated build `cante-watch-build-Te2r1v` in the system temporary directory.
- Final worker `output/check-worker/api/check.mjs`, SHA256
  `76dde8394c300aeeaaf5986018d7a8c674bfc4cc23883fd8de8dbcb4c76140fe`.
  Preserved actual v27 is `output/watch-v27-worker/api/check.mjs`.

## Remaining work

Rechecking all thirteen previously unresolved source records recovers one record
and three of its 31 observed code/date cases. Twelve records remain; this is a
scoped recheck, not a fresh full scan of all 548 original records.

Remaining here: seven derived parent/juice records, two chemical statistical-date
cases, the undated wood correction, milk's additional 9904 treatment and the
85299054 edition mismatch. The chemical change record now provides a concrete
next step: keep dated exact-code reporting separate from unchanged legal-line rate
corroboration, without selecting a convenient edition or fabricating suffixes.

The broader [completion ledger](../plans/historical-coverage-completion.md) remains
open across countries/preferences, metals and other Section 232, AD/CVD,
exclusions, remaining quantity/derived formulas and special entry/cutoff treatment.
