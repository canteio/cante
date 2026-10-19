> Design / roadmap document. Planned features and dated implementation notes are not a readiness guarantee. See [current status](../product/status.md).

# Project Mission One — stacking-exclusion rules: AI authors once, code applies deterministically

**Revision 2.** Revision 1 put AI reasoning (generate + verify) at
shipment-calculation time — a real design mistake, caught in review before
any code was written. If a customer uploads 50,000 entries citing the same
regulation, that architecture would call an LLM up to 50,000 times to
re-derive the same legal conclusion. This revision moves all AI reasoning to
**rule-authoring time** (once per regulation) and makes shipment-time
application pure, deterministic, LLM-free code — which is what every other
number in this codebase's duty engine already does, and this plan should
never have been an exception to that.

## 1. What this closes

The stacking engine (`lib/tariff/stack.ts`) computes each individual duty
component (base, Section 301, Section 232, Section 338) deterministically,
with a citation, and never guesses a rate. That discipline is correct and
stays unchanged by this plan.

What it does **not** do today is decide which of those correctly-computed
components actually apply together. Real tariff measures carry exclusion and
precedence rules relative to each other — a new Section 301 action may not
apply if the product is already covered by Section 232, or if it is
USMCA-qualified. `stack.ts` already recognizes this class of problem
(`unresolvedMeasures` exists precisely because of it) but handles it the only
honest way available today: withhold the total rather than guess. The code
at line 240 is a live example — a real Section 301 forced-labor action,
correctly cited, is withheld from every total it touches because the
232/USMCA exclusion logic isn't modeled.

This closes that gap **without** reopening the door to hardcoded
`if`-branch-per-rule (doesn't scale) or to runtime LLM reasoning per shipment
(doesn't scale either, and isn't deterministic). The answer is the same
pattern this codebase already uses for HS codes and classifications:
**AI drafts, a human confirms, code applies the confirmed thing forever
after** — with no LLM call anywhere in the second half of that sentence.

## 2. The important context this plan does not duplicate

The larger loop this plan sits inside — a new regulation detected → matched
to real products by HTS code → dollar impact computed → surfaced to the
customer — **already exists and works**, built and verified earlier this
session: `lib/checks/run.ts` (detection + judgment) →
`lib/tariff/monitor-bridge.ts` (product matching) →
`lib/tariff/monitor-company-impact.ts` (impact calculation) → the "Check for
updates" button and its result card. Project Mission One is not that
pipeline. It is a fix to the single largest accuracy gap *inside* the
calculation step that pipeline already calls: the stacking-exclusion
decision stack.ts currently has to leave unresolved.

## 3. Non-negotiable invariants

- **Never fabricate a rule.** Deterministic application may only use rules
  that exist as confirmed rows in the database with a real source citation.
- **Absence of a rule is not evidence of anything — and most measures never
  need one.** `stack.ts` already stacks base/301/232/338 additively by
  default, with no exclusion question asked, for the overwhelming majority
  of shipments — that default is correct and stays. Rule-lookup only ever
  runs for a measure that something has *already flagged* as carrying a
  possible exclusion (today: the one hardcoded Section 301 forced-labor
  case; after this plan: any finding the judgment pass tags the same way).
  For a flagged measure, "no confirmed rule resolves this shipment's facts"
  means `NEEDS REVIEW`. For every other, unflagged measure, nothing in this
  plan changes `stack.ts`'s existing default stacking behavior at all. Do
  not build a version of this where every measure is checked against the
  rules table on every shipment — that silently flips "stack unless known
  exclusion" into "don't stack unless pre-approved," which would flag
  thousands of ordinary imports for no reason.
- **AI reasoning happens once, at authoring time, never at shipment time.**
  A regulation is interpreted once by AI, checked once by a second
  independent pass, confirmed once by a human. After that, applying it to
  one shipment or one hundred thousand is the same deterministic code path,
  with the same cost and the same latency either way. If a future shipment's
  facts don't cleanly match any confirmed rule's `conditions`, that is
  `NEEDS REVIEW` for *that shipment* — it is never a reason to re-invoke an
  LLM. A fact pattern a confirmed rule doesn't cover is new information for
  a human to review and (if warranted) author a new rule from, not something
  for a model to improvise about on the spot.
- **Tiered trust, exactly like HS codes already work.** A rule an AI drafts
  from a new regulation is `lead` tier — unusable to change a real total.
  `document` tier means a **person** read the regulation's official text
  directly (same meaning `lib/checks/facts.ts` already gives `document` for
  HS codes) — an AI reading the same document never earns this tier on its
  own. `human` tier means a person reviewed and confirmed the AI's draft.
  Only `human`/`document` tier rules are ever used to compute a real total.
- **Deterministic math stays deterministic.** This plan changes *which*
  already-correctly-computed components get summed, never *how* a single
  component's rate or amount is computed.
- **Hosted-only, no local dependency.** The one-time authoring-time model
  calls go through `lib/llm/api.ts` (`CANTE_LLM=api`), never the local
  Claude Code CLI. Shipment-time application needs no model call at all, so
  this constraint is trivially satisfied there.

## 4. Data model (new Supabase tables)

### `tariff_stacking_rules`

One row per rule, targeting **one** measure, with an ordered priority —
not a pairwise edge between exactly two measures. A rule's `conditions` can
reference any number of other measures or qualifications, which is what
makes three-plus-measure interactions representable without a general
rules-engine (forward chaining, conflict graphs, etc.) that this project
does not need and should not build.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `target_measure` | text | the measure this rule governs, e.g. `section_301_forced_labor` — controlled vocabulary matching `stack.ts`'s existing measure identifiers |
| `action` | text | `exclude` \| `include` \| `cap_at` — what happens to `target_measure` when `conditions` are met |
| `conditions` | jsonb | structured preconditions referencing other measures/facts, e.g. `{"section_232_matched": true}` or `{"usmca_qualified": true}` — never free text the application code has to interpret |
| `priority` | integer | lower evaluates first; the first rule whose `conditions` match wins, same semantics as a `switch` statement, not a weighted/voted outcome |
| `rule_text` | text | human-readable statement of the rule, for display and for authoring-time retrieval |
| `embedding` | vector(384) | same model/dimensionality as the existing HTS schedule embeddings — used **only** at authoring time to help a human or the extraction step find related/conflicting existing rules; never consulted at shipment-application time |
| `citation` | text | the authoritative source URL |
| `effective_date`, `expires_date` | date, nullable | explicit null when the source doesn't establish one; `expires_date` lets a superseded rule stop matching without being deleted |
| `tier` | text | `lead` \| `human` \| `document` |
| `confirmed_by` | text, nullable | required when `tier <> 'lead'` |
| `superseded_by` | uuid, nullable | self-reference, old rows kept not deleted |
| `precedence_over` | uuid, nullable | self-reference to another `human`/`document`-tier rule for the **same** `target_measure` whose `conditions` this rule's conditions overlap with — see conflict handling below |
| `precedence_reason` | text, nullable | required whenever `precedence_over` is set — the legal basis for why this rule, not the other, governs the overlap (a citation or an explicit statement that the source itself resolves the conflict) |
| `created_at`, `updated_at` | timestamptz | |

RLS: public-read / service-role-write, same as `hts_schedule_embeddings` —
tariff law isn't tenant-specific data.

**Conflict handling is a promotion-time gate, not a runtime guess.** Two
`human`/`document`-tier rules for the same `target_measure` are only allowed
to have overlapping `conditions` if one names the other via `precedence_over`
with a `precedence_reason`. The review UI (§5 step 5) checks for an
overlapping existing rule before allowing promotion and blocks it until the
reviewer either sets `precedence_over` (citing why) or narrows the new
rule's `conditions` so the overlap no longer exists. `priority` still exists
purely to order evaluation among rules whose conditions **don't** overlap —
it is never the mechanism that resolves a real conflict, only a tie-break
among rules that were never in conflict to begin with. If `applyStackingRules()`
(§6) ever encounters two confirmed rules matching the same shipment with
different `action`s and neither names the other via `precedence_over` — a
state the promotion gate should have prevented — that is treated as a data
integrity failure, logged, and resolved as `NEEDS REVIEW`, never silently
settled by priority order alone.

### `tariff_stacking_rule_drafts`

Where authoring-time AI output lands **before** it's a usable rule — kept
separate from `tariff_stacking_rules` itself so a draft can never be
accidentally queried by the deterministic application path, by construction
rather than by a `WHERE tier != 'lead'` filter someone could forget.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `source_finding_id` | uuid | the `findings` row this was drafted from |
| `proposed_rule` | jsonb | the generator pass's structured proposal, same shape as a `tariff_stacking_rules` row |
| `verifier_verdict` | text | `confirmed` \| `disputed` \| `insufficient_evidence` |
| `verifier_reasoning` | text | shown to the human reviewer alongside the draft |
| `reviewed_by`, `reviewed_at` | nullable | set on promotion to `tariff_stacking_rules` or on rejection |
| `status` | text | `pending` \| `promoted` \| `rejected` |
| `created_at` | timestamptz | |

## 5. Authoring time (once per regulation) — where AI reasoning lives

Triggered from the existing `runCheck()` judgment pass
(`lib/checks/run.ts`), additively — no new schedule, no new cron:

1. When a finding is judged `flagged`/`noted` and mentions two or more known
   measure types, retrieve related existing `tariff_stacking_rules` rows via
   embedding similarity on `rule_text` (the one place semantic search is
   used in this whole plan — finding what already exists, not deciding
   what's legally true).
2. **Generator pass**: `completeJson()` (the existing `lib/llm/index.ts`
   seam) proposes a `tariff_stacking_rules`-shaped row from the finding's
   text plus the retrieved related rules (to avoid contradicting an existing
   confirmed rule without saying so). Must cite the finding's own source
   document; may not invent a citation.
3. **Verifier pass**: a separate call, adversarial framing, checks the
   proposal's `conditions`/`action`/citation actually match what the source
   finding's text says — not "do you agree," but "find the unsupported
   claim." Writes `verifier_verdict` + `verifier_reasoning`.
4. Both passes' output land in `tariff_stacking_rule_drafts` at
   `status = 'pending'`, regardless of verdict — a `disputed` draft is still
   shown to a reviewer, just flagged as such, never silently discarded.
5. A human reviews pending drafts (a Confirm/Reject list, same interaction
   `/memory` already has for chat-extracted facts — no new standalone admin
   app) and promotes a draft to a real `tariff_stacking_rules` row at
   `tier = 'human'`, or rejects it.

This is the only place in the whole plan an LLM is called, and it happens
roughly as often as new regulations are judged relevant — not once per
shipment, not once per customer, not once per CSV row.

## 6. Shipment time (every CSV row, every call) — deterministic, no LLM

New `applyStackingRules(measures: MatchedMeasure[], context)` in
`lib/tariff/stacking-rules.ts`. Plain code, callable thousands of times per
upload with no added latency class beyond a DB read:

```
for each measure stack.ts already computed:
  if nothing has flagged this measure as carrying a possible exclusion
    (see "scope gating" below):
      leave it exactly as stack.ts already computes it today — no DB
      lookup, no rule check, no change in behavior
    continue

  # only flagged measures reach here
  matching_rules = all tariff_stacking_rules rows where
    target_measure = this measure
    AND tier IN ('human', 'document')
    AND (effective_date is null OR effective_date <= shipment date)
    AND (expires_date is null OR expires_date > shipment date)
    AND conditions match this shipment's actual matched measures/facts

  if matching_rules is empty:
    NEEDS REVIEW ("flagged, no confirmed rule resolves it yet")
  else if matching_rules has 2+ rows with different actions
           and none names the other via precedence_over:
    NEEDS REVIEW ("conflicting confirmed rules — promotion gate should
    have caught this, logged as a data integrity issue")
  else:
    apply the (single, or precedence-resolved) action — deterministic, logged
```

**Scope gating**: a measure is "flagged" the same way the one hardcoded
case already is today — the regulation's own text that introduced it
mentions an exception/exclusion condition. This is recorded once, at
authoring time (§5), as a property of the measure identifier itself (e.g. a
small `flagged_measures` set/table populated alongside
`tariff_stacking_rules`), not re-derived per shipment. An unflagged measure
never touches this code path at all — it is indistinguishable from today's
`stack.ts` behavior.

A confirmed `action: 'include'` rule (the positive case — "this has been
checked and these measures legitimately stack despite the flagged concern")
computes normally. A confirmed `exclude` withholds that component from the
sum with a logged, citable reason. No row anywhere in this path triggers a
network call.

### Where this plugs into `stack.ts`

`computeStackedDuty()` gains one new step after its existing deterministic
component calculation: call `applyStackingRules()` for any matched measure
that doesn't already have a hardcoded exclusion (the Section 338/232
alcohol carve-out stays hardcoded as-is — a verified, working case doesn't
need migrating just for architectural purity). Its output changes
`totalAmount`/`unresolvedMeasures` exactly where the old hardcoded cases
already do today — same shape, same place in the UI, more cases covered.

## 7. Phased rollout

**Phase 1 — prove it on the two known real cases, entered by hand.** Both
named rules (Section 301 forced-labor excluded when already Section
232-covered; same action excluded when USMCA-qualified) are entered directly
at `tier = 'human'`, skipping the authoring pipeline for this first pass, to
validate the data model and `applyStackingRules()` against a real,
currently-withheld `unresolvedMeasures` case. Success: that specific total
becomes a real computed number instead of withheld, with zero added LLM
calls in the calculation path.

Test matrix for Phase 1, run against `applyStackingRules()` directly:
- **An ordinary shipment touching zero flagged measures stacks exactly as
  `stack.ts` does today, with zero rule-table lookups.** This is the
  regression test for the "thousands of ordinary imports wrongly flagged"
  failure mode — it must fail loudly if scope gating is ever accidentally
  widened to all measures.
- The two known cases, both directions (measure present / measure absent).
- Missing data: a shipment where `conditions` can't be evaluated because a
  needed fact (e.g. verified USMCA qualification) wasn't supplied — must
  produce `NEEDS REVIEW`, never assume either direction.
- Conflicting rules **with** a `precedence_over` relationship: resolves
  deterministically to the stated winner, and the test asserts the
  citation/reason shown is the `precedence_reason`, not just "higher
  priority."
- Conflicting rules **without** a `precedence_over` relationship (simulating
  a promotion-gate failure): must produce `NEEDS REVIEW`, never silently
  resolve via `priority` alone.
- Expired rules: a rule whose `expires_date` has passed must not match a
  current shipment; a historical shipment dated before expiry must still
  match it correctly (this is the same effective-date-aware logic `stack.ts`
  already proves out for Section 301/232 rate history — reused pattern, not
  new machinery).
- A shipment dated before any applicable rule's `effective_date` — same
  "don't apply retroactively" rule `stack.ts` already enforces elsewhere.

**Phase 2 — ingestion.** Wire §5's draft pipeline into `runCheck()`'s
existing judgment pass. Build the Confirm/Reject review list.

**Phase 3 — broaden coverage.** Extend `target_measure` vocabulary as more
measure types (AD/CVD scope, UFLPA) get their own `stack.ts`
representations — tracked separately, out of scope here.

## 8. Vercel/Supabase-only constraint

- Authoring-time calls (§5) are triggered from the existing `runCheck()`
  path, already proven to run from a Vercel serverless function via the
  hosted API (`/api/tariff/check-now`, this session) — no new infrastructure
  decision.
- Shipment-time application (§6) is pure Postgres + application code — no
  model call, so no latency or cost question to solve at all.
- Embeddings reuse the existing `lib/classification/embed.ts` /
  `202610070001_hts_schedule_embeddings.sql` pattern exactly — same vendor,
  same dimensionality, same measured cost model.

## 9. Pipeline verification — what's actually live today, stated plainly

A working "Check for updates" button is not the same claim as "continuous
monitoring" or "notification delivery," and this plan should not let that
distinction blur. As of this session:

| Capability | Status |
|---|---|
| Detect a regulation (`lib/checks/run.ts`, Federal Register/CBP CSMS/USITC/USTR) | **Live** — manually triggered via `/api/tariff/check-now`, verified working this session |
| Match it to real products by HTS code (`lib/tariff/monitor-bridge.ts`) | **Live** — same verification |
| Compute dollar impact (`lib/tariff/monitor-company-impact.ts`) | **Live** — same verification |
| Surface it in the UI | **Live** — the compact result card under "Check for updates" |
| **Continuous/scheduled monitoring** (a cron running this without a click) | **Not live — deliberate decision this session.** "Button now, cron when there's more than one customer who needs it automatic." Nothing in Mission One changes this. |
| **Customer notification delivery** (Telegram or otherwise) | **Not live.** Telegram delivery code exists in `lib/delivery/telegram.ts` but has never been configured for this app; nothing is sent anywhere today. |

Project Mission One does not change any row in this table — it only makes
the "Compute dollar impact" row more accurate for the stacking-exclusion
case. Scheduling and delivery remain separate, already-scoped, not-yet-built
decisions, tracked outside this document.

## 10. What this plan explicitly does not do

- Does not call an LLM anywhere in the per-shipment calculation path —
  this is the central fix from revision 1.
- Does not build a general rules engine (forward-chaining, conflict-graph
  resolution) — an explicit `precedence_over` link plus priority-ordered
  evaluation among non-overlapping rules is sufficient for every case
  described so far, and more machinery than that is solving a problem this
  project doesn't have yet.
- Does not touch customs-entry filing — still entirely out of scope.
- Does not change how any single measure's rate is calculated — only which
  already-correctly-calculated measures get summed.
- Does not let an AI promote its own draft — `tier` only advances past
  `lead` via a named human reviewer, every time, no exception.
- Does not run every measure through rule-lookup — only measures a
  regulation's own text has flagged as carrying a possible exclusion; see
  §3's scope-gating invariant.
- Does not introduce a second embedding model or a second LLM provider
  path — reuses what's already proven in this codebase.
- Does not add scheduled monitoring or notification delivery — both remain
  separate, not-yet-built decisions per §9.

## 11. Smallest implementation plan

Ordered so each step is independently testable before the next begins, and
each step alone is small enough to review in one sitting.

1. **Migration**: `tariff_stacking_rules`, `tariff_stacking_rule_drafts`,
   and the `flagged_measures` set (§4, §6) — schema only, no application
   code yet. Verify via Supabase migration dry-run, same discipline this
   project already uses for every other migration.
2. **`applyStackingRules()` + the regression test suite from §7**, written
   against a hand-seeded `tariff_stacking_rules` table (no ingestion
   pipeline yet, no `stack.ts` wiring yet). This proves the deterministic
   core — scope gating, conflict handling, date-awareness — in total
   isolation, which is the highest-risk logic in the whole plan and the
   cheapest to get right before anything depends on it.
3. **Wire `applyStackingRules()` into `computeStackedDuty()`** (§6's "where
   this plugs in"). With only the two hand-entered Phase 1 rules in the
   table, confirm the one currently-withheld Section 301 forced-labor total
   becomes a real computed number in the actual UI — the end-to-end proof
   that mattered from the start.
4. **Authoring pipeline** (§5): generator pass, verifier pass, the
   `tariff_stacking_rule_drafts` write path — tested against the same two
   known regulations, confirming the AI-drafted rule matches what was
   hand-entered in step 3.
5. **Review UI**: the Confirm/Reject list, including the promotion-time
   conflict gate (§4's conflict handling). This is the only new
   customer/operator-facing surface this plan requires.
6. **Broaden `flagged_measures` coverage** as real regulations get judged —
   ongoing, not a discrete step with an end date.

Steps 1–3 alone already deliver the thing that was asked for: the known
stacking-exclusion case computing correctly, with nothing hardcoded and no
LLM call in the shipment-time path. Steps 4–5 are what make that scale
beyond rules someone typed in by hand.

## Implementation status — October 11, 2026, steps 4–6

Steps 4–6 are implemented in the `dev` working tree:

- `lib/tariff/stacking-authoring.ts` and `stacking-authoring-contract.ts`
  fetch bounded official government text, retrieve related rules using the
  existing 384-dimensional embeddings, generate proposals, independently
  verify each, and persist pending drafts. Verbatim quotes and the exact
  fetched citation are checked in code and again in the database. AI cannot
  promote a draft. Missing verifier evidence remains visible to a reviewer.
- `runCheck()` nominates relevant `flagged`/`noted` findings mentioning
  multiple supported measures. Every nominated source is queued; one source
  is processed per check to bound serverless execution. Fetch failures and
  remaining queued work become coverage caveats. Fetched-content fingerprints
  deduplicate authoring globally across customers; failed attempts require
  explicit owner/admin retry rather than automatic repeated model spending.
  All authoring requires explicit `CANTE_LLM=api`.
- `/api/tariff/stacking-rules` and `StackingRuleReview` provide paginated
  pending drafts, source/evidence, verifier disagreements, narrower shipment
  conditions, explicit precedence/legal basis, named-human Confirm/Reject,
  reviewed records, queued-source authoring, and failure retries. The panel
  lives inside `/tariff` → **History & sources → Tariff rule reviews**.
  Owner/admin access follows the existing shared-reference-data trust model;
  finding IDs and other tenants' operational reasoning are not returned.
- Promotion/rejection and the overlap gate are transactional service-only
  RPCs, with reviewer membership rechecked in the database. Overlapping
  confirmed rules require explicit precedence or narrower conditions;
  priority cannot resolve a legal conflict. Public law tables have read-only
  RLS policies, and drafts/jobs remain private to the trusted service.
- The flagged-measure registry expands from supported, source-backed
  proposals and independently recorded exclusion concerns. A source that
  cannot yield a usable rule can still flag its measure: zero confirmed
  rules then means unresolved, not permission to keep adding duties.
  `stack.ts` applies include/exclude/component caps to already-computed
  measures. A forced-labor exclusion can remove that unresolved concern;
  inclusion cannot manufacture its still-unmodeled rate. AD/CVD and UFLPA
  computation remain outside this implementation, as the plan specifies.
- Upload/portfolio evaluations share request-scoped reference reads: no
  model calls per row, rules fetched once per encountered flagged measure,
  and fresh reference reads on the next request. Historical saved snapshots
  are unchanged. Ordinary measures make no rules-table lookup.

The four authoring/queue migrations were applied to Cante project
`nvdsjqzbzsczvmvjxhro` after individual dry runs. The retained
`scripts/verify-stacking-authoring.sql` verifies the real database gates
inside transactions and rolls all fixtures back. Browser QA uses a temporary
isolated user/workspace and browser-only draft fixtures, not live synthetic
rules. It covers desktop/mobile presentation, disabled confirmation before
source review, review payloads, conflict errors, and owner/viewer route
permissions. Hosted model behavior is exercised through fixture providers in
unit tests; no new real regulation was automatically confirmed during QA.
The hosted frontend has not been deployed by this implementation.

Final validation for this implementation: **902/902 tests**, clean
`tsc --noEmit`, successful `npm run build`, and live transactional verification
of authoring evidence, promotion/rejection, conflict/overlap gates, owner/admin
permissions, retries, queued claims, and duplicate-source prevention. Desktop
and 390px mobile browser checks passed; the temporary user and both its test
workspaces were removed. Security advisors reported no new schema issues
(the existing Auth leaked-password-protection warning remains).

## Pilot calculator dashboard — October 11, 2026

The signed-in `/tariff` page now leads with the interview's narrow request:
HTS code + origin + import date, or a CSV with those columns. No catalogue,
supplier, customs value or duty-paid field is required to request a rate.
The three sections are Upload, Results and Updates. Each result expands into
components, exclusions, citations, explicit unresolved reasons and a form to
correct/add facts and recalculate that row. CSV export includes the date,
qualification evidence, components, sources and coverage limitations. The
existing immutable historical audits and product management remain under
“Saved audits & products”; rule approval moved to `/tariff/rules`, restricted
to owner/admin users. No schedule or notification delivery was enabled.

Explicit USMCA evidence is now mapped and forwarded by the annual-impact
path as well as the calculator. A bare programme claim never establishes
qualification. The new `usmca_duty_free` stacking fact additionally requires
an explicit verified qualifying decision and an actual published free special
rate; missing evidence remains unknown. The corresponding review-gate
migration was applied to Cante after a dry run.

Readiness is still bounded, not a claim of a complete customer pilot:
- The real browser calculator fetched the published base rate for
  3916.90.30.00/Vietnam and withheld the total: the accepted live Section 232
  ledger predates June 8, 2026, and the July forced-labor measure remains
  unresolved. A current, reviewed consolidated Section 232 snapshot is
  required; this change does not manufacture one.
- Two real official-source USMCA exclusion proposals are pending review,
  prepared from FR document 2026-15181, operative U.S. note 52(g)/(h).
  Both independent hosted authoring attempts timed out (full source, then
  bounded operative passages); failures are recorded, no auto-retries occur.
  The retained `scripts/prepare-pilot-stacking.ts --prepare-source-drafts`
  prepares source-backed pending proposals with `insufficient_evidence` and
  explicit verifier failure. Neither is promoted or labelled human-verified.
  Section 232's exemption-heading list cannot safely be reduced to a generic
  matched-Section-232 flag, so no such exclusion was approved or seeded.
- The interview participant supplied text, not a real customer catalogue or entries.
  Neither customer-data accuracy nor willingness to pay was verified.

Local verification: 906/906 tests, TypeScript, production build, actual
authenticated desktop/mobile browser calculation and CSV partial-error flow,
admin draft visibility, and live transactional review-gate checks (fixtures
rolled back). The temporary browser user/workspaces are removed after QA.

Hosted deployment correction: Vercel has no worker service key, intentionally.
Admin review now uses narrowly scoped authenticated SECURITY DEFINER functions,
with `auth.uid()` supplying reviewer identity, owner/admin checks in the database,
source-read acknowledgement enforced in SQL, and private worker/finding fields
omitted from the read payload. The migration was applied after a dry run and
verified live inside rolled-back transactions. An actual authenticated browser
read returned both pending proposals through this path. Worker-only authoring
retry stays unavailable on Vercel. The check-now endpoint returns an explicit
unavailable response before starting work when no trusted worker is configured;
the dashboard disables that action. This is a disclosed deployment gap, not a
claim of live official-source monitoring. The annual monitor recalculation also
preserves explicit qualification evidence from saved result audits.

Browser QA additionally verified per-row country correction and verified-USMCA
forwarding, with totals still withheld for unrelated unresolved measures. Export
read-back verified matching column counts, input/evidence context, blank unknown
totals, and retention of invalid-row messages. Those qualification inputs were
explicitly labelled QA fixtures and were never persisted as customer audits.

Final release validation: **907/907 tests**, clean TypeScript, successful production build, and successful live authenticated-review SQL checks with all fixtures rolled back. The isolated QA account/workspaces and temporary auth files were removed.

Final Vercel preview (READY, October 11):
https://cante-br13rakg3-jeremygautamas-projects.vercel.app
Deployment protection requires Vercel sign-in. Production was not promoted.
No service key was added to Vercel. Cloud source checks remain unavailable
until a trusted worker is connected; admin read/approval uses JWT-backed RPCs.
