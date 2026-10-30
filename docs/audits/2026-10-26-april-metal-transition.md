# April–June 2026 metal transition

October 26, 2026. Local audit engine v10 continuation. This extends the existing
engine; the full historical-coverage goal remains IN PROGRESS. Nothing was
deployed, no daily target changed, and no legal rules were human-approved.

## Implemented scope

`app/api/tariff/references/metal-history.ts` now recognizes the April 6–June 7
regime separately from March 2025–early April 2026 and June 8 onward. Exact known
operative paragraphs and ten complete code lists must validate. Changed prose,
malformed lists, missing headings or missing original guidance withhold support.
An editorial compiler note appearing before a list's colon is removed before
locating the table delimiter; it cannot become part of the tariff-code table.

Supported ordinary declared-fact branches include full customs-value metal
duties, the dated qualified UK rate, cumulative 95% U.S.-metal qualifications,
10%/15% combined base-plus-metal treatment, weight thresholds and the motorcycle
manufacturing exception. June equipment and 85% U.S.-metal rules cannot be
applied to these earlier entries. Other programs remain independent unless their
original overlap exception is proved. In particular, subthreshold/no-metal and
motorcycle exceptions retain Section 122 where applicable; independent China
Section 301 remains separate from metal treatment.

The first two days pin the first consolidation (2026HTSRev5) as the metal
amendment, with the original April 6 00:01 Eastern entry cutoff. Commodity rates
remain from the entry-date 2026HTSRev4 schedule. This exception is bounded to
April 6–7 and does not admit a later full schedule as a historical base rate.
Compiled calculation intervals also intersect the metal source's scope.

The retroactive no-metal correction is proved from retained CBP guidance. Zero
applicable-metal weight does not establish that the goods contain no aluminum,
steel or copper: a separate explicit `no_metal_content` evidence decision is
required for 9903.82.01. Goods with another, unlisted metal can instead receive
the applicable-metal subthreshold treatment. Conflicting positive-weight and
no-metal facts withhold a calculation.

The existing finding form shows the dated 95% requirement and hides the later
equipment-use control for April entries. Original declarations and prior runs
remain immutable. v1–v9 results remain readable; new results are v10.

## Sources and implementation

Primary sources inspected include the [April proclamation](https://www.whitehouse.gov/presidential-actions/2026/04/strengthening-actions-taken-to-adjust-imports-of-aluminum-steel-and-copper-into-the-united-states/),
[CBP CSMS 68253075](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/4117593),
[the technical correction](https://www.federalregister.gov/documents/2026/04/29/2026-08297/notice-of-technical-corrections-to-the-harmonized-tariff-schedule-of-the-united-states-for-duties),
and [CBP CSMS 68554727](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/4160fe7).
The two CBP originals were already retained; no customer data or source approvals
were created by source verification.

Retained Chapter 99 originals exercised:

| Edition | Source ID |
| --- | --- |
| 2026HTSRev4 | `e6c23257-9864-4af8-ac96-81d8a53def20` |
| 2026HTSRev5 | `73cd2f74-94c7-4296-bfac-acc396f79283` |
| 2026HTSRev6 | `af48beb2-671f-4e48-9787-6db4daea9bd0` |
| 2026HTSRev7 | `b27d0650-f4b7-4bde-ac54-bf3af09cdf1c` |
| 2026HTSRev8 | `ef38f36a-fc04-45b8-a792-ce5beaf234c4` |
| 2026HTSRev9 | `650b3939-19a7-4852-8ebc-2806d4e019ae` |

Existing files reused: `metal-history.ts`, `cbp-guidance.ts`, `store.ts`,
`app/api/audits/compiled-reference.ts`, `model.ts`, the audit workspace and the
existing worker/acceptance harness. No new runtime module, service, dependency,
migration, grant, RLS policy, reviewer authority or schedule was introduced.

## Verification

- `verify-historical-metals-april2026.ts`: sixteen selected actual-source
  calculations across six publication windows, including the first day. No
  source-verification writes, model calls or legal approvals. The fictional
  nails case calculates USD 750 for ordinary China treatment, USD 350 with
  evidenced U.S.-metal qualification, USD 500 for Vietnam/Canada and USD 250 for
  qualified UK goods, each on USD 1,000 customs value. Combined and threshold
  cases are separate assertions.
- 97 focused tests pass, including malformed/changed sources, different dated
  thresholds, compound equivalents, cutoff boundaries, no-metal evidence,
  first-day source separation and existing import/revision/reference behavior.
- The existing regression passes 931 tests. TypeScript, website and trusted
  worker builds pass. Worker bundle: 3,791,562 bytes, 324 inputs; no website,
  provider or delivery code. Mocked worker test passes separately from live tests.
- Actual isolated Auth/database/worker acceptance passes sixteen fictional
  entries: upload, mapping, idempotency, original download hash, sixteen evidence
  decisions, recalculation, retained prior run and CSV. All sixteen initially
  require evidence; after decisions all calculate, with USD 600 potential
  overpayment and USD 250 potential underpayment, kept separate. Cross-company
  detail/export requests return 404 and direct result RLS reads return no rows.
  Associated inactive products contain no invented current tariff facts.
- Browser evidence correction and downloaded CSV pass. The May 15 fictional
  line's revised 86% U.S.-steel evidence fails the dated 95% qualification; duty
  changes from USD 350 to USD 750. Display revision 18 shows USD 600 overpayment
  and USD 650 underpayment. Export retains the declaration, both qualification
  decisions, current facts and source components; direct retained results verify
  display revisions 17 and 18 still contain USD 350 and USD 750 respectively.
- The first browser write on `127.0.0.1` was rejected by the existing same-origin
  protection. Verification used the server's configured `localhost` origin; no
  protection was weakened. The initial temporary session expired and cleaned up;
  only its explicitly fictional workspace was restored for browser completion.
  Both browser host sessions report signed out and the tab is closed. The
  redundant operator global-signout call returned an error after browser logout;
  a live aggregate query confirms zero sessions for banned audit fixtures. Test
  servers are stopped and the port-3000 development server remains running.

Private local acceptance artifacts: `/tmp/cante-transition-live-acceptance.log`
and the `cante-audit-pilot-7MyNeF` temporary directory. The tested isolated website
build is `cante-history-build-a9jd93`; the existing port-3000 server is untouched.
No credentials or raw customer records are included in this document.

## Limits and remaining work

These checks use genuine government originals and explicitly fictional shipment
facts. They do not constitute independent broker/legal or financial validation.
An initially used 8431310000 fixture suffix was found absent from the printed
schedule; it was corrected to published 8431310060, not admitted as a fallback.

The broad [completion ledger](../plans/historical-coverage-completion.md) remains
open. Examples still needing implementation/validation include positive Russian
aluminum in the newer regime, metal quotas/authorization, mobile equipment and
other 232 sectors, earlier metal/India/Section 122 allocations, first-day 2025
inclusion amendments, preferences and dated Column 2, broader AD/CVD/final
assessments, temporary reductions, exclusions and special-entry/transit cases.
