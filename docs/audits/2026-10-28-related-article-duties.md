# Complete-article rate references — October 28, 2026

Audit v30 locally supports selected accessory duties that expressly use the
complete article's rate. This is an extension of existing deterministic annual
calculations, not a new service or legal approval. Code is not deployed.

## Implemented and bounded

The retained 2017 Chapters90/96 originals and annual records establish the
instructions for 90159001,96200015 and96200030. The documented complete article
must be in heading9015,9005 or9015 respectively, not another parts/accessories
line. Exact original published parent codes and complete percentage/Free rates
must agree across retained applicable originals. The declared accessory code
is preserved. The parent's percentage applies to the accessory customs value;
its whole article value is never substituted. MFN and Column2 remain separate.

`shipment.ts` adds one optional CSV/review field, `relatedArticleHts`, and its
aliases. `model.ts` adds the explicit dated `related_article_verified` fact;
a correction to the related code requires this fact. Imported codes alone do not
confirm relationships. A later accessory reclassification invalidates an older
relationship confirmation unless the new decision explicitly re-establishes it.

`annual-data.ts` proves the original child instruction and exact original parent
rate. `store.ts` pins the additional chapter and performs one bounded parent
lookup, clearing the parent's related-code input. Recursion, source/version
conflicts, unknown exact codes and missing/conditional originals fail closed.
Existing source-byte/page/cache/admission bounds remain; no quota was changed.

`compiled-reference.ts` reuses the ordinary compiler, intersects child/parent/
country intervals, combines retained sources and requires the reviewed relationship.
`engine.ts` preserves the entry and exposes the separate related-code fact and
calculation explanation. `audit-workspace.tsx` shows the relationship with the
existing review fields and findings; no new tab or detached workflow is added.
CSV export retains raw input, review evidence, both codes, original rates and
source proof through the existing report path. Version30 retains readable v29.

Quantity/compound parent rates, juice procedures, preference claims and special
entry treatment are not inferred by this percentage contract. The specific
source verification is2017; this does not prove complete2000–2017 applicability.
All original classification/origin and lawful entry scope remain reviewed or
declared facts, not conclusions extracted from supplier location or an HTS match.

## Verification

- Six new tests cover all three source families, separate tariff columns,
  zero rates, missing/expired/false evidence, self/wrong-heading/code/column
  references, unretained sources, original conflicts/notes and reclassification
  invalidation. 121 historical tests,938 library regressions and TypeScript pass.
- The100-line CSV/expected fixture uses an independent Python Decimal half-up
  oracle. Read-only actual-source checks pass: initial100 unresolved; fictional
  evidence decisions yield84 calculated/16 intentionally open,49 discrepancies,
  USD28.00 over/21.00 under. Eighteen pinned sources; no writes/models/approvals.
- Final bundled-worker security/checkpoint/transport recovery passes. Isolated
  production website build passes. The first build omitted the existing config
  directory from its temporary copy; copying it and the final engine fixed that
  setup error. Main dev server was untouched.
- Real isolated Auth/database/worker/site acceptance uploads/maps/saves100 lines,
  verifies idempotency and original bytes, and checks foreign-tenant API/RPC/direct
  row/export denial. Three fictional relationships are reviewed and recalculated:
  three calculated,97 open,USD1.00 each over/under. Earlier100-null output is retained.
- Browser review supplies the missing parent code for fictional line85:
  original accessory9620001500 remains, original related code stays blank,
  reviewed parent9005100040 uses its Column2 rate60% on USD1001.34. Expected600.80,
  paid601.80,difference1.00. Final four calculated/96 open,USD2.00 over/1.00 under.
  Only four relationships were reviewed in this real workflow; the separate
  read-only oracle exercises84. Do not conflate these verification scopes.
- Downloaded CSV verifies all100 expected/difference amounts, raw blank field,
  unchanged accessory code, reviewed parent, separate MFN/Column2 and citations.
  Three protected outputs at revisions0/3/4 verify every row and ordered output
  hash; twelve earlier saved-result sets still verify. No actual old-v29 worker
  upgrade is claimed for a new mapping containing a field unknown to v29.
- Browser signout precedes the cleanup token HTTP400 warning. Independent SQL
  confirms94 banned fixture identities,zero active and zero sessions. Owned tab47
  and ports3132/3133 close. Main PID24938/3000 remains. No customer records were
  used as fixtures; the retained audit records are explicitly fictional.

Final worker SHA256:
`56d0f4b581f4ba7016c177068c92a69d7d830e3d5133411898b8214d6b36b039`.
Actual v29 retained at `output/watch-v29-worker/api/check.mjs`, SHA256
`5759c7eb191784ba744b651020ebaf5bc22ee515ea03aead8f273f5d490d4b0d`.
Final isolated site:
`/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-related-build-3lrx2pag`.
Private fixture credentials, downloaded reports and database proofs stay outside
tracked documentation. No source import, shared approval, schema, grant, secret,
schedule, quota, push or deployment changed.

## Still open

This conditionally supports three of the seven previously identified derived
annual records when the required article evidence is supplied. It does not turn
those missing raw fields into numeric rates or claim a fresh full source rescan.
Four juice records still require the natural-juice classification and quantitative
procedure; milk9904, undated wood and85299054 edition mismatch also remain.

Improve the unsupported-scope finding for an accessory with a preference or
special entry: the current result correctly withholds a number but can point to
its related article even when the separate entry/program procedure is the blocker.
Continue all broader country/preference/metals/other232/AD-CVD/cutoff work in the
[completion ledger](../plans/historical-coverage-completion.md); no broad box closes.
