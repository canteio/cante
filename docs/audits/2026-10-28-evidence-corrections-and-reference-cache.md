# Evidence corrections and reference projection cache

October 28, 2026. Historical audit engine v32; selected local acceptance complete.
This does not establish full historical coverage or a deployed release.

## Changes

`app/api/audits/engine.ts` invalidates previously confirmed AD/CVD scope,
party, instructions and complete-case facts after changes to HTS, origin or
order roots unless the same dated decision explicitly renews them. Changes to
party, company case or payment stage invalidate the relevant identity/instruction
facts. Removing declared cases requires an explicit new no-AD/CVD decision;
the original import checkbox cannot supply it. Original declarations, decisions
and prior calculation results remain immutable.

`app/api/tariff/references/adcvd-history.ts` returns structured problems alongside
legacy reason strings. The engine and readiness service distinguish missing
shipment details, supporting evidence, historical originals and unsupported rule
interpretation. A missing exporter does not also claim that historical law is
missing. Unsupported assessment, conflicting instructions and incomplete scope
continue to withhold amounts.

`app/api/audits/store.ts` caches complete supported Chapter 99 projections per
execution, keyed by original source ID, byte hash and parser version. Defensive
copies prevent callers from altering cached evidence. Failed, empty, incomplete,
aborted or invalid projections are never cached. This shares the existing 4 MiB
PDF cache budget; it adds no global/cross-tenant cache, memory allowance or quota.
A complete parser projection does not establish complete legal coverage.

## Verification boundaries

234 historical tests and TypeScript pass. Isolated website and bundled worker
builds, protected-worker recovery checks and idle scheduler checks pass.
Read-only testing against 101 retained official sources covers 100 explicitly
fictional shipments: 81 calculate after fictional fact decisions, a hypothetical
classification correction withholds one (80), and explicit restoration with
renewed evidence restores it (81). Four Chapter 99 projection cache entries use
1,407,863 total PDF-cache bytes. No source imports, model calls, approvals or
customer-data changes occur in that read-only test.

Real isolated Auth/database/worker/browser acceptance passes using actual
preserved v31 and current v32 bundles with the same 101 pinned sources. Old v31
retains its hypothetical corrected-classification amount; v32 withholds that
line until the browser restores the original code and renews all four facts.
Final three explicitly reviewed lines calculate; 97 intentionally unreviewed
controls stay open. This is distinct from the 81-reviewed read-only oracle.

The restored fictional entry retains declared HTS 7214200000 and paid USD 821.91;
expected USD 820.91 comprises deposit USD 320.66 and steel USD 500.25. The deposit
instruction legally applies from 2025-09-04; calculation coverage is the entry
interval 2025-10-01 through 2025-10-02 exclusive. Four protected snapshots at DB
revisions 0/5/6/7 use engines 31/31/32/32. All 100 output hashes per snapshot,
ordered hashes, original declarations, 100 browser-export amounts and fourteen
older saved result sets verify. Foreign API, direct/RPC and export reads remain
denied. No claim of a new regulatory price change is made for this software fix.

Browser signed out before cleanup; the resulting already-revoked-token warning
was independently checked. SQL confirms 98 banned fixture identities, zero active
fixtures and zero sessions. Owned tab 49 and ports 3132/3133 close; existing main
server PID 24938 on port 3000 remains. No schema/grant/quota/schedule/approval or
deployment change. Current worker SHA256:
`38d2a5a0aafe29b4ebddb151baea932ba589887d074fa2d256f893ea71c7ede5`.
Local verification logs and proofs are under `/tmp/cante-v32-*`; the isolated
website build is `/var/folders/17/b2b44j1956zd0z7nlqdrq0cr0000gp/T/cante-guard-build-25x2e7lm`.
 Broader country,
preference, other Section 232, AD/CVD assessment and special-entry gaps remain in
the [completion ledger](../plans/historical-coverage-completion.md).
