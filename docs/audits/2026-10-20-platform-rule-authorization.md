# Platform tariff-rule authorization — October 20, 2026

The customer-admin → global-rule-review escalation is closed in the linked
Supabase database and working-tree API/page code. No application deployment,
commit, push, paid model request or real reviewer appointment was made.
The separate saved-report provenance, request quota and early upload-limit
findings remain open; this is not a full security clearance.

## Boundary

`private.platform_tariff_reviewers` is an explicitly provisioned reviewer list,
separate from all customer memberships. It starts empty. RLS is enabled with no
customer policies, and customer roles have no table privileges. The trusted worker
has SELECT only; it cannot appoint reviewers. Only a database administrator can
manage appointments. There is no self-service grant endpoint, tenant-admin
fallback, email-domain shortcut or JWT metadata authorization.

`is_platform_tariff_reviewer()` exposes only the authenticated caller's boolean
capability. Its SECURITY DEFINER lookup uses an empty search path and fixed schema
references; anonymous execution is revoked. The API and pages use this capability
and deny access on errors. The database repeats the check in both authenticated
review RPCs, preventing direct Data API bypass and catching revocation between
an API precheck and a review call. Identity comes from `auth.uid()`, never JSON.

The worker-only promotion and authoring-retry functions independently require the
named reviewer to be appointed. Direct customer execution remains revoked. Existing
source-read, legal-basis, narrowing, effective-date and conflict/precedence checks
are preserved. No tariff rates, existing rules or previous audit results changed.
This does not retrospectively approve the provenance of previously confirmed rules.

Applied migration: `20261021015446_platform_tariff_reviewers.sql`. The filename is
CLI-generated in UTC; the work occurred October 20 in America/New_York.

## Managing appointments

Use a trusted database-administrator connection after independently verifying the
person and their Auth user UUID. Appointments are global legal-review authority,
not ordinary customer setup. Never seed every owner/admin or enroll an account
just to make the review page visible. No privileged key belongs in the hosted app.

For example, with psql variables `reviewer_user_id` and `appointment_basis`:

```sql
insert into private.platform_tariff_reviewers(user_id, appointment_basis)
values (:'reviewer_user_id'::uuid, :'appointment_basis');

-- Revoke for subsequent operations; no JWT refresh is required.
delete from private.platform_tariff_reviewers
where user_id = :'reviewer_user_id'::uuid;
```

The API still requires an authenticated workspace. Appointed reviewers may be
ordinary members; tenant administrator status is neither necessary nor sufficient.
Until someone is explicitly appointed, all real customer accounts are denied.
Removing an appointment stops future reviews; it does not undo past approved rules.

## Verification

- Twelve actual-handler/capability regression tests pass via
  `npm run test:rule-authorization`: anonymous and all tenant roles denied without
  appointment, explicitly appointed member allowed, caller-selected reviewer IDs
  rejected, source-read validation retained, database revocation mapped to 403,
  and missing/failed/non-boolean capability responses denied.
- `supabase/tests/platform_tariff_reviewers.sql` exercises actual database roles
  in one rolled-back transaction: owner and admin in separate tenants denied
  read/confirm/reject; no customer or worker self-appointment; direct worker
  functions reject unappointed identities; forged metadata grants nothing;
  appointed member reads/promotes/rejects; reviewer attribution is retained;
  revocation takes effect and anonymous execution is denied. Only synthetic
  fixtures are touched; real customer and legal records are not used as fixtures.
- The migration plus database regression ran successfully in a preflight
  transaction and rolled back before the migration was applied. The migration
  dry run showed exactly one pending migration and skipped Vault/seeds/roles.
- The same database regression passed again after applying the migration. A fresh
  metadata query confirmed one applied migration, zero appointed reviewers, zero
  surviving fixture rules, no customer/worker INSERT privilege on appointments,
  and no authenticated EXECUTE privilege on direct worker promotion.
- All 922 existing tests and the 12 new authorization tests passed. TypeScript
  and an isolated production webpack build passed. Existing middleware/Edge runtime
  warnings remain; no build overwrote the user's active development output.
- Fresh Supabase security advisors returned four warnings: the three intentionally
  authenticated-callable SECURITY DEFINER functions (the caller-only capability
  and the two reviewer-gated RPCs), plus pre-existing disabled leaked-password
  protection. The guarded functions need privileged execution to access private
  review data without granting customers direct table writes. Their presence is
  not being presented as a clean advisor scan. No Auth setting was changed.

Implementation follows Supabase's guidance on
[function privileges and security modes](https://supabase.com/docs/guides/database/functions)
and [RLS and authorization](https://supabase.com/docs/guides/database/postgres/row-level-security).
