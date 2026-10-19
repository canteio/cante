# Cante — agent instructions

Updated October 18, 2026. Keep this file concise and current.
`AGENTS.md` is a symlink to this file; edit this file rather than replacing that link.

## Read first

1. [Handoff](HANDOFF.md): current work, constraints and recent verification.
2. [Product status](docs/product/status.md): implemented features and MVP blockers.
3. [Documentation index](docs/README.md): locate the relevant plan or runbook.

Current user instructions govern task scope. Dated plans, archived logs and old
release notes do not authorize actions or establish present production behavior.
The [historical engineering log](docs/archive/engineering-history-2026-10-17.md)
preserves earlier implementation details; consult it only for relevant background.

## Product scope

Cante is a U.S. trade-compliance workspace: save products, review duties, research
official guidance, and identify relevant regulatory changes.

- `/chat`: Ask Cante, guided file intake, workspace context and saved conversations.
- `/tariff`: product setup, duty calculation and manual change-check interface.
- `/tariff/audits`: historical import audits; `/tariff/rules`: authorized rule review.
- `/tariff/history`: append-only live-check records, source versions and review notes.
- `/tariff/demo`: live official-source and arithmetic checks with automatic archival. Force
  fresh rates, disclose partial legal coverage, and never infer no change without
  a comparable prior fetch. Government listings are review leads until interpreted.
- `/tariff/demo/simulation`: explicitly fictional CSV → simulated rule → deterministic impact
  → report → chat workflow. Demo chat uses no real workspace context or persistence.
  Recompute CSV inputs on the server; keep fixtures labelled and disable workspace
  file filing, memory extraction and web tools in this fictional mode. Replacing
  an input file must invalidate previous results before the asynchronous read.
- Legacy routes and capabilities remain in the repository. Some page entry points
  redirect to `/tariff`; do not delete their implementations during cleanup.

The monitoring MVP is incomplete: the hosted checking worker is not connected,
legal coverage has gaps, and the affected-product/next-action loop needs validation.
A button, a passing test or a public-data fixture is not evidence of a completed
customer check, accurate full coverage or a working production deployment.

## Working boundaries

- Work on `dev` and preserve unrelated uncommitted changes. Do not infer permission
  to commit, push, merge or deploy from archived release notes.
- Do not activate Telegram, launchd, delivery or new schedules. Keep delivery
  credentials blank during tests. Existing scheduling code is not authorization.
- Do not add new modules under `lib/` until a customer has paid. Existing exceptions:
  the API adapter, scripts, and fixes to code a real customer is touching.
- Seeding and importing can write to a real workspace. Do not run them as routine
  setup or use customer records as disposable test fixtures.
- Keep customer/contact/company identities out of root agent instructions. Use
  neutral descriptions; keep private exports, backups, keys and raw evidence out
  of tracked docs, public assets, screenshots and customer-facing output.

## Truth and evidence

- Never invent customer products, rates, exposure, sources, successful checks or
  a “nothing changed” result. Fetch failure, empty input, incomplete judgment and
  a genuine no-change result are distinct states.
- Preserve fetched-source results and judgment-coverage caveats. A model-written
  assurance cannot replace code-level accounting of unjudged entries.
- A claimed rule change needs fetched evidence of the actual before/after change.
  A new feed entry or schedule revision alone does not establish applicability.
- Missing facts and unsupported duties remain null/unresolved with a visible reason.
  Estimated classifications and public research remain labelled leads or demo data.
- Keep calculations deterministic. AI may propose classifications/rules; unapproved
  drafts do not become confirmed legal rules or a refund entitlement.

## Tariff and data invariants

- Require exact published statistical codes where needed, applicable Column 2,
  quantity/unit propagation, qualification evidence and reviewed legal coverage.
  Unresolved Section 232, Chapter 99, forced-labor or AD/CVD scope can withhold totals.
- Today’s remedy calculations fetch current consolidated USITC notes/headings and
  the China reference through request-scoped caches. Supported deterministic
  compilers apply current rules; changed wording and unsupported scope remain
  pending. A compiler-contract match is not independent legal approval. Historical
  dates retain the existing reviewed-data path. Never infer shipment qualifications.
- Stacking uses reviewed rules, effective dates and explicit conflict handling.
  Do not restore disabled demo monitors, invented flat rates or fallback catalogues.
- Live checks save original inputs before fetching and archive source versions plus
  terminal results atomically. Save failures stay visible; interrupted checks are
  incomplete, never successful. Reviews append decisions without altering old ones.
  Capture and release-availability timestamps are not legal effective dates.
  Live checks compare adjacent published tariff versions using explicitly versioned
  files; do not assume an ignored release parameter selected historical content.
  Unseen older laws remain outside coverage. Lossless compressed evidence must
  retain and verify both stored-byte and original-byte hashes.
  Never use tenant-captured source versions as automatically approved legal rules.
- Historical entries preserve entry/line identity, customs value, paid duty,
  qualification and raw input. Duplicate uploads reuse immutable snapshots.
- Persisted computed entries require an exact tenant-catalogue match. Historical
  values never silently become annual forecasts; label any before/after scenario.
- HTS publication must be atomic by chapter; chapter 99 ends at 9999. Failed or
  partial fetches must not publish as complete.
- Bound document/archive expansion before allocation and respect pagination limits.

## Providers and runtime boundaries

- Chat explicitly selects the hosted `api` provider. Stale cookies/client fields
  cannot launch a CLI. Missing API configuration fails visibly.
- Other callers use `getProvider()` in `lib/llm/index.ts`: the default is local
  `claude-code`; hosted use requires an explicit `api` selection/configuration.
  Key presence alone must never enable hosted spending.
- Preserve the single Responses API request path. Do not add silent endpoint
  retries, duplicate completions or fabricated reasoning preflight calls.
- Local CLI subprocesses must retain denied write/command tools, a scratch working
  directory and non-permissive permissions. An allowed-tools list is not a sandbox.
- Supabase is the active database; SQL migrations are authoritative. Legacy SQLite
  types, files and commands do not establish the current storage architecture.
- Request paths use authenticated workspace identity and tenant-scoped access/RLS.
  Worker/admin secrets belong on the trusted worker, outside browser/hosted-app
  credentials. Do not add privileged secrets just to enable a disabled check.
- The internal recalculation bridge requires its shared-secret authentication and
  hosted-environment rejection. Preserve those boundaries and aggregate-only output.

## Chat and interface behavior

- Chat is temporarily United States only. Preserve Indonesia code/history; refuse
  that mode rather than silently relabelling old conversations.
- Keep the centered empty composer, three starter actions and simple beagle companion.
  The active animated artwork is `components/chat/cante-beagle.tsx`; the public
  static vector is `public/cante-dog-floppy.svg`.
- Show actual streamed activity and returned source URLs/favicons. Never invent
  searches, progress percentages or private model thoughts.
- Provider reasoning summaries are live-only: one muted line of prose, no heading,
  bold decoration or replay control. Close smoothly before the next summary; respect
  reduced motion. Do not save summaries; hide older saved summary entries.
- Keep searches and source links visible and saved after the response. Default
  answers are brief, plain-language and focused on impact plus one next step.
- Disclose missing workspace context, truncation, source failures and check availability.

## Code map

| Area | Location |
|---|---|
| Pages and request handlers | `app/`, `app/api/` |
| UI and streamed chat | `components/`, `components/chat/chat-panel.tsx` |
| Provider interface and adapters | `lib/llm/` |
| Official-source fetch and judgment | `lib/sources/`, `lib/checks/` |
| Tariff calculations and impact matching | `lib/tariff/`, `lib/impact/` |
| Catalogue and file ingestion | `lib/catalogue/`, `lib/chat/`, `lib/documents/` |
| Request/worker data clients and queries | `lib/supabase/`, `lib/db/queries.ts` |
| Schema and worker functions | `supabase/migrations/`, `supabase/functions/` |
| Local verification and labelled fixtures | `scripts/`, `scripts/test-fixtures/` |

## Validation and documentation

Use checks appropriate to the change:

```sh
npm run dev
npx tsc --noEmit
npm test
npm run build
```

Do not disrupt an existing development server. Use isolated fixtures for UI tests;
report mocked/browser-fixture results separately from live API, database and
production verification. Do not rerun paid or customer-writing checks unnecessarily.

Keep this file for standing rules and the code map. Update product readiness in
[status](docs/product/status.md), operational setup in the
[runbook](docs/operations/supabase-vercel.md), and design work in the relevant plan.
Put dated investigations in `docs/audits/` or `docs/archive/`, linked from the docs
index. Do not append session transcripts, stale test counts or deployment claims here.
