# Explicit Data API grants — October 23, 2026

Supabase stops automatically granting API access to newly created `public`
tables on October 30. Existing objects retain their permissions. Grants decide
whether a role can reach a table; RLS still decides which rows it may access.
[Official notice](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Finding and fix

The live project has 67 public tables. All existing worker permissions are
present, but 37 tables in four older creation migrations depended on Supabase's
automatic `service_role` grants. A fresh rebuild after the change would lose
that worker access. The authenticated/anonymous decisions in these migrations
were already explicit. Later audit, upload, reference and monitor migrations
have their own role/column restrictions and were not broadened.

The four creating migrations now explicitly grant worker SELECT, INSERT, UPDATE
and DELETE on their named tables. The original schema also grants USAGE/SELECT
on `document_chunks_id_seq` to the worker. These are limited to named existing
tables; no blanket default privileges, anonymous grants or browser grants were
added. Waitlist storage is intentionally accessed through its owner-executed
RPC rather than requiring direct service table access on a fresh installation.

Applied compatibility migration:
`20261023165515_explicit_data_api_worker_grants.sql`.
It gives deployed projects the same explicit declarations. Since the live
worker already had these permissions, its effective access did not expand.
No RLS policy, application route, customer record, Vault secret, schedule or
deployment changed. Future migrations must include explicit minimal grants;
the standing agent instructions now state this.

## Verification

- An isolated PostgreSQL instance replayed the four affected creation migrations
  with automatic table/sequence grants disabled. Worker CRUD and sequence access
  worked on all 37 tables.
- A negative control removed those grants and detected all 37 missing worker
  reads. Applying the corrective migration restored permissions; applying it
  again was harmless.
- Local two-company fixtures verified own-product read/update, blocked foreign
  reads/updates and rejected anonymous product access.
- This was a real PostgreSQL permission/constraint/RLS test. pgvector declarations
  alone were substituted with text because the local installation lacks that
  extension. It is not described as a complete Supabase reset or vector test.
- Metadata-only before/after comparison of all 67 live tables found identical
  effective CRUD permissions for `anon`, `authenticated` and `service_role`, and
  identical RLS enablement. No customer rows were read for this comparison.
- Real Data API `limit(0)` requests succeeded under the worker for eight critical
  tables and rejected anonymous access. These read no customer rows and wrote
  none.
- Security Advisor comparison showed no new findings. Ten earlier findings
  remain outside this permissions-compatibility change; this is not a claim of
  a clean security audit.
- Final migration dry run reported up to date; no pending migrations or seeds.

Reproduce the isolated check with an installed PostgreSQL binary directory:

```sh
npm run verify:data-api-grants -- --postgres-bin=/absolute/postgresql/bin
```

The test creates and stops its own local server using a private Unix socket,
removes its synthetic cluster, and never resets or writes to remote Supabase.
Raw metadata snapshots and advisor outputs remain outside Git.
