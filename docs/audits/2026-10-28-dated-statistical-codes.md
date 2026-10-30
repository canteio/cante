# Dated statistical codes — October 28, 2026

Audit engine v29 is locally verified, not deployed. Full historical coverage
remains unfinished. This change implements two dated 2017 chemical reporting
families in existing services; it does not introduce a new tariff engine.

## Implemented

The retained USITC 2017 Change Record establishes July 1 reporting annotations:
2918170000 becomes 2918170001; 2931390000 becomes 2931390012/15/18. The existing
annual legal-line rates are 5.8%/3.7% MFN and 15.4¢/kg+40%/25% Column2 respectively.
These code changes do not themselves establish a legal-rate change.

`app/api/tariff/references/annual-data.ts` checks the complete existing change
contract, annual fields, source identities and every code actually printed in
Basic and Revision1 originals. `store.ts` requests the edition's published codes;
`compiled-reference.ts` pins the selected side of July1. No source row is relabeled
as a shipment code. Both editions and all old/new formulas must agree. Column2
blank numeric fields and MFN truncation remain preserved; complete original
rates support the separately labeled calculation. Percent-only duties need no
invented quantities; compound duties require the supplied matching kg quantity.

`app/api/audits/engine.ts` returns an actionable wrong-code/date finding and never
chooses a replacement. The existing dated evidence review can correct it, creating
a revision and retaining the original declaration. `audit-workspace.tsx` shows
original codes per edition and the annotation basis. Version metadata is v29;
older protected results remain readable and immutable.

These are Cante-validated narrow reference estimates, not human-approved rules,
verified classification/origin, admissibility conclusions or refund entitlements.
The existing source record is reused; no government source, approval, schema,
grant, quota, secret, daily target or deployment changed in this revision.

## Verification

- Sixteen Column2 tests include 24 valid date/code/column combinations, sixteen
  wrong-date/unknown-code controls, source/contract conflicts and quantity guards.
  Fourteen annual-schedule tests cover the companion contracts.
- 219 historical regressions and 938 library tests pass. TypeScript, isolated
  website build, final bundled worker/recovery/security and daily-worker idle
  checks pass. No real daily check was triggered.
- Read-only retained-source verification checks100 fictional lines against an
  independent Decimal half-up oracle and CSV expectations:84 calculated/16 open,
  USD28 over/28 under. Sixteen pinned sources, zero source writes, model calls or
  approvals. Synthetic declarations do not establish broad legal accuracy.
- Real isolated Auth/database/site/worker workflow verifies upload/mapping,
  idempotency, actual preserved v28→v29 refresh with unchanged sources, exports
  and foreign-tenant API/RPC/direct-read denials. The preserved v28 result has12
  calculated lines; v29 has84. Prior results remain unchanged.
- Browser evidence corrects fictional line85, June30, from declared2918170001 to
  supported2918170000: paid500.00,expected401.74,difference98.26. Original/raw code,
  exact product match, evidence and June30→July1 decision remain. Final85/15,
  USD126.26 over/28.00 under. Downloaded CSV checks all100 amounts, code identity,
  blank numeric fields, citations and review evidence.
- All100 row hashes and ordered output hashes for each of three protected
  revisions verify, as do eleven earlier saved-result sets.
- Two loopback-host setup attempts failed CSRF origin checks before uploading;
  no CSRF protection was changed. Their accounts were independently cleaned.
  Final localhost acceptance passes. Browser signout precedes a cleanup token
  HTTP400; independent SQL confirms92 banned fixture identities,zero active and
  zero sessions. Owned tab46 and ports3132/3133 close; mainPID24938/3000 stays.

Final worker SHA256:
`5759c7eb191784ba744b651020ebaf5bc22ee515ea03aead8f273f5d490d4b0d`.
Actual v28 retained at `output/watch-v28-worker/api/check.mjs`, SHA256
`76dde8394c300aeeaaf5986018d7a8c674bfc4cc23883fd8de8dbcb4c76140fe`.
Final isolated website: `/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-watch-build-SxalV0`.
Private runtime acceptance files/exports remain outside tracked documentation.

## Still unfinished

The scoped previous13-record inventory now has one fully recovered record,
two partly recovered and ten without formulas. Five observed cases recover;
four probes use a code before its July1 establishment and correctly require
classification review;22 other observed cases remain unresolved. This is not a
new full548-record scan or a complete reporting-code catalogue.

Seven derived records, undated wood restoration, milk9904 and an85299054 edition
mismatch remain in that set. Broader country/preference, metal/other232,
AD/CVD, exemption, quantity and special-entry/cutoff work stays open in the
[completion ledger](../plans/historical-coverage-completion.md). No broad box closes.
