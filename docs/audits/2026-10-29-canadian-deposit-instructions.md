# Canadian deposit instructions

October 29, 2026. Engine v33. Selected local acceptance complete; no deployment. No full historical coverage or deployed release is claimed.

## Sources and scope

The existing public CBP capture path retained the complete bounded case indexes
and all their public cash-deposit header/body pairs:

| Case | Index messages | Deposit messages | Retained records |
| --- | ---: | ---: | ---: |
| A-122-857 | 80 | 15 | 31 |
| C-122-858 | 95 | 19 | 39 |

All 70 records passed read-back byte-count and stored/original hash verification.
These are public-law evidence, not human approval or customer data. Other message
types remain visible review work; a complete index does not establish complete
instruction interpretation or case scope.

AD index ID `ee04b8f5-16b0-42f3-a8fa-75dda9643c61`, SHA256
`4f263728b64fdc2c1358ed867773737613515c75cde53f8e9e75bb1019189560`.
CVD index ID `2268c9e9-c423-44a8-bae4-62cccef3c2f2`, SHA256
`76e257df9edb695824d2aa864a92648a0bb0f817e42a0792ce5648b8935f9bdf`.
Read-only public endpoints:
[AD index](https://trade.cbp.dhs.gov/ace/adcvd/service-messages/messages/public/quickSearchMessage-MemorySide/A122857),
[CVD index](https://trade.cbp.dhs.gov/ace/adcvd/service-messages/messages/public/quickSearchMessage-MemorySide/C122858).

## Changes

`app/api/tariff/references/adcvd-history.ts` parses complete named-company tables,
wrapped names and explicit producer/exporter pairs. A paired instruction needs
the supplied exact manufacturer and exporter, including published excluded-party
conditions. Unknown manufacturers, mismatches and incomplete rows withhold amounts.
No all-others or unnamed producer fallback is inferred.

The parser permits up to 500 table rows within the unchanged 500,000-character
body bound; actual selected tables contain 217–273 rows. No source byte, execution,
admission or database quota was increased.

A same-effective-date amendment replaces a matching original only when its
explicit Ref message/date matches that retained original and its later
publication and amendment wording establish the relationship. Both originals
remain cited. Unproved supersession and multiple matching instructions remain
unresolved. Correction messages with unsupported interpretation are not silently
discarded. Originally declared inputs, review decisions and previous results
remain immutable.

## Verification so far

279 historical tests, TypeScript, isolated webpack website/worker builds,
protected-worker checkpoint recovery and scheduler-idle checks pass.

The read-only actual-source 100-entry oracle passes all amounts and CSV fields:
81 fictional reviewed entries calculate; 19 controls intentionally remain open.
Potential over/underpayment fixtures each total USD 27.00. The run pins 141 sources
and uses 324,272 PDF-cache bytes. It also verifies that a fictional missing-exporter
correction can calculate while the original blank remains.

For example, the fictional Sept 15, 2025 entry value USD 1,000.50 produces
USD 354.88 AD deposit, USD 121.26 CVD deposit and USD 350.18 Canada border duty,
total USD 826.32. This uses the amended AD instruction's July 29 operative date
and the CVD instruction's August 12 operative date, independently of capture or
release dates. It is a cash-deposit comparison, not a final assessment or refund
entitlement. Fictional evidence decisions do not prove actual company qualification.

Real saved old32/new33 worker, browser correction/export and tenant isolation
acceptance pass. The same 141 pinned sources and fact decisions keep old null
results intact; v33 calculates three explicitly reviewed lines. Browser line85
adds its missing exporter and renews party/instruction/complete-case facts,
yielding USD827.01 expected (355.18 AD +121.36 CVD +350.47 border), against828.01
paid. Its original blank exporter remains. Final four calculated/96 deliberately
unreviewed lines and USD2over/1under are distinct from the81-reviewed oracle.

All100 browser-export amounts, four protected result snapshots at DB revisions
0/4/5/6 (engines32/32/33/33), original declarations and15 earlier saved result
sets verify. Foreign API, direct/RPC and export access denials pass.
Browser signed out; independent cleanup confirms100 banned fixtures, zero active
and zero sessions, including after the already-revoked-token warning. Owned tab50
and3132/3133 close; existing PID24938/3000 remains. No schema/grant/quota/schedule/
reviewer/deployment change. WorkerSHA256:
`721f9b76ab2026e57fc72e3147eabf73426cd72bc6eb2337f6d2c6fbbd76f1af`.
Local logs/proofs are under `/tmp/cante-v33-*`.

The initial isolated Turbopack build failed on its external dependency symlink.
The subsequent isolated `--webpack` build passed, matching earlier local
acceptance. No live development server was interrupted.

## Remaining coverage

24 of 34 retained deposit messages parse under the current grammar. Unparsed:
0189410, 3220409, 0189411, 0336411, 2019402, 2032411, 3216402, 4018402, 5121401,
6238403. The engine blocks when an applicable chain needs one of these; it never
uses a convenient earlier rate. Earlier missing originals, exclusion/court
interpretation, producer-only fallback, final assessment, all other AD/CVD orders
and broader legal completeness remain open.

This verification's ordinary wood entry precedes the October 14, 2025 timber
Section 232 start. Later wood duties, country arrangements and overlaps require
their own dated support; this work does not claim them. Original-law next leads:
[Proclamation 10976](https://www.federalregister.gov/documents/2025/10/06/2025-19482/adjusting-imports-of-timber-lumber-and-their-derivative-products-into-the-united-states),
[Annex](https://www.whitehouse.gov/wp-content/uploads/2025/09/timber-.pdf),
[CBP guidance](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/3f69699).
No new timber source capture or calculation support is claimed here.

A separate inspection lead remains: the2025Rev22 reference displays Column2
`$1.70/m` for4407110001, while a current official search shows a cubic unit.
Verify the dated PDF before changing it. The tested Canadian base is Free;
this observation does not alter the verified AD/CVD/border amounts.
