# Cante

A trade-compliance dashboard for saved products, tariff calculations, and regulatory changes. Results show their sources and missing evidence; unsupported duties stay unresolved.

## Start here

- [Current product status](docs/product/status.md) — what is built and what still blocks the MVP.
- [Documentation index](docs/README.md) — all guides, plans, research, and audits.
- [Local setup and deployment](docs/operations/supabase-vercel.md) — authentication, database setup, and hosting boundaries.
- [Handoff](HANDOFF.md) — current working constraints.

## Run locally

Use Node 22+. Configure `.env` using the [runbook](docs/operations/supabase-vercel.md), then:

```sh
npm install
npm run dev
```

Open [Ask Cante](http://localhost:3000/chat) for the beagle chat companion, or the [tariff dashboard](http://localhost:3000/tariff). The app uses your signed-in workspace. Seeding or importing demo products writes data; neither is required to start the server.

Chat explicitly uses the hosted API and requires a configured API key. Other worker calls retain the `CANTE_LLM=api` opt-in. A checking worker must be connected before **Check for changes** can run. No new schedules or delivery channels are enabled by these instructions.

## Live checks and history

In [Ask Cante](http://localhost:3000/chat), attach files up to **15 MiB each**:
CSV, text-based PDF, Word (`.docx`) or Excel (`.xlsx`, `.xlsm`). Originals are saved
privately when attached; removing a message attachment does not delete that original.
Clear product tables can run the deterministic live check immediately. Confirm
unclear columns first, or choose **Ask about this file instead**. Customs values
must be USD; retail prices are not assumed to be customs values.

Files upload in 1 MiB chunks. Chat receives a reference and bounded excerpts,
rather than sending the entire file to the model. Checks support 100 product groups
or 6,000 historical entry rows. Scanned PDFs need OCR elsewhere; old `.doc`/`.xls`
files need conversion. The separate legacy live-check page still limits CSVs to
1 MB. [Intake and verification](docs/audits/2026-10-20-chat-file-intake.md).

Use the [CSV template](public/examples/live-check-template.csv) for supported
columns. File-only checks do not require an LLM response. This does not enable
scheduled monitoring or establish full legal coverage.

After saving a CSV, ask **“Any news today?”**, **“Any updates?”** or
**“Have tariffs changed?”** to run a fresh official-source tariff check against
the latest saved workspace CSV. Cante saves a new report, compares duties only
when inputs/facts match and a protected worker attestation verifies the saved
baseline, and separates today's tariff headlines from confirmed
product impacts. No saved CSV means it asks for one instead of substituting data.

[Live check](http://localhost:3000/tariff/demo) fetches current official tariff
sources and calculates supported duties. Accepted checks automatically save the
original CSV, confirmations, source evidence and result. [Check history](http://localhost:3000/tariff/history)
retains original results and appended review decisions. Unattested saved totals
are withheld from chat/comparisons and metric displays; original CSVs remain
available for fresh checks. A trusted verifier worker is not connected yet. Checks also retain and compare the immediately previous published tariff version,
including bounded legal-note changes and linked amendments. This is not a complete
backfill of historical laws or automatic historical liability determination.

## Fictional workflow demo

Open [the equipment demo](http://localhost:3000/tariff/demo/simulation) to upload 50 fictional
products, select a simulated regulation, calculate annual impact, export a report
and ask chat about the result. The labelled demo is isolated from real workspace
products and uses deterministic arithmetic. [Data and methodology](public/examples/equipment-demo/README.md).

## Test data

- [Prusa catalogue and 20-row estimated scenario](scripts/test-fixtures/prusa-public/README.md).
- [LulzBot public research](scripts/test-fixtures/lulzbot-public-research/README.md).
- [Historical demo fixtures](scripts/test-fixtures/README.md).

Public catalogues are not customs ledgers. Estimated classifications and shipment facts are test assumptions.

## Verify code changes

```sh
npm test
npx tsc --noEmit
npm run build
```

The [older README](docs/archive/legacy-readme.md) is preserved as historical context. Legacy application code, including `/chat`, remains in the repository.
