# Indonesia Monitor Roadmap

Date: 2026-08-15

## Goal

Indonesia should be Cante's flagship country pack, not a shallow example. The
global product can expand country by country, but Indonesia should become the
best-in-class monitor for:

- compliance Indonesia
- regulatory change
- law change
- KBLI-based business licensing obligations
- product/HS-code trade obligations
- OSS licensing status
- SNI/product-standard obligations
- tax/customs/perpajakan changes
- regional/perda changes where the company operates

The core promise:

> Tell Cante your KBLI, HS codes, products, facilities, and trade lanes. Cante
> continuously maps them to Indonesian laws, licenses, standards, taxes, and
> export/import rules, then keeps a living checklist updated as rules or company
> facts change.

## Why Indonesia Needs A Deeper Product

For Indonesia, HS-code export monitoring is not enough. A manufacturer can be
affected by:

- KBLI and OSS risk-based licensing requirements
- NIB and business licensing status
- PB-UMKU / supporting business licenses
- SNI obligations for products sold in Indonesia
- trade ministry export/import rules
- tax and customs regulations from Kemenkeu / DJBC / DJP
- national hierarchy changes: UU, PP, Perpres, Kepres, Permen, Kepmen
- provincial/city/regency Perda and Perkada
- sector-specific ministry rules

Cante should become the software that connects these scattered rules to the
company's actual operating facts.

## Indonesia Data Model

### Company Facts

Add structured fields for:

- Legal entity name
- NIB
- NPWP
- OSS account/contact
- Facilities and addresses
- Province/city/regency
- Business activities
- KBLI codes, version, title, and confirmation source
- OSS risk level per KBLI
- Products/product groups
- HS codes and confirmation source
- Export/import direction
- Destination/source countries
- Required licenses, certificates, and permits
- SNI requirements and certificate status
- Tax/customs registrations
- Broker/PPJK/contact persons

Every field needs:

- `confirmed`: boolean
- `source`: user, document, OSS lookup, broker, web, model inference
- `confidence`
- `last_verified_at`
- `needs_human_review`

### KBLI Records

KBLI should be first-class, not a note in memory:

- `kbli_code`
- `kbli_version` such as KBLI 2020 / KBLI 2025
- `description`
- `risk_level`
- `oss_license_type`
- `required_certificates`
- `sector_ministry`
- `local_government_touchpoints`
- `last_checked_at`
- `status`: confirmed, unconfirmed, needs migration, obsolete

The current OSS ecosystem is changing because KBLI 2025 is being introduced.
Cante should track whether a company is still on an old KBLI mapping and whether
OSS requirements changed.

## Regulatory Graph

Cante needs a graph-like layer:

```text
Company -> KBLI -> risk level -> OSS obligations -> licenses/checklist
Company -> HS code -> trade rules -> export/import obligations
Product -> SNI standard -> certificate status -> renewal/audit checklist
Facility location -> Perda/Perkada -> local obligations
Trade lane -> customs/tax/export/import regulations -> shipment checklist
```

This graph is what makes the monitor smarter over time. Chat/memory updates
should not merely save notes; they should update the graph and regenerate the
checklist.

## Source Packs For Indonesia

### P0: Existing Working Trade Source

- JDIH Kemendag regulation list
- JDIH Kemendag export category
- JDIH Kemendag licensing category

Use for:

- Permendag
- Kepmendag
- export/import policy changes
- licensing changes
- HS-code-linked trade rules

### P0: National Legal Hierarchy

Use `peraturan.go.id` and JDIH sources for:

- UU
- Perppu
- PP
- Perpres
- Kepres, where available
- ministerial regulations

Monitor for terms connected to the company's KBLI, products, industry, licensing,
tax, customs, export/import, and regional operations.

Important: do not assume the national source is always reachable. Record source
health separately from relevance.

### P0: OSS / KBLI / Licensing

Use OSS as the primary concept source for:

- NIB lookup where available
- KBLI transition news
- risk-based licensing status
- licensing requirements tied to business activities
- PB-UMKU / supporting business activity licenses

If direct automated OSS lookup is unavailable or gated, make this
`manual-assisted` and let the user upload/export OSS data.

### P0: Kemenkeu / Customs / Tax

Use JDIH Kemenkeu and DJBC sources for:

- PMK
- PER-BC / customs director general regulations
- bea masuk / tariffs
- cukai
- import/export tax provisions
- AD/CVD and safeguard duties
- customs procedure changes

This matters even for exporters because tax/customs rules can affect documents,
refunds, bonded-zone treatment, and shipping procedures.

### P1: BSN / SNI

Use BSN sources for:

- SNI catalogue
- mandatory SNI status
- SNI product/certificate lookup where available
- standard changes
- certification renewal/audit obligations

For products sold domestically or imported into Indonesia, SNI can be a market
access requirement. For exporters, SNI may matter when the product is also sold
locally, used in procurement, or tied to customer quality requirements.

### P1: Regional Law

Perda is hard but important. Model it by location:

- province
- city/regency
- industrial estate if relevant

Start with the customer's actual operating location. For MA, that means
Surabaya / East Java before all of Indonesia.

Source types:

- provincial JDIH
- city/regency JDIH
- local tax/retribution rules
- environmental/industrial permits
- warehouse/factory local requirements

### P2: Sector Ministry Packs

Add only when the customer's KBLI requires it:

- Kemenperin
- KLHK / environmental
- BPOM for food/cosmetics/health products
- Kominfo for telecom/electronics
- ESDM for energy/mining
- Ministry of Agriculture / quarantine where relevant

## Living Compliance Checklist

This is the key product feature.

Every customer gets a living checklist generated from the regulatory graph:

```text
Checklist Item
- title
- why it applies
- linked facts: KBLI, HS code, product, location, trade lane
- linked rules
- status: unknown, required, not_required, completed, expiring, blocked
- owner: user, broker, Cante, consultant
- evidence required
- due date / renewal date
- last checked
- source health
- confidence
- open questions
```

Examples:

- Confirm MA's real KBLI from OSS/NIB.
- Confirm whether KBLI transition to KBLI 2025 changes OSS license status.
- Verify whether PVC tarpaulin product line has any mandatory SNI exposure.
- Check whether Surabaya/East Java Perda adds local industrial/environmental
  obligations.
- Check whether Permendag 12/2026 annex touches the confirmed HS codes.
- Confirm PPJK response on KMK/BC restricted-export annex.

## Chat And Memory Must Update The Checklist

Memory cannot just be passive context. When chat updates memory, Cante must run a
checklist refresh.

Flow:

1. User says something in chat.
2. Memory extraction identifies durable facts.
3. New facts are stored as unconfirmed unless user manually confirms.
4. Cante recalculates affected checklist items.
5. If the fact changes regulatory scope, Cante queues a targeted follow-up check.
6. UI/Telegram shows "new information changed your checklist."

Examples:

- User adds a new KBLI -> regenerate OSS/license checklist.
- User confirms an HS code -> rerun trade-source relevance against that code.
- User says they sell domestically too -> add SNI/product compliance checks.
- User gives Surabaya factory address -> add East Java/Surabaya Perda monitoring.
- User uploads OSS/NIB export -> promote KBLI and licensing facts to confirmed.

## Daily Check Should Use The Checklist

The daily check should not ask "what changed?" in isolation. It should use the
current checklist and regulatory graph:

```text
For each customer:
  load confirmed + unconfirmed facts
  load checklist
  identify source packs needed today
  fetch/check sources
  match new rules to KBLI, HS, products, location, tax/customs, SNI
  update checklist item statuses
  create alert only when something changed or needs action
```

This is how Cante becomes smarter from chat and memory.

## Alert Format For Indonesia

Alerts should say:

- Apa yang berubah
- Kenapa mungkin relevan
- Dasarnya apa: KBLI / HS / SNI / lokasi / pajak / OSS
- Sumber yang dicek
- Sumber yang gagal/terbatas
- Checklist item yang berubah
- Apa yang harus ditanya ke PPJK/konsultan/OSS/admin
- Tingkat urgensi

Example:

```text
Ada perubahan aturan kepabeanan dari Kemenkeu yang mungkin perlu dicek karena
berhubungan dengan ekspor/impor barang kiriman. Ini belum otomatis berarti
berdampak ke PVC tarpaulin, tapi checklist "cek aturan kepabeanan untuk HS
terkonfirmasi" berubah dari quiet menjadi needs_review.

Tindakan: minta PPJK cek apakah aturan ini menyentuh HS 5903.10 / 6306.19.90.
```

## Build Sequence

1. Promote KBLI into first-class schema.
2. Add checklist table and checklist item statuses.
3. Add memory-to-checklist refresh after chat extraction.
4. Add OSS/KBLI source pack as manual-assisted first.
5. Add Kemenkeu/DJBC source pack.
6. Add BSN/SNI source pack.
7. Add Perda source pack for Surabaya/East Java.
8. Add UI page for checklist.
9. Add Telegram alert when checklist changes.
10. Add document upload for OSS/NIB/PEB/invoice/SNI certificate.

## Sources Reviewed

- OSS official portal: https://oss.go.id/en
- Peraturan.go.id official regulation database: https://peraturan.go.id/
- Peraturan.go.id regulation types: https://peraturan.go.id/jenis
- JDIH Kemendag: https://jdih.kemendag.go.id/
- JDIH Kemendag regulation list: https://jdih.kemendag.go.id/peraturan
- JDIH Kemenkeu: https://jdih.kemenkeu.go.id/
- BSN SNI catalogue: https://pesta.bsn.go.id/
- BSN SNI product catalogue: https://pesta.bsn.go.id/produk
