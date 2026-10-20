# Chat-triggered tariff news refresh — October 20, 2026

## Implemented

“Any news today?”, “Any updates?”, “Have tariffs changed?” and explicit product/CSV
refresh requests now run the existing live tariff checker against the latest saved
CSV in the authenticated workspace. This is a fresh official-source check, not an
LLM's guess about whether it should check. No extra model-routing call or model
completion is required for the deterministic update response.

The selector uses the latest saved input even if its previous check failed or is
incomplete. It never silently falls back to an older catalogue, fabricated example,
or general-news search. No file means corrective upload guidance; unavailable or
unverifiable history means no fresh check is claimed. Viewers cannot initiate a
write/check. Fictional playground conversations remain isolated.

Each refresh creates a new append-only check, preserving the complete original CSV
and linking its engine metadata to the baseline record. Prior results remain
unchanged. Saved explicit shipment declarations are reused, and CSV declarations
take precedence; no missing qualification is guessed. Changed facts require a
corrected input/new upload.

## Results and evidence

- The new saved report contains a `chatRecheck` object with the baseline ID,
  checked day, deterministic comparison and dated captured tariff publications.
  Later conversations retain this context, including when detailed source context
  exceeds the chat budget.
- A full numerical duty difference requires matching product groups, values,
  quantities, facts and basis; both checks must have stable publication revisions
  and complete finite totals. Product identity comparison tolerates JSONB object
  key ordering. Incomplete amounts never become zero. Base-only differences are
  separately labelled. The report retains up to five largest absolute SKU/group
  differences for follow-up questions.
- Annual inputs produce a difference per year. Historical inputs produce a
  difference on the same historical values, not an annual forecast or refund claim.
- Today's headlines are filtered by publication date. RSS timestamps use
  America/New_York; undated/older publications do not become today's news. Listing
  text is not automatically interpreted as a customer's new legal obligation.
- Headline applicability remains explicitly unconfirmed. No captured publication
  dated today is not proof nothing changed. Failed sources and incomplete legal
  scope remain visible. Source links/favicons derive only from fetched sources.
- Fictional/demo product facts stay visibly labelled while government sources are
  fetched live. Known fictional facts never turn into asserted customer operations.

`app/api/chat/route.ts` recognizes explicit update requests deterministically.
Explanations, negations, hypothetical questions and unrelated generic news questions
do not trigger a recheck. This is a bounded phrase recognizer, not a universal
natural-language action planner. Other questions use the existing saved-context
and research path. Uploading a new CSV still runs the upload flow rather than also
refreshing an old file.

The implementation extends the existing `app/api/chat/csv-check.ts`; no new `lib/`
module, schema migration, schedule, worker connection or notification delivery was
added. Request paths use authenticated workspace identity/client and existing RLS.

## Verification

- Existing full suite: **922 passed, 0 failed**.
- Final focused upload/recheck/history/archive/remedy tests: **92 passed**,
  including **56 chat CSV/recheck tests**.
- TypeScript, `git diff --check` and final isolated production webpack build:
  passed. The build used dummy public configuration and no model/admin keys.
- Actual handler/helper fixture tests cover fresh requests with/without configured
  model availability, saved original reuse, source/report persistence, explicit
  declarations, missing records, invalid latest inputs, viewer denial, read/hash
  failures, fetch failures, fractional-dollar differences, JSONB key ordering,
  incomplete totals, fictional isolation and Eastern-date boundaries.
- A read-only configured-project query confirmed authenticated archive read and
  completion-RPC privileges. It did not read or mutate customer records.
- Browser verification uses an isolated production app and explicitly mocked SSE
  and archive responses. This tests the typed-question/progress/source/report UI;
  it does not establish a new authenticated real-government/customer check.

No paid model request, real customer mutation, deployment, commit or push was made.
Existing dependency-security findings remain separate release work.

## Scope

This is a user-triggered **tariff** refresh of one latest workspace CSV. The existing
checker still has bounded source/legal coverage; recent Federal Register/CSMS
headlines are review leads. A numerical difference is not independent legal
approval, and zero observed difference does not prove universal compliance.
Scheduled monitoring, all-file portfolio selection and arbitrary chat actions
remain outside this change.
