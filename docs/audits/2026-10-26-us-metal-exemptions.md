# Historical U.S.-metal exemptions — October 26, 2026

Local audit v14 work. Full historical coverage remains IN PROGRESS. No deployment,
daily target, permission, schema, dependency or human rule approval change.

## Dated support

The existing engine now distinguishes an evidenced U.S.-metal qualification from
a numerically zero metal duty. New-derivative 9903.81.92 and 9903.85.09 treatment
uses the exact dated scope, explicit melt/pour or smelt/cast evidence, and the
published zero-additional-duty row. A supplier address or declared heading alone
does not establish qualification. Conflicting U.S./Russian aluminum evidence
withholds the total. Primary and previously covered derivative headings do not
gain the new-derivative exception.

The original reciprocal exception and later content allocation are separate:

- [Federal Register 2025-06063](https://www.govinfo.gov/content/pkg/FR-2025-04-07/pdf/2025-06063.pdf)
  expressly names the qualifying zero-duty headings. Supported original-period
  treatment exempts the reciprocal duty for the whole article; no content value
  is invented where that calculation does not need it.
- [Proclamation 10947, 2025-10524](https://www.govinfo.gov/content/pkg/FR-2025-06-09/pdf/2025-10524.pdf)
  supplies the exact June 4 original cutoff and non-metal allocation clause.
  The dated note may still show the earlier text; it cannot override this original
  amendment. Later [2025-15819](https://www.govinfo.gov/content/pkg/FR-2025-08-19/pdf/2025-15819.pdf)
  and consolidated Note 2(v) explicitly state the content treatment. Only evidenced
  metal portions are deducted; unrelated metal is not an exempt portion.
- Dated Note 2(z) and the original India implementation expressly name these
  zero-duty headings. Its qualified derivative exemption is separate from the
  reciprocal allocation. The independent China Section 301 and IEEPA duties, and
  payable Canada/Mexico border duties, remain. A zero metal amount cannot trigger
  the existing border rule requiring a positive metal duty.
- The original Section 122 action and exact Note 2(aa)(v)(a)–(d) name the zero-duty
  headings in the declared-content exception. First-day February 24 treatment
  pins the existing independent amendment, preserving the entry-date commodity
  rate. Missing, zero or contradictory content evidence withholds content-based
  totals; the whole-article original exception does not need guessed quantities.

Published reciprocal clauses use exact contracts for both steel and aluminum;
changed words or heading sets do not gain support. Old v1–v13 results remain
readable. New snapshots use audit v14 and earlier-metal compiler v5. These are
Cante-validated source estimates, not human legal approval or refund entitlement.

## Integration and fixes

`app/api/tariff/references/metal-history.ts` reuses the current deterministic
resolver and charged-portion arithmetic. Qualified zero-duty content has separate
proof from payable portions. `store.ts` passes the existing first-day Section 122
amendment to it. The existing engine retains explicit exemption metadata and
dated findings for a declared U.S.-metal heading rejected by the evidence.

A real mixed-metal source case exceeded the definition's twenty-reference
coverage limit after adding the original-law proofs. Coverage now cites the
exact schedule and scope note; each duty and stacking measure retains its own
operative proof references. All used original sources and hashes remain in the
snapshot. Nothing is silently truncated and no reference limit was raised.
Legal-source PDF readers now release in `finally`, including bounded failures.

The first source run also exposed an invalid fictional statistical suffix
8431.31.0000. Positive cases now use a published suffix confirmed against the
original edition; the invalid code remains a separate negative fixture. A mixed
steel/aluminum HTS requires separate material facts even if only one material
was originally contemplated by the fictional fixture.

## Verification

- The revised edition scan covers 31 retained editions intersecting April 5,
  2025–April 5, 2026. Thirty contain the expected reciprocal contracts; the early
  April 4–8 edition lacks the new note. The original April law is retained, but
  original-table support for that interval remains unfinished. The initial scan
  accidentally excluded this intersecting interval based on its start date;
  that verification condition has been corrected. No complete 31-edition
  calculation coverage is claimed.
- Twenty-three actual-source cases match independent hand arithmetic on fictional
  entries: eighteen calculate, five deliberately withhold totals for missing or
  conflicting qualification/value evidence or an unpublished statistical suffix.
  Cases include the original/later reciprocal treatment, India, China, Canada,
  Mexico, UK, EU, mixed copper/aluminum and first-day Section 122 treatment.
- 145 focused tests and all 931 existing regression tests pass. TypeScript and
  isolated production website/worker builds pass. The worker is 3,811,138 bytes,
  324 inputs, with no website/provider/delivery code. Its mocked 120-line parser,
  tenant, signature, resume and integrity checks pass separately.
- The first real isolated run uploaded, mapped, saved, calculated the original
  version, exported and denied the other tenant. Its reviewed run interrupted
  after eighteen lines; the saved checkpoint is 535,510 bytes, below the existing
  twelve-MB bound. No completed reviewed calculation is claimed. Test identities
  were cleaned up. The worker now records bounded server diagnostics with a
  stage and error; it never logs dispatch credentials or the request payload.
  A second run also interrupted at the checkpoint stage with an empty database
  error code. A direct, tenant/revision/lease-scoped 590,450-byte checkpoint write
  on the failed fictional fixture succeeded. No size limit was raised. This
  narrows the failure to the save path but does not establish its root cause.
  Server diagnostics now include the bounded transport status/message when it
  recurs. No authentication or permissions were changed and no blind automatic
  retry was introduced.
- The third real run passed upload/map/idempotency, all 23 evidence decisions,
  recalculation, verified prior results, original-file hash, exports and tenant
  denials. Eighteen calculated and five deliberately remained unresolved; gross
  fictional estimates were USD 1,255 overpayment and USD 740 underpayment.
  No model calls, shared approvals or schedules were created. The earlier two
  interruptions remain recorded; this successful run does not prove their cause
  is fixed or establish production readiness.
- Browser correction changed one fictional steel value from USD 800 to USD 600.
  Expected duty changed USD 20→40 on the evidenced USD 400 non-steel remainder;
  gross overpayment became USD 1,235. The browser showed the saved result and
  exemption citations. Protected database checks verified revision 24, prior
  verified revision 23, the original USD 800 declaration and old USD 20 result.
  The 23-line downloaded CSV retained the original, correction, new result,
  exemption and blank unresolved totals. Screenshot:
  `/tmp/cante-us-metal-audit-results.png`; export:
  `/Users/a/Downloads/historical-audit (15).csv` (fictional local artifacts).
- Acceptance used isolated website build `cante-history-build-0ypzcn`; the
  final worker adds only bounded failure diagnostics to the same calculation
  code (3,811,605 bytes, 324 inputs). Its mocked checks also pass. Browser
  recalculation used this actual worker. No deployment or daily target changed.
- Browser logout visibly completed; harness cleanup exited successfully. Its
  redundant revocation warning followed browser logout. Independent live SQL
  confirms 44 banned fictional audit accounts with zero sessions, including the
  final browser account. Owned preview ports 3132/3133 are closed; main port
  3000 processes remain running.

Three public originals are retained without customer writes or approvals:

| Document | Source ID | Original SHA-256 |
|---|---|---|
| 2025-06063 | 73e2dc0e-39f4-4eba-92bd-6996e857a5d8 | 3a4df0606c889ae072c030c8ca698adb1d373506d2e53881546874efad9fa2ca |
| 2025-10524 | c3613aa2-3e36-4c77-a8b8-7aacde2276ed | 839fc207f44529d6ecfe7a1a0a47211788cb931c0121a4716d4cc5cded819625 |
| 2025-15819 | 0106ed52-3d76-4d20-a4c2-4c7c20383cc9 | 9ddc785f72d2c89842a8acf2fb8b92bdad1029395ef80dc5ad609e47c33a683c |

## Remaining scope

Local receipts: `/tmp/cante-us-metal-source-confirmation.log`,
`/tmp/cante-us-metal-scope-confirmation.log`,
`/tmp/cante-us-metal-all-focused.log`, `/tmp/cante-us-metal-regression.log`,
`/tmp/cante-us-metal-live-acceptance-transport.log`,
`/tmp/cante-us-metal-browser-proof.log`,
`/tmp/cante-us-metal-cleanup-verification.log`. Earlier failures remain in
`/tmp/cante-us-metal-live-acceptance.log` and
`/tmp/cante-us-metal-live-acceptance-diagnostic.log`; direct save evidence is
`/tmp/cante-us-metal-checkpoint-transport.log`.

The [full ledger](../plans/historical-coverage-completion.md) stays open. The
intermittent checkpoint failure still needs a diagnosed recovery fix. Early
publication/amendment gaps, conditional metal and copper exceptions, other
Section 232 sectors, preferences/Column 2, broader AD/CVD/assessments and special
entry/transit treatment remain. A present-day FAQ or ruling about other goods is
not substituted for their dated law and shipment qualifications.

A read-only investigation of the early April original table found exactly 1,039
legal HTS entries matching the later April 9 note. Its raw extraction also includes
four footer tokens (2014, 2025, 4705, 4790) that must never become tariff headings.
Original clause hash `91abe211163114f8db24272eaf7152d705c232a42c49ae017a7656975c797724`
and set comparison are recorded in `/tmp/cante-us-initial-table.log`. A dedicated
strict original-clause compiler has not been implemented. The later edition is
comparison evidence, not a retroactive substitute for the original law/table.
