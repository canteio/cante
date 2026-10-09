# MVP status — October 9, 2026

The target is catalogue import plus historical customs-entry import, auditable
past-duty reconciliation, regulatory-change monitoring and financial exposure
based on the customer’s actual imports. CSV is sufficient; ERP integration,
customs filing and automatic refund claims are outside the supervised MVP.

## Implemented and verified

- Catalogue and historical CSV workflows exist. Historical snapshots retain
  entry/line identity, customs value, paid duty, qualifications, raw input and
  tenant catalogue linkage; duplicate uploads reuse immutable snapshots.
- Exact published HTS codes, applicable Column 2 rates and quantity/unit inputs
  are enforced. Unsupported dates, qualifications or measures withhold totals.
- All 25 SQL migrations are applied to Cante. Live signed-in historical RPC,
  idempotency, tampering rejection, RLS and public-reference reads passed.
  HTS Edge Function version 4 is deployed; chapter completion is transactional.
- 861 tests passed with Telegram credentials blank. See AUDIT_FIXES.md for
  evidence and limits. Website deployment is distinct from tariff-data coverage.

## Remaining before a reliable customer pilot

1. **Complete the tariff basis for the chosen customer.** Consolidated Section
   232 coverage must be reviewed through the assessment date. The general
   calculator still does not fully evaluate the July 24 forced-labor Section
   301 action. No review record was fabricated to unlock totals.
2. **Validate historical coverage against real entries.** The implemented
   historical basis is only HTS 3916.90.30.00 from China/Vietnam, September
   15–27, 2026, with archived Revision 19 and caller-reviewed qualifications.
   Other dates/codes, historical Section 122, exclusions and special treatment
   need their own documented basis. A difference is not a refund entitlement.
3. **Connect history to future exposure.** Historical entry snapshots correctly
   cannot be annualized; monitored annual exposure currently requires a separate
   portfolio baseline. Import-history-derived forecasting remains to implement.
4. **Prove the full customer journey.** Run authenticated browser acceptance:
   catalogue CSV → historical CSV → review → saved findings → export. Include
   duplicate, unmatched, invalid/date, zero-duty and changed-input cases, and
   compare the supported cases with customer/broker records. API/RLS tests are
   evidence for persistence, not proof of the entire browser flow.
5. **Prove monitoring and operations.** Verify a completed HTS ingestion,
   source-change → reviewed activation → recalculation → customer-visible alert,
   failure visibility and a supported worker execution/delivery path. Telegram
   and launchd are prohibited for this rollout. Semantic retrieval recall has
   not been independently established by the deployment checks.

Larger imports need job/progress handling beyond the current bounded CSV path.
Supabase also reports Auth leaked-password protection disabled. Neither a
successful deployment nor a green build establishes comprehensive duty coverage.
