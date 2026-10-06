# Test fixtures

`lulzbot-taz-bom.csv` — a real bill-of-materials sample built from LulzBot's
published, open-hardware TAZ 3D printer BOM (devel.lulzbot.com/retail_parts),
mapped to real HTS codes/countries of origin for manually exercising
`POST /api/tariff/stack/bulk` against genuine manufacturer part data instead
of invented test rows. Used during the 2026-10-06 session to find and fix a
real bug in `lib/tariff/rates.ts` (HTS statistical-breakdown rows with empty
rate strings were silently winning over their rated parent row).

Not wired into the automated test suite — it hits the live USITC HTS
service — but kept here for manual verification of future tariff-engine
changes against a real-world part list.
