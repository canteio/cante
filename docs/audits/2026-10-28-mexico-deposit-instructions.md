# Mexico deposit instructions and stacking — October 28, 2026

Audit v31 locally verifies selected named-company antidumping cash deposits with
existing steel and country-program calculations. This is bounded historical
support, not full AD/CVD coverage, human legal approval or a deployment.

## Original evidence and implementation

Twenty-one public CBP originals were retained: the complete A201844 public index
of59 messages and header/body pairs for its ten cash-deposit messages. Index
source `f252b6de-c01e-462b-86c7-326d9629f404`,original31266bytes,SHA256
`d06170598e061fa803c1fcf520ac8bbf7cb0415451593579b8449e8dcda05e7b`.
No tenant records or rule approvals were created by this source capture.

The named company001 instruction changes from1.16% effective2024-05-10, to32.05%
effective2025-09-04, then36.34% effective2026-02-20. These are the dates expressly
stated in the retained CBP messages, not capture dates or dates inferred from
publication availability. Originals:
[4136417](https://trade.cbp.dhs.gov/ace/adcvd/service-messages/messages/public/getMsgBody/89794),
[5251402](https://trade.cbp.dhs.gov/ace/adcvd/service-messages/messages/public/getMsgBody/92922),
[6058404](https://trade.cbp.dhs.gov/ace/adcvd/service-messages/messages/public/getMsgBody/93705).
Their applicability still requires the exact documented exporter, order scope,
complete cases, payment stage and instruction/court review.

`adcvd-history.ts` extends the existing parser to named producer/exporter groups,
capitalization variants and amended/final rate labels within a cash-deposit
message. It establishes origin from the original body/title and rejects
contradictory countries, wrong parties, conditional/per-unit expressions,
incomplete named rows and unsupported carry-forward. It does not select a
producer-only fallback or an all-others default. A complete named exporter
continuation can carry a prior rate; all intervening originals stay cited.
Different company instructions sharing a date can coexist. Conflicting rows
for the same company require explicit supersession.

`store.ts` preserves the public index accounting and loaded deposit count,
rejects ambiguous pinned index/header/body versions, and retains the existing
bounded latest-source selection. The other49 message types are visibly listed
for separate review, not represented as automatically interpreted. Liquidation,
injunction and other case instructions remain outside this numeric grammar.

`compiled-reference.ts` uses `historical-adcvd-deposits-v2`, includes case/message
identity and pins a deposit comparison to the entry day. The actual instruction
start date is retained separately in the component explanation; the next-day
coverage boundary is not a legal expiry. `engine.ts` invalidates prior party,
instruction and complete-case confirmations after changed party/case/payment
stage inputs unless explicitly renewed. This does not yet complete every
HTS/origin/order-scope invalidation; see remaining work below.

The complete plain China-origin note31 headings can now be excluded for other
reviewed origins. The entire heading wording, exact heading/subdivision and
calendar dates must match. Conditional crane/component/ownership provisions do
not qualify. No China rate or legal origin is inferred. This removes the false
9903.91.01 blocker for the tested Mexican goods and lets the existing engine
stack base, named deposits, steel and evidenced country-program exemptions.

Accessory preference/special-entry/additional-duty failures now name their actual
procedure instead of incorrectly blaming a proved complete article reference.
No new service, dependency, migration, grant, quota, reviewer permission, secret,
schedule or deployment was introduced.

## Verification and its limits

- 228 historical regressions, TypeScript, final isolated website/worker builds,
  worker signing/tenant/checkpoint/transport recovery and daily-idle checks pass.
  The daily-worker command initially used the wrong filename; the actual existing
  `test-daily-worker.mjs` passes. No real scheduled check was triggered.
- Public-source fixture tests cover both prior China examples and Mexico2024,
  2025 and2026 instructions, country mismatches, exact names, amended dates,
  missing qualifications, selective carry-forward, same-date company conflicts,
  complete chain citations, entry-day coverage and renewed party evidence.
- The independent Decimal half-up oracle covers100 fictional import entries:
  initially100 open; reviewed81 calculated/19 intentionally open,54 differences,
  USD27.00 over/27.00 under. Nine profiles test the before/after2025 and2026 deposit
  boundaries and named exporters. Complete supported totals include independent
  per-component rounding,50% steel and documented overlap exemptions. These are
  not actual customer savings, verified classification/origin or refund rights.
- Read-only actual-source verification matches all100 expected results and CSV
  fields, using101 pinned sources and no writes/models/approvals. The2024 deposit
  component is verified separately; complete pre2025 Mexican steel treatment is
  not claimed by these2025–2026 full-duty fixtures.
- Real isolated Auth/database/website/worker acceptance uses the actual preserved
  v30 worker:100 initial nulls, then another100-null result with four evidence
  decisions. A v31 refresh keeps exactly the same sources/facts and calculates
  three reviewed cases. Both older protected results remain unchanged. Upload,
  mapping, idempotency, original bytes and foreign-tenant API/RPC/direct-read/
  export denials pass. Saved catalogue rows remain inactive without fabricated
  origin, price or live tariff inputs.
- Browser review supplies line85's missing exact exporter and renews the three
  party/instruction/complete-case facts. Original blank exporter and declaration
  remain. On fictional customs value1001.34,deposit320.93 plus steel500.67 gives
  expected821.60 versus paid822.60. Legal deposit start2025-09-04 is distinct from
  entry coverage2025-10-01→2025-10-02. Exempted overlap components remain separate.
  This real fixture ends four calculated/96 unreviewed,USD2.00 over/1.00 under;
  it is separate from the81-reviewed read-only oracle.
- Downloaded CSV verifies all100 amounts, original blank input, dated review,
  separate deposit/steel, instruction accounting and source citations. Four
  protected outputs at revisions0/4/5/6 (v30/v30/v31/v31) verify all row/ordered
  hashes; thirteen older saved-result sets still verify.
- Browser signout precedes the cleanup token HTTP400 warning. Independent SQL
  confirms96 banned fixture identities,zero active and zero sessions. Owned tab48
  and ports3132/3133 close; mainPID24938/3000 remains. Customer records were not
  disposable fixtures. Private credentials/reports/proofs stay outside this doc.

Final worker SHA256:
`18ff8779cf5f019288ff8dc47d993d93c34f1b87c15e1fe08d53821cd7d341c2`.
Actual v30 is preserved at `output/watch-v30-worker/api/check.mjs`,SHA256
`56d0f4b581f4ba7016c177068c92a69d7d830e3d5133411898b8214d6b36b039`.
Final isolated website:
`/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-deposit-build-eib7pmsu`.

## Remaining work

- Invalidate AD scope/instruction/complete-case confirmations after HTS/origin
  and order-root changes; the current identity guard does not finish that scope.
- Missing exporter evidence correctly withholds totals, but an extra generic
  historical-coverage finding can incorrectly imply missing law. Separate those
  blockers so the user sees the actual data/evidence step.
- Cache complete Chapter99 projections by pinned sourceID/hash within the
  existing request memory bounds. Mixed-date groups currently repeat PDF table
  extraction. Preserve complete publication, source hashes and all quotas.
- Other countries/instruction grammars, manufacturer-only fallback, all-others
  decisions, specific deposits, correction chains, importer-specific final
  assessments and the49 other indexed message types remain unfinished.
- Broader country arrangements, other232 sectors, preferences, compound/derived
  procedures, exemptions and special entries/cutoffs remain in the
  [completion ledger](../plans/historical-coverage-completion.md). No broad box closes.
