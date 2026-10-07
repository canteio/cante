# Tariff audit — 2026-10-06 (reconciled 2026-10-07)

## Integration status

Resolved. The findings below were integrated by the concurrent editor's
commits `f1c03b6`, `1527ba4`, `bb32944`, and `b9818d8` between this audit's
original drafting and this reconciliation pass. Verified directly against
current HEAD (`b9818d8`), not assumed from commit messages:

- `lib/tariff/section301.ts`'s 6404.11 supplemental table matches the
  audit's Annex A/Annex C split exactly (`.20/.71/.79/.81/.89/.90` → active
  List 4A 9903.88.15; the Annex C suffixes are absent, so they correctly
  fall through to unresolved rather than a six-digit guess).
- `8518.22.00` is present as an explicit List 4A entry at 7.5%, matching
  the audit.
- `9903.88.04` is now modeled as an active List 3 companion heading (not
  merged with the suspended 4B heading `9903.88.16`, which remains
  `status: "suspended"`, `ratePercent: null`), matching the audit's finding
  that `.04` ≠ List 4B.
- `lib/tariff/section338.ts` was rebuilt from `section338-annexes.json`
  (554 lines extracted from the three Annex II PDFs) instead of the
  hand-picked broad-prefix table this audit flagged. The Sept 15, 2026
  heading-renumbering claim this audit disputed is gone from the module.
  The two alcohol lines the Sept 15 amendment pulled from broad coverage
  (`2208.30.60.xx`, `2208.70.00.xx`) are withheld as unresolved on/after
  that date, matching the audit's recommendation — not a stale full match.
  The alcohol/Section-232 stacking question this audit raised now routes
  to an explicit unresolved component (`isAlcoholSection232StackUnresolved`
  in `stack.ts`) instead of a silent exclusion.
- The ten AD/CVD advisory entries and their regression tests from this
  audit's independent-changes list are in `lib/tariff/adcvd.ts` /
  `adcvd.test.ts` at current HEAD.

This reconciliation's own contribution: committing `section301-live.test.ts`
(previously drafted but uncommitted — see Validation) and correcting this
document's stale "integration paused" / "network unreachable" claims, which
no longer hold under the current sandbox's network access.

## Section 301 findings (original, now integrated — see above)

Primary membership source: [USTR original List 4A and List 4B notice, 84 FR 43304](https://ustr.gov/sites/default/files/enforcement/301Investigations/Notice_of_Modification_(List_4A_and_List_4B).pdf).

- 6404.11 is **mixed**, not one rate. Annex A (active List 4A, 9903.88.15): 6404.11.20, .71, .79, .81, .89, .90. Annex C (suspended List 4B): 6404.11.41, .49, .51, .59, .61, .69, .75, .85. Six-digit fallback is unsafe.
- 8518.22.00 is explicitly in Annex A: List 4A, current 7.5%.
- 8517.13 smartphones succeed 8517.12.00, which is in Annex C, suspended List 4B. No active 301 component established. [USITC nomenclature discussion, footnote 21](https://www.usitc.gov/sites/default/files/publications/332/working_papers/national_automotive_competitiveness.pdf).
- Suspended List 4B is **9903.88.16**, not .04. [84 FR 69447](https://www.govinfo.gov/content/pkg/FR-2019-12-18/html/2019-27306.htm).
- .04 is an active List 3 heading: [CBP implementation notice](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/24418dd).
- Original 84 FR 43304 announced 10%; 84 FR 45821 raised the initial collection rate to 15%; 85 FR 3741 reduced it to 7.5%.

Live tests in `section301-live.test.ts` call the actual USITC endpoint
through `lookupTariff`; they are committed as a real regression guard
(see Validation — they pass against the live network from this sandbox,
asserting the 6404.11 / 8518.22 / 8517.13 facts above against whatever the
USITC schedule returns *today*, not a fixture). A future endpoint outage
or schedule change will fail this test rather than silently pass.

## Section 338 annex sources

Extracted into section338-annexes.json:
- Alcohol, 63 original eight-digit lines, 9903.03.12: https://public-inspection.federalregister.gov/2026-14991.pdf (Annex II).
- Dairy, 52 eight-digit lines, 9903.03.13: https://public-inspection.federalregister.gov/2026-14992.pdf (Annex II).
- Motor-vehicle discrimination basket, 439 eight-digit lines, 9903.03.14: https://public-inspection.federalregister.gov/2026-14997.pdf (Annex II).
- Effective August 22 correction: https://www.govinfo.gov/content/pkg/FR-2026-08-24/html/2026-17294.htm.
- September amendment: https://public-inspection.federalregister.gov/2026-18838.pdf, effective September 15.

September amendment adds 40 listed classifications to the alcohol basket (including six retained ten-digit alcohol lines), removes broad 2208.30.60 and 2208.70.00 coverage, and **does not renumber the headings**. It also permits alcohol-proclamation duties to stack with Section 232. Dairy/motor exclusions remain. A blanket 232/338 exclusion is therefore stale after September 15. Any overlapping case not fully implemented must be explicitly unresolved. Section 232 nonmatching is not affirmative proof of exemption eligibility because the existing 232 catalogue is incomplete. The amendment's own 40 additions ("septemberAlcoholAdditions" in the JSON) remain deliberately unwired — basket/line assignment for those is still not confirmed to primary-source confidence, so an HTS code only found there still resolves to unresolved (null), never a guess.

## AD/CVD additions

These are dated benchmarks, never current exporter-specific quotes or computed amounts. Each added entry has only its AD case; separate CVD rates are not combined.

| Case | Product / origin | Cited benchmark (%) | Rate and order-status evidence |
|---|---|---:|---|
| A-570-909 | Certain Steel Nails / CN | 118.04 | 90 FR 25220 (June 16, 2025): https://www.govinfo.gov/content/pkg/FR-2025-06-16/html/2025-10947.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-05-01/html/2025-07582.htm |
| A-570-932 | Steel Threaded Rod / CN | 206 | 85 FR 26668 (May 5, 2020): https://www.govinfo.gov/content/pkg/FR-2020-05-05/pdf/FR-2020-05-05.pdf; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-07-22/pdf/FR-2025-07-22.pdf |
| A-570-967 | Aluminum Extrusions / CN | 86.01 | 90 FR 33368 (July 17, 2025): https://www.govinfo.gov/content/pkg/FR-2025-07-17/html/2025-13389.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2022-11-02/pdf/FR-2022-11-02.pdf |
| A-570-890 | Wooden Bedroom Furniture / CN | 216.01 | 90 FR 44801 (September 17, 2025): https://www.govinfo.gov/content/pkg/FR-2025-09-17/pdf/FR-2025-09-17.pdf; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-08-12/pdf/2026-16448.pdf |
| A-570-084 | Certain Quartz Surface Products / CN | 326.15 | 86 FR 43520 (August 9, 2021): https://www.govinfo.gov/content/pkg/FR-2021-08-09/html/2021-16911.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-01-30/html/2025-01946.htm |
| A-570-092 | Mattresses / CN | 1731.75 | 84 FR 68395 (December 16, 2019): https://www.govinfo.gov/content/pkg/FR-2019-12-16/html/2019-27166.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2025-05-28/pdf/2025-09559.pdf |
| A-557-818 | Mattresses / MY | 42.92 | 86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm |
| A-801-002 | Mattresses / RS | 112.11 | 86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm |
| A-489-841 | Mattresses / TR | 20.03 | 86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm |
| A-552-827 | Mattresses / VN | 668.38 | 86 FR 26460 (May 14, 2021): https://www.govinfo.gov/content/pkg/FR-2021-05-14/html/2021-10238.htm; subsequent order-status evidence: https://www.govinfo.gov/content/pkg/FR-2026-04-01/html/2026-06290.htm |

HTS prefixes are deliberately bounded leads, not exhaustive order coverage. Written scope, exclusions, producer/exporter-specific instructions and subsequent determinations must be checked before entry. The multi-country mattress rates are historical original-order benchmarks; 2026 sunset-review institution confirms orders then in place, not unchanged individual rates.

[Commerce AD/CVD proceedings dashboard](https://www.trade.gov/data-visualization/adcvd-proceedings) documents Excel export through its Export Data control. The former USITC orders.xls link redirects there. It is useful order-status metadata, not a documented current cash-deposit-rate API. No fragile UI scraper or invented API was added.

## Validation (2026-10-07 reconciliation pass)

- `npx tsc --noEmit`: clean, zero errors.
- `npm test -- --run`: run twice. First run: 770 passed / 1 failed / 771
  total, with `lib/catalogue/products.test.ts` failing on "JWT issued at
  future" (a Supabase test-harness clock/token timing issue, unrelated to
  this audit's tariff files). Second run, same `HEAD`, no code changes in
  between: 771/771 passing, zero failures — the failure did not
  reproduce. This is flaky (intermittent Supabase auth-token clock skew
  in the test harness), not a deterministic pre-existing failure; neither
  single run should be reported as "the" result. Re-run before relying on
  a pass/fail count from this suite.
- `section301-live.test.ts` (the three live-USITC-endpoint tests): all 3
  passed against the real network from this sandbox, reversing the
  original audit's "local DNS/network restrictions prevent successful
  live verification" note — that restriction does not apply to this
  sandbox's network path.
- Full clean validation of the tariff-stacking engine's committed state
  (Section 301, Section 338, AD/CVD) is now complete; this document is
  no longer a record of a paused/incomplete integration.
