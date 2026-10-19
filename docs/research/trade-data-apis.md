# Free Official Trade Data Interfaces

Live-verified on **16 August 2026**. This document records official interfaces
that Cante can use without paid data access. "Free" does not always mean
anonymous, licensed for commercial redistribution, stable, or sufficient for a
legal compliance decision.

## Status definitions

- **Enabled now**: an adapter is present in Cante and participates when its
  profile activation conditions are met.
- **Optional / gated**: technically usable, but requires a free credential,
  customer-specific activation, licensing confirmation, or additional product
  work.
- **Researched, not implemented**: live interface verified, but no Cante adapter
  exists yet.
- **Manual / not safe**: no supported automation contract, licensing is
  unsuitable or unclear, or the source cannot support the claimed use.

## Critical product boundaries

### Change monitoring is not party screening

A regulation, notice, or list-update feed can tell Cante that an authority
changed something. It cannot establish whether a customer, supplier, bank,
freight forwarder, owner, or end user is on a restricted-party list. Actual
screening requires the complete current lists, aliases and identifiers, local
matching, hit review, evidence retention, and repeated screening.

A no-hit list search also does **not** establish ownership clearance. OFAC's 50
Percent Rule can block unlisted entities based on direct or indirect aggregate
ownership. The free datasets do not contain a complete worldwide beneficial-
ownership graph. End use, diversion, licensing, and BIS affiliate analysis are
separate checks as well.

### Tariff lookup is not legal classification

Tariff APIs can validate a code, return hierarchy and rates, and identify
measures attached to a declared code. They do not legally classify an arbitrary
product description. Classification requires product facts, governing notes and
rules, rulings where relevant, and customer or broker approval. Cante must present
generated codes as research candidates, never final legal determinations.

## United States: tariff, rulings, and operational notices

| Interface | Authentication | Purpose | Cante status | Important limitations |
|---|---|---|---|---|
| [USITC HTS REST API](https://www.usitc.gov/documents/hts_external_guide.pdf) | None | Current HTS hierarchy, descriptions, units, duty fields, footnotes, release detection, and revision history. | **Enabled now** for release detection and profile-scoped HTS-6 searches | Search is capped at 100 results. Cante fingerprints every matching row but does not yet download the 35,791-row full export. The data cannot independently justify classification. |
| [CBP CROSS](https://rulings.cbp.gov/) | None | Search recent and historical customs rulings by recorded HTS-6 code and retain exact tariff overlaps. | **Enabled now** with full search pagination | The official site's JSON endpoints are not a published stable API contract, so schema drift fails the source visibly. CBP says the collection is not complete. Rulings are research evidence, not automatic classification. |
| [CBP CSMS RSS](https://www.cbp.gov/trade/automated/cargo-systems-messaging-service) | None | Operational customs messages, ACE behavior, tariff implementation, quotas, PGA changes, and Harmonized System updates. | **Enabled now** | Rolling feed has no historical pagination. Poll frequently; a bulletin is operational guidance, not a complete tariff or PGA dataset. |
| [USTR Section 301 product overlay](https://ustr.gov/issue-areas/enforcement/section-301-investigations/search) | None | Static Section 301 HTS mapping used by USTR's own search interface. | **Enabled now**, filtered to recorded HTS codes | Undocumented implementation asset; deleted and zero-percent rows may remain. Federal Register notices and HTS revisions remain the legal change evidence. |
| Comprehensive HTS-to-PGA applicability | No complete public interface found | Determine every Partner Government Agency and data element applicable to an import code. | **Manual / not safe** | ACE/ABI carries operational PGA flags, but there is no complete anonymous public feed. Cante must not claim comprehensive PGA automation from partial documents or sector APIs. |
| [FDA Product Code Builder API](https://www.accessdata.fda.gov/scripts/ora/pcb/apidocs/) | Free `Authorization-User` and `Authorization-Key` credentials required | Validate and navigate FDA product codes for FDA-regulated products. | **Optional / gated** | A nominal HTTP 200 may contain application return code 401, so body validation is required. It validates FDA product codes; it does not map all HTS codes to PGA requirements and does not replace FDA admissibility analysis. |

## United States: Federal Register overlays

The documented [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1)
requires no key, supports pagination through `next_page_url`, and can return
effective dates, comment deadlines, citations, PDFs, and raw text when those
fields are requested explicitly.

| Coverage | Purpose | Cante status | Important limitations |
|---|---|---|---|
| Existing EPA, OSHA, FTC, CPSC, FDA, USDA, FCC, DOT/NHTSA, BIS, Census, OFAC, CBP, and State/DDTC agency feeds | Broad federal rule and notice monitoring selected from customer profile facts. | **Enabled now** | These are agency windows, not complete normalized tariff, investigation, case, or screening inventories. Explicit `fields[]` and pagination are required. |
| USTR Section 301 query | Authoritative legal actions, exclusions, modifications, dates, and comment periods. | **Enabled now** | Incremental query is fully paginated, but full-text terms can produce false positives; judgment must read the official result. |
| BIS, ITA, and presidential Section 232 queries | Investigation, administration, and presidential action monitoring. | **Enabled now** as BIS/ITA overlays | No verified public API provides a complete normalized current Section 232 HTS scope. Combine legal notices with HTS Chapter 99 and CSMS changes. |
| ITA AD/CVD and USITC import-injury queries | Legal events for trade-remedy investigations and orders. | **Enabled now** | Event notices complement the IDS inventory but do not calculate shipment liability. |
| DHS UFLPA Entity List query | Legal notices adding or modifying forced-labor entity-list entries. | **Enabled now** | This is list-change monitoring; DHS HTML supplies the current entity inventory. |

## United States: investigations and trade remedies

| Interface | Authentication | Purpose | Cante status | Important limitations |
|---|---|---|---|---|
| [USITC IDS advanced-search API](https://ids.usitc.gov/idata/api/v1/advanced-search) | None | Current import-injury investigation state. | **Enabled now**, fully paginated | Implementation-level contract; schema drift fails visibly. The live inventory produced 1,927 entries and is controlled by the source ledger. IDS does not calculate shipment liability. |
| [USITC EDIS data service](https://www.usitc.gov/sites/default/files/press_room/documents/edis_data_web_service_guide.pdf) | Anonymous for XML metadata; bearer token/account for attachments | Investigation and public-document metadata, filing parties, dates, phases, and attachment references. | **Researched, not implemented** | Follow page numbers until empty. Anonymous metadata does not grant attachment access. It complements IDS and Federal Register; it is not a normalized current order/rate database. |
| [CBP WRO and Findings dataset](https://www.cbp.gov/document/stats/withhold-release-orders-findings) | None | Current downloadable CSV inventory of forced-labor Withhold Release Orders and Findings. | **Enabled now** with stable-page CSV discovery | Current encoding is detected as UTF-8 BOM or Windows-1252. Missing records are revisions to investigate, not automatic evidence of revocation. |
| [DHS UFLPA Entity List](https://www.dhs.gov/uflpa-entity-list) | None | Current entity names, effective dates, and statutory sublist memberships. | **Enabled now** | Server-rendered HTML, not an API. Exact list records are not ownership, alias, supply-chain, or origin clearance. |
| [DHS UFLPA strategy](https://www.dhs.gov/uflpa-strategy) | None | Strategy and annual-update document monitoring. | **Researched, not implemented** | PDF/link change monitoring only; it is not a current entity-screening dataset. |
| [CBP forced-labor RSS](https://www.cbp.gov/rss/trade/forced-labor) | None | Announcement overlay for enforcement and forced-labor developments. | **Enabled now** | Small rolling feed and occasional unrelated items. WRO/Findings and UFLPA remain the current inventories. |

## Restricted-party screening

| Interface | Authentication | Purpose | Cante status | Important limitations |
|---|---|---|---|---|
| [Trade.gov Consolidated Screening List bulk files](https://www.trade.gov/consolidated-screening-list) | None for JSON download | Broad current US listed-party dataset combining Commerce, State, and Treasury lists. | **Enabled now** for snapshot diffs and exact normalized primary/alias matching at `POST /api/screening` | Fuzzy candidate generation, persisted hit review, identifier/address scoring, ownership, and transaction clearance are not implemented. A no-hit is not a clearance. |
| Trade.gov CSL fuzzy-search API | Free developer subscription key | Hosted fuzzy search across CSL records. | **Optional / gated** | The documented host had expired TLS/routing problems during verification. Do not make it a production dependency until healthy. The keyless bulk files are preferable for reproducible local screening. |
| [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service) | None; send a User-Agent and follow redirects | Complete current SDN and consolidated non-SDN data. Advanced XML contains names, aliases, addresses, IDs, programs, and relationships suitable for actual listed-party screening. | **Researched, not implemented** | Current Cante OFAC support monitors list-change announcements only. Advanced XML should be used for screening; a single legacy `SDN.CSV` omits aliases and addresses. Matching does not solve OFAC's 50 Percent Rule or transaction-specific prohibitions. Do not automate OFAC's interactive search. |
| OFAC delta archive | None | Dated XML additions, changes, and removals for efficient list-change monitoring. | **Researched, not implemented** | Delta files monitor changes; they are not a substitute for a validated complete current SDN/non-SDN snapshot. |
| Current Cante OFAC recent-actions adapter | None | Detect new official sanctions-list update announcements. | **Enabled now** for export profiles | **Change monitoring only. It does not screen counterparties.** |
| [BIS Entity List, Unverified List, MEU List, and Denied Persons files](https://www.bis.gov/node/20522) | None | Current listed-party data for local screening with list-specific restrictions and evidence. | **Researched, not implemented** | Each list has a different legal effect. UVL is a red flag rather than an automatic prohibition; MEU is not exhaustive; DPL requires reading the controlling order; Entity List requirements vary by entry. Current Cante BIS coverage monitors rules and an EAR page heartbeat, not parties. |
| DDTC debarred parties through CSL | None | Current structured ITAR debarred-party records included in the Trade.gov bulk dataset. | **Enabled now** through exact CSL matching | No dependable standalone public DDTC API was verified. Confirm hits against the underlying DDTC/Federal Register authority. |

## United Kingdom, European Union, and Canada

| Interface | Authentication and licence | Purpose | Cante status | Important limitations |
|---|---|---|---|---|
| [UK Trade Tariff API](https://www.api.gov.uk/hmrc/gov-uk-trade-tariff-api/) | Current production commodity requests work without authentication. Open Government Licence v3 permits reuse with attribution. A staging developer portal is introducing key management. | Current commodity hierarchy, declarability, duty and VAT measures, quotas, origin-specific measures, controls, and certificate requirements. | **Researched, not implemented** | Best next non-US tariff adapter, but operational API policy may evolve. It validates declared commodity codes and measures; it does not legally classify a product description. Preserve validity dates and origin context. |
| [EU TARIC](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en) | Public HTML interface; no documented public JSON API. EU site material is generally CC BY 4.0 unless otherwise marked. | Current CN/TARIC codes, MFN/preferential duties, quotas, anti-dumping, safeguards, restrictions, and document codes. Data is sent to national customs administrations daily. | **Manual / not safe for production automation yet** | A current official bulk-data link returned 404 and the HTML interface is not a supported API contract. TARIC excludes national VAT and excise, and only the Official Journal/EUR-Lex legal text has formal effect. Do not reverse-engineer Access2Markets as a substitute. |
| Access2Markets | Public interactive portal; no supported public API verified. Database content has additional copyright/geographic restrictions. | Manual tariff, origin-rule, and procedure research. | **Manual / not safe** | Not a reliable or clearly licensed automation dependency. |
| [Canada CBSA Customs Tariff](https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/menu-eng.html) | No key; official chapter pages and full Microsoft Access ZIP are downloadable. Commercial redistribution requires written CBSA permission. | Current Canadian tariff schedule, country treatments, and classification hierarchy. | **Optional / gated by licensing** | Technically straightforward, but Cante should not commercially process or redistribute it before written permission. Amendments and Customs Notices must be monitored in addition to annual files. Lookup is not legal classification. |

## Multilateral and statistical sources

| Interface | Authentication and licence | Purpose | Cante status | Important limitations |
|---|---|---|---|---|
| [WTO API portal](https://apiportal.wto.org/) | Free subscription key; free limits observed at 10,000 calls/hour with one timeseries request/second. WTO tariff datasets carry dissemination restrictions. | Official reported applied/bound tariff history and comparative analysis. | **Optional / gated by key and licence review** | Member data can lag and is not a live national duty engine. Do not redistribute for commercial advantage without confirming applicable terms. |
| [WITS / UNCTAD TRAINS SDMX API](https://wits.worldbank.org/witsapiintro.aspx?lang=en) | No key for the public SDMX API. Terms restrict commercial exploitation and redistribution through another tool without permission. | HS-6 MFN/preferential averages, minimums, maximums, and historical analysis. | **Manual / not safe for commercial integration without permission** | Annual, country-dependent, aggregated, and often lagged. It cannot determine the legally applicable duty for a shipment. |
| [UN Comtrade](https://comtradeplus.un.org/) | Public preview; free registration offers broader quotas. Licence restricts automated downloading and commercial exploitation without written permission. | Trade-flow statistics: values, quantities, weights, partners, and reported product codes. | **Manual / not safe for commercial integration without permission** | Statistical data only. It contains no legally applicable tariff rate and cannot establish classification or compliance. |
| [ASEAN Tariff Finder](https://tariff-finder.asean.org/) and [ASEAN Trade Repository](https://atr.asean.org/index.php/read/tariff-nomenclature/39) | Public HTML; no supported API, bulk feed, or reusable commercial-data licence verified. | AHTN navigation, indicative preferential rates, origin-rule and national-repository research. | **Manual / not safe** | Tariff Finder states its data has no official or legal status. Final rates and measures must come from each member's national authority. AHTN 2022 is current while AHTN 2028 is under review. |

## Recommended implementation order

Implemented items are retained here to show sequencing; unchecked items remain backlog:

1. **Done:** profile-scoped USITC HTS, CROSS, CSMS, targeted Federal Register,
   USITC IDS, WRO/Findings, UFLPA, USTR, and exact CSL matching.
2. Add EDIS metadata where IDS lacks public-document context.
3. Add persisted CSL hit-review cases and fuzzy candidate generation.
4. Add higher-fidelity OFAC Advanced XML and list-specific BIS ingestion.
5. Add UK Trade Tariff as the first non-US tariff adapter.
6. Add FDA Product Code Builder only after free credentials and an applicable
   customer product profile exist.

EU TARIC, Canada, WTO, WITS, UN Comtrade, and ASEAN sources remain gated or
manual until their supported machine interface and commercial-use rights are
clear enough for Cante's paid product. No source in this document removes the
need for human confirmation of classification, sanctions hits, ownership,
licenses, end use, or shipment-specific duty treatment.
