# Unified tariff workspace — October 22, 2026

The dashboard previously displayed a catalogue but refreshed a separate latest-file
archive. Chat also selected that file instead of the visible catalogue. This made
the check button depend on a second intake path and hid older notice checks.

## Implemented architecture

- The tenant catalogue owns product identity, origin and classification history.
  `products.tariff_inputs` holds explicit customs values, quantity/units,
  qualification declarations, value basis and source-check references. These are
  user inputs, never approved rules or trusted results. Reference prices remain
  separate. The additive migration is applied; existing product RLS is unchanged.
- Dashboard and chat refreshes read the same bounded catalogue snapshot, retain it
  as immutable check input, and use the existing signed trusted-worker path.
  Catalogue rows with missing/conflicting codes, origins or values remain present
  and unresolved. More than 100 active products fails explicitly instead of
  checking an undisclosed subset.
- File uploads through either surface use the same original-file storage,
  extraction/column-confirmation and catalogue ingestion. Fresh checks retain the
  original upload and captured evidence. Catalogue-only intake does not demand an
  invented annual amount. Ambiguous price columns still require confirmation.
- Per-product comparisons retain unchanged-fact matches when another product is
  added or edited. Rate changes can be displayed without invented money. Overall
  exposure is withheld for missing amounts, inconsistent/mixed value bases or
  incomplete coverage. Only worker-attested saved reports supply baselines.
- `/tariff` contains the product table, upload/edit controls, refresh action,
  expandable duties/evidence and an embedded chat. Chat retains its conversation
  when closed/reopened, does not rewrite the dashboard URL, and refreshes the
  dashboard after completion. Standalone chat links back to the same workspace.
  Old `/tariff/demo?check=…` links redirect to the dashboard. Fictional simulation
  code remains outside normal navigation and retains its isolation guards.
- Earlier official-notice runs and their latest retained findings are exposed in
  the dashboard evidence disclosure. They are not relabelled as verified numerical
  duty baselines. No customer products or previous checks were deleted or seeded.

## Verification

- TypeScript passes and an isolated production webpack build succeeds, with the
  existing middleware/Edge warnings. The original development server was preserved.
- Existing suite: 930 tests passed. Workflow: 17 passed. Shared file/chat intake:
  70 passed. Archive/live checks: 22 passed. New workspace data/comparison tests:
  15 passed, including tenant
  scoping, missing values, input drift, retained qualification facts and partial
  portfolio comparisons.
- Isolated browser fixtures verified desktop/mobile product details, chat
  prefilling, actual in-panel streaming UI and scroll containment. Fixture results
  do not establish live calculation or database correctness.
- A separate authenticated verification workspace exercised the production build
  against real Supabase storage and the hosted worker. Upload, dashboard refresh
  without re-upload, and chat refresh each saved a protected execution proof.
  The three successful archives passed original-input, source and result integrity
  checks. A newly added product with no customs value remained present and
  unresolved; the comparable product retained its comparison while portfolio
  exposure stayed null. These were labelled fictional inputs, not customer or
  broker-reviewed calculations.
- An initial upload timed out under the shorter upload quota lease. That failed
  attempt remains archived. The combined upload/check route now uses one bounded
  check lease without double reservation. Repeating the complete flow succeeded.
  Canonical fact comparison also avoids JSONB key-order false positives, and
  dashboard totals require the current catalogue to match the saved report.
- Actual browser checks verified conversation continuity between full chat and the
  dashboard, panel close/reopen state, and a 390-pixel mobile viewport without
  horizontal overflow. Existing customer product and notice-check counts were
  unchanged. The isolated verification identity was disabled, sessions revoked
  and the local temporary password removed; immutable test archives remain.
- Database advisors reported six existing warnings and no errors. This change
  did not alter existing reviewer authority or authentication policies.

## Deployment and limits

The compatible isolated Vercel checking worker is deployed and the standard local
connector points to it. Matching connector settings are configured for future
website preview and production builds. The main production website has not been
promoted or redeployed. The
production build and UI changes are not a claim of universal tariff coverage.
Unsupported duties, conditional exclusions, unreviewed classification and missing
shipment facts remain visible. No schedules, model calls or delivery were enabled
for verification.
