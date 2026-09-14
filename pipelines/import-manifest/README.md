# Import Manifest Pipeline (WIP)

Scaffold for a Cante-native alternative to paid US import-data resellers
(ImportGenius, Panjiva, Volza), built on the same public CBP ocean vessel
manifest data those products resell. Full research and legal basis:
[`docs/import-data-pipeline.md`](../../docs/import-data-pipeline.md).

## Status

- `schema/shipments.ts` — Drizzle table shape mirroring the CBP CAMIR
  manifest record layout. Not yet merged into `lib/db/schema.ts`. Exports
  `ImportShipmentRow` for typing pure-logic modules without a live DB.
- `fetch/fetch-manifests.ts` — fixed-width CAMIR record parser (M01 vessel,
  P01 port records), tested in `fetch/fetch-manifests.test.ts`. The actual
  data source (`loadRawManifestText`) is a stub — no live feed is wired up
  yet; see docs for the FOIA bulk-data path.
- `match/match-shipment-recalls.ts` — step 2: scores a shipment's cargo
  description against live CPSC recall entries via token overlap.
- `search/search-shipments.ts` — step 3: `queryShipments()`, a pure filter
  function over shipment rows (shipperCountryCode, hsChapter, cargo/consignee
  substring match, redaction exclusion). Not yet backed by a real DB query —
  same "no live feed yet" blocker as fetch/match.
- `search/load-live-recalls.ts` — bridges `queryShipmentsWithRecallMatches()`
  to Cante's EXISTING live CPSC recall feed (`lib/sources/registry.ts`
  `us-cpsc-recalls`), so the *recalls* half of step 3's data-source gap is
  already closed — only the manifest/shipment side (step 1) is still
  blocked. Split into a pure `findCpscRecallSource()` (unit-tested) and a
  thin `loadLiveCpscRecalls()` network wrapper.
- `scripts/` — reserved for future CLI entry points (e.g. a one-shot import
  of a delivered manifest export file).

## Run the tests

```
npx tsx --test pipelines/import-manifest/fetch/fetch-manifests.test.ts
```

## Multi-run project

This is built incrementally across scheduled Engineering runs — see git log
for `pipelines/import-manifest/` for progress. Do not delete this scaffold;
extend it.
