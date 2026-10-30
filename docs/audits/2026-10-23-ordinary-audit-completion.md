# Ordinary historical audit completion — October 23, 2026

## What changed

Earlier annual-data work retained rates but could only show base-duty scenarios.
The new `historical-ordinary-mfn-v1` compiler connects annual USITC rates, the
publisher's computation-code key and dated General Note 3 country treatment to
actual expected-duty comparisons and exports. General Notes originals are now
retained for every year 2000–2017; they are not human approvals.

A confirmed upload can create minimal, inactive catalogue associations for new
SKUs. This removes the prerequisite to populate the catalogue separately. Existing
products are preserved; historical declarations never populate current origin,
classification, customs value or monitoring inputs. The mapping screen discloses
this default and lets the importer disable it. Duplicate audit uploads reuse their
immutable snapshot. Engine version v5 still reads earlier v1–v4 results.

## Calculation boundary

The ordinary compiler supports published methods 0 (free) and 7 (ad valorem),
chapters 1–97, unambiguous dated annual rows, and these declared origins where the
year's country notes establish Column 1 eligibility: CN, VN, JP, TW, KR, DE, FR,
IT, GB, TH, MY, IN, ID, SG, AU and NZ. Ineligible countries are excluded per year;
Vietnam is not silently given Column 1 treatment in the 2000 notes.

These methods are uniform at the eight-digit legal tariff line. The importer’s
classification and legal origin are assumptions, not independent determinations
of a ten-digit suffix or substantial transformation. Method T, quantity/compound
methods, footnotes, affirmative/unknown cumulative-duty indicators, Chapter 99
claims, preferences, exclusions, unsupported origins and special-duty scopes do
not acquire coverage through this compiler. The explicit `No` indicator in the
2004 archive is treated as negative; unfamiliar indicators still block it.

The importer must explicitly declare ordinary consumption and the supported
additional-duty scope. Missing or contradictory facts withhold totals. Annual
intervals intersect the captured year and use inclusive source end dates; a
source row ending in 2050 does not extend a 2000 source into later years. No
current rates, model calls or fictional human approvals are substituted.

Existing dated ordinary Section 301 estimates remain separate, reuse the same
audit engine, and retain their declared-scope assumptions. Comprehensive
2025–2026 duties, metal-content measures, exclusions, preferences and AD/CVD are
not completed by this release. This is a functioning, bounded pilot, not a claim
that every possible historical ledger can be fully recalculated.

## Verification

- TypeScript passes; 51 focused tests and the 931-test main suite pass.
- The actual worker bundle passes signed-dispatch, tenant, proof and checkpoint
  tests against isolated REST fixtures. These are not live-database tests.
- A read-only 120-line fictional ledger spanning every year 2000–2014 matches its
  independent expected-results fixture against retained official originals:
  90 calculated, 30 deliberately blocked by missing HTS or conflicting origin
  evidence, 60 differences, $7,500 potential overpayment and $600 underpayment.
  This benchmark uses one motor tariff line, not every annual record.
- The existing 120-line real-source Section 301 regression also passes: 100
  calculated, 20 review cases, 70 differences, $2,900/$2,700 fictional exposure.
- An isolated production website build and actual trusted-worker bundle ran both
  ledgers through real Supabase Auth, upload, mapping, new-product association,
  duplicate-upload reuse, execution, immutable result proof, original download
  and CSV export. Every amount matched. A second isolated account received 404
  for foreign audit/export and could read no foreign result rows through RLS.
  The new products remained inactive with no invented current facts.
- Browser acceptance uploaded and validated the old ledger, reused its existing
  result, filtered findings and downloaded its CSV. A fresh five-entry browser
  upload ran through the worker and displayed correct/no-difference, overpaid,
  underpaid, conflicting-origin and unsupported-date results. A dated fictional
  origin decision was recorded and recalculated: original CN preserved, applied
  VN, expected $40 against $300 paid, $260 potential difference. An additional
  browser-recorded confirmation created another retained revision. All three
  protected calculation versions were read back: the first still has the origin
  conflict and null expected duty, while the current report preserves CN declared,
  VN used, expected $40 and difference $260. The browser-downloaded revised CSV
  independently matched those values.

All entries, production evidence and review decisions in these checks were
explicitly fictional; government originals were real. No customer workspace was
used, no model was called and no global legal rule was approved. Synthetic test
identities are revoked and banned after acceptance; append-only fixture audit
history is retained. A test-only server timeout interrupted one browser attempt;
the isolated environment was resumed. Browser date-input automation needed actual
date keystrokes; an empty date was correctly refused. Neither was counted as a
successful correction until saved and recalculated.

## Release

- Website Preview: https://cante-fnk6p700p-jeremygautamas-projects.vercel.app
- Worker Preview: https://cante-check-worker-xk1may2zx-jeremygautamas-projects.vercel.app
- Both Vercel builds report READY. Preview and local future worker connectors
  point to the new worker. Existing daily-monitor Vault configuration is unchanged.
- Vercel SSO blocks browser access to this exact hosted website build. Local
  production-build acceptance is not described as hosted acceptance.
- Production is not promoted; the existing development server was not restarted.

## Reproduce

```sh
npm run test:free-official
npm run test:historical-coverage
npm run verify:ordinary-pilot
npm run verify:audit-references
npm run build:check-worker
npm run test:audit-worker
# Explicit operator action: creates isolated synthetic workspaces and retained audits.
npm run verify:audit-pilot-workflow -- --live /absolute/isolated/production-build
# Operator-only official-source writes; not customer imports or approvals:
npm run references:backfill-ordinary -- --write --years=2009,2016,2017
```

The live workflow verifier requires free local ports 3132 and 3133 and real
operator credentials in the verification process. The website child receives no
service credential; only the separate trusted worker does. Private logs, sessions
and reports remain outside Git.
