# Import Manifest Pipeline (WIP)

Scaffold for a Cante-native alternative to paid US import-data resellers
(ImportGenius, Panjiva, Volza), built on the same public CBP ocean vessel
manifest data those products resell. Full research and legal basis:
[`docs/import-data-pipeline.md`](../../docs/import-data-pipeline.md).

## Status

- `schema/shipments.ts` — Drizzle table shape mirroring the CBP CAMIR
  manifest record layout. Not yet merged into `lib/db/schema.ts`.
- `fetch/fetch-manifests.ts` — fixed-width CAMIR record parser (M01 vessel,
  P01 port records), tested in `fetch/fetch-manifests.test.ts`. The actual
  data source (`loadRawManifestText`) is a stub — no live feed is wired up
  yet; see docs for the FOIA bulk-data path.
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
