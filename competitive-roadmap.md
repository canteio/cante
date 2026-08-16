# Cante Competitive Roadmap

Date: 2026-08-15

## Bottom Line

Cante should not copy the full enterprise suites first. The billion-dollar
companies are big because they own workflows, proprietary data networks, or
systems of record. Cante's ambition is global, but the wedge must still be
narrow:

> Worldwide trade compliance monitoring for manufacturers, starting with
> product codes, trade lanes, and plain-language Telegram alerts.

The first sellable version should feel like Vanta for trade changes: a company
profile, continuous monitoring, country-by-country evidence trails, and a clear
answer to "does this affect our shipments?"

Indonesia remains the flagship/deepest country pack. See
`indonesia-monitor-roadmap.md` for the KBLI, OSS, SNI, tax/customs, national-law,
Perda, and living-checklist plan. Global ambition should not make the Indonesia
monitor shallow.

## Competitor Inventory

| Company | What They Sell | What Cante Should Copy |
|---|---|---|
| [GingerControl](https://gingercontrol.com/) | AI trade compliance infrastructure focused on global trade spend, duty decisions, entry/freight audit, tariff/classification workflows, and policy monitoring. | Copy the "audit layer" framing: re-check decisions, find leakage, connect compliance to money. |
| [Quickcode](https://quickcode.ai/) | AI-assisted HS/HTS classification, tariff monitoring, WCO notes, CROSS rulings, FTAs, GRIs, and product-catalog monitoring. | Copy HTS code workspace, CROSS/ruling lookup, Chapter 99/Section 301 monitoring, and 24/7 product-code alerts. |
| [Descartes](https://www.descartes.com/solutions/customs-and-regulatory-compliance) | Broad customs/regulatory compliance suite: customs declarations, cargo security, filings, denied-party screening, license determination/tracking, export classification, documentation workflows. | Copy the evidence/workflow discipline, not the full filing platform. |
| [E2open](https://www.e2open.com/blog/trade-compliance-software) | Enterprise global trade management: centralized trade content, classification, restricted-party screening, sanctions, embargoes, export controls, license management, trade agreement savings. | Copy the capability map and "centralized trade content" concept. |
| [Assent](https://www.assent.com/solutions/product-compliance/reach-compliance-solution/) | Product and supplier compliance for manufacturers: REACH, RoHS, TSCA, PFAS, supplier evidence, audit trails, historical reporting, compliance dashboards. | Copy supplier evidence collection and defensible audit trails. |
| [Altana](https://altana.ai/) | Trade network / source-of-truth platform for product value chains and proof before goods ship. | Copy "prove compliance before shipment" and product passport framing later. |
| [Onyx](https://www.onyxsi.com/trade-regulatory-monitoring/) | Trade regulatory monitoring by geography and HS code with daily alerts and continuous monitoring. | This is the closest Cante competitor. Copy the HS-code/country monitoring model, then beat it on SMB ease and Telegram workflow. |
| [Kharon](https://www.kharon.com/solutions/industries/manufacturing) | Risk intelligence for sanctions, export controls, forced labor, UFLPA, defense supply chain, entity networks, supplier tiers. | Copy risk intelligence style and entity evidence later; do not build this from scratch first. |

## What The Good Products Have In Common

1. **A profile of the customer.**
   They know products, HTS/HS codes, suppliers, countries, entities, brokers,
   facilities, and shipment patterns. Cante needs this as the first data object.

2. **Continuous monitoring.**
   They are not a one-off chatbot. They keep checking regulatory content, tariff
   schedules, sanctions, rulings, and supplier risk.

3. **Trade content that stays current across jurisdictions.**
   E2open and Descartes sell confidence that regulatory data is maintained.
   Quickcode monitors HTS, PGA data, AD/CVD, Chapter 99, exclusions, and CROSS
   rulings. Onyx monitors geographies and HS codes. Cante needs the same concept
   as country/source packs that can expand globally.

4. **Evidence trails.**
   Assent, Descartes, and Kharon all sell defensibility: what was checked, what
   evidence supports it, and what changed. Cante already has the beginning of
   this with `source_results`; double down.

5. **Plain answers, not more dashboards.**
   Tradeverifyd and GingerControl both frame around direct answers and recovered
   leakage. Cante should do the same: "this affects your shipment" or "not in
   scope, here is why."

6. **Money connection.**
   GingerControl talks about duty leakage and freight/import-entry audit.
   E2open talks about duty savings from trade agreements. Cante needs to connect
   alerts to dollars: duty exposure, delay risk, demurrage, rework, lost shipment.

7. **Human-in-the-loop trust.**
   Quickcode leans into classification experts. Cante should never pretend the
   AI is the licensed broker. It should tell the user exactly what to ask the
   broker and track the broker's response.

## Cante Positioning To Use

Global core:

> Cante watches trade-rule changes for your product codes and trade lanes across
> the countries you buy from, sell to, or ship through, then sends plain-English
> Telegram alerts before a shipment gets surprised.

For US manufacturers:

> Cante watches tariff and trade-rule changes for your HTS codes, supplier
> countries, and destination markets, then sends plain-English Telegram alerts
> before a shipment gets surprised.

For Indonesian exporters:

> Cante watches export regulation changes for your HS codes and destination
> markets, then sends plain-language Telegram/WhatsApp alerts only when something
> might affect shipments.

Do not position Cante as "AI trade compliance software" yet. That is too broad
and puts it directly against GingerControl, Quickcode, Descartes, and E2open.

Position it as:

> The daily compliance watcher for manufacturers without a trade compliance team.

The product should be global by data model, not by overclaiming coverage. Every
country/source pack needs an honest status: `live`, `beta`, `manual-assisted`,
`blocked`, or `not covered`.

## Product Requirements To Add

### P0: Company Trade Profile

This is mandatory. No profile means no compliance product.

Add fields for:

- Legal company name, facilities, country, state/city
- Products and product groups
- Product codes by jurisdiction: HS-6, HTSUS, CN/TARIC, UKGT, AHTN, local tariff
  codes, ECCN/export-control classifications where relevant
- Code records with `confirmed`, `source_document`, `jurisdiction`, and
  `confidence`
- Import/export direction per product and per trade lane
- Supplier countries, origin countries, transit countries, and customer/destination
  countries
- Brokers/forwarders and contact info
- Shipment cadence and important lanes
- Known compliance programs: REACH, RoHS, TSCA, PFAS, UFLPA, export controls
- Notes from broker/user, with human confirmation status

### P0: Telegram-First Alerting

Add Telegram as the first real delivery channel:

- Bot onboarding: `/start`, link chat to customer
- Daily/weekly alert preferences
- "Acknowledge", "forward to broker", "mark not relevant", "remind me"
- Delivery log per alert
- Human-readable alert summary plus source/evidence link

Telegram is the customer workflow. The dashboard is the archive.

### P0: Global Coverage Model

Cante must be worldwide in structure from the start. Do not add countries as
one-off code branches. Add country/source packs:

- Country or trade bloc: US, EU, UK, Canada, Mexico, China, India, Indonesia,
  Vietnam, Thailand, Malaysia, Japan, Korea, Australia, Brazil, etc.
- Source type: tariff schedule, customs notices, trade ministry regulations,
  export controls, sanctions, AD/CVD, forced labor, product compliance,
  standards, trade remedies
- Direction: import, export, transit, product-market access
- Reliability status: `live`, `beta`, `manual-assisted`, `blocked`, `unstable`,
  `not covered`
- Last successful check and last parser change
- Human-readable coverage caveat for alerts

The customer buys monitoring for lanes, not countries in the abstract:

- Import from China to US
- Export US-origin controlled goods to UAE
- Sell EU-market products with REACH/RoHS exposure
- Export from Indonesia to Japan
- Source components from Vietnam and assemble in Mexico

### P0: First Country Packs

Start with the countries needed for sales conversations, but keep the model
global:

#### United States

For Charlotte/US manufacturer sales, Cante needs US monitoring sources:

- Federal Register trade notices
- CBP Cargo Systems Messaging Service / trade updates
- USTR Section 301 / tariff actions
- USITC HTS data and change records
- Commerce AD/CVD case updates
- BIS export control / Entity List changes
- OFAC sanctions updates
- Forced labor / UFLPA entity list updates
- CROSS rulings for classification context

#### European Union

- TARIC / Combined Nomenclature changes
- EU Official Journal trade and customs notices
- REACH / RoHS / SCIP / PFAS / POPs product compliance updates
- EU sanctions and export-control changes
- EU CBAM and product-market access rules where relevant

#### United Kingdom

- UK Global Tariff changes
- HMRC customs/trade notices
- UK sanctions and export controls
- UK product compliance changes

#### Canada / Mexico

- Customs tariff updates
- Trade remedy / AD/CVD notices
- Import/export control lists
- USMCA-related changes

#### Asia Manufacturing Lanes

- China customs/tariff/export-control notices
- Vietnam, Thailand, Malaysia, Indonesia customs/trade ministry notices
- Japan/Korea customs tariff and export-control updates

Start with monitoring and citation. Do not start with customs filing. Coverage
must be honest: an alert may say "EU source pack live, Vietnam pack beta, China
pack manual-assisted."

Indonesia's pack is special: it should go deeper than trade notices by mapping
KBLI, OSS licensing status, SNI/product standards, Kemenkeu/DJBC tax-customs
rules, national legal hierarchy, and location-specific Perda into a living
compliance checklist.

### P0: Evidence Trail

Every finding must show:

- Source checked
- Fetch status
- Date/time checked
- Product/HTS/HS match reason
- What changed
- Why it may matter
- Confidence level
- Coverage caveats
- Recommended action
- User/broker disposition

This is the Vanta-like trust layer.

### P1: HTS/HS Workspace

Copy Quickcode's strongest wedge:

- Product-to-code table
- Confirmed vs unconfirmed codes
- HTS/HS lookup assistant
- Jurisdiction-specific code mappings: HS-6 to HTSUS/TARIC/CN/UKGT/local codes
- CROSS ruling search for similar products
- WCO/GRI notes as reference context
- Change monitoring per code and jurisdiction
- Flag if product description and code drift over time

Cante should not claim final classification authority. It should prepare the
broker/compliance team with evidence.

### P1: Tariff And Duty Impact

Copy GingerControl/E2open's money framing:

- Estimate tariff exposure by HTS/country
- Monitor Chapter 99 / Section 301 overlays
- Monitor AD/CVD risk
- Monitor tariffs/trade remedies by lane, not just by one country
- Track exclusions and expiration dates
- "Possible monthly exposure" field based on shipment volume
- Alert severity based on dollar impact, not just legal text

### P1: Broker Collaboration

Small manufacturers often outsource compliance to brokers. Cante should become
the coordination layer:

- Forward alert to broker
- Broker reply saved to the finding
- Mark "broker confirmed", "broker says not relevant", "needs document"
- Reminder before next shipment
- Export PDF/evidence packet

This is easier than building filings and more aligned with SMB buying behavior.

### P2: Entry / Invoice Audit

Copy GingerControl's audit-layer idea after monitoring works:

- Upload import entry CSV/PDF, commercial invoice, packing list
- Reconcile product description, HTS, country, duty rate, freight invoice
- Find mismatches and possible overpaid duty
- Store audit evidence

This is where Cante can move from "risk avoidance" to "we found money."

### P2: Supplier Evidence Collection

Copy Assent selectively:

- Supplier request links
- REACH/RoHS/TSCA/PFAS declaration status
- UFLPA country/material risk questionnaires
- Document expiration tracking
- Evidence completeness score

Do this only after the trade-rule monitor is useful. Supplier compliance can
become a second product line.

### P3: Risk Intelligence Integrations

Do not build Kharon from scratch. Integrate or partner later for:

- Restricted-party screening
- Sanctions/entity graph risk
- Forced labor supplier risk
- Defense industrial base risk
- Export-control red flags

Cante can display and route risk, but proprietary entity intelligence is a moat
that takes years to build.

### P3: Product Passport / Compliance Packet

Copy Altana/Assent language later:

- Product passport per SKU/product group
- HTS/HS, ECCN, origin, suppliers, compliance docs, risk checks
- "Ready to ship?" status
- Evidence export for customers, brokers, auditors

This is the system-of-record path.

## Global Rollout Strategy

Worldwide is the category, but coverage should roll out lane by lane. Do not
sell a black-box "we monitor the world" claim. Sell named monitored lanes with
visible coverage status.

Recommended sequencing:

1. **Lane MVP**
   One customer, one trade lane, one or two product codes, one live source pack.
   Example: China -> US for coated textiles, or Indonesia -> Japan for PVC
   tarpaulin.

2. **Top manufacturing corridors**
   US, EU, UK, Canada/Mexico, China, India, Vietnam, Indonesia, Thailand,
   Malaysia, Japan, Korea, Australia, Brazil.

3. **Regional packs**
   EU/UK, ASEAN, North America, China/Hong Kong/Taiwan, India/South Asia, LATAM.

4. **Global source marketplace**
   Each source pack is versioned, tested, and displays health. Customers can see
   exactly which countries and source categories are live.

The product promise is global monitoring, but the operational promise is honest
coverage: every alert says which jurisdictions were checked and which were not.

## What Not To Build Yet

- Customs filing
- Full ERP/TMS integration
- "All-country coverage is live" claims before source packs are actually tested
- Full denied-party screening database
- Supplier graph intelligence from scratch
- Carbon compliance
- Complex dashboards before Telegram alerts work
- Broad "AI compliance copilot" positioning

Those are enterprise-suite features. Build the wedge first.

## Cante Website Sections To Add

Copy the shape of the strong competitor sites, not their wording:

1. **Hero**
   "Global trade-rule alerts for your products before shipments get surprised."

2. **How it works**
   Add products, codes, and trade lanes -> Cante monitors country source packs
   -> Telegram alerts -> broker/customer action is tracked.

3. **What we monitor**
   Tariffs, HS/HTS/TARIC/local code changes, AD/CVD, trade remedies, export
   controls, product compliance, UFLPA/forced labor, sanctions changes, source
   availability.

4. **Evidence trail**
   Every alert shows source, reasoning, confidence, and coverage caveats.

5. **Built for small manufacturers**
   Not a full GTM implementation. No ERP required. Start with codes and trade
   lanes.

6. **Broker workflow**
   Forward to broker, save reply, close the loop.

7. **Coverage map**
   Show live/beta/manual-assisted countries and source categories. Make honesty
   part of the brand.

8. **Pricing**
   Starter, Pro, Broker/Consultant.

## Pricing Direction

Start simple:

- **Free scan**: 3 product codes, one trade lane, one-time risk review
- **Starter, $199/mo**: up to 10 product codes, 2 trade lanes, Telegram alerts,
  evidence log
- **Pro, $499/mo**: up to 50 product codes, 10 trade lanes, broker forwarding,
  weekly digest, priority source coverage
- **Broker/Consultant, $999+/mo**: multiple customer profiles, shared alerts,
  client evidence packets

Price against avoided delay and broker/compliance time, not against dashboard
features.

## Next Build Tickets

1. Add `source_packs` / `jurisdictions` / `trade_lanes` tables.
2. Add `telegram_chats` and `deliveries` tables.
3. Add `company_trade_profiles` or expand `customer_profiles` for global trade
   lane fields.
4. Add `product_codes` table instead of burying codes only in JSON.
5. Add `source_results` display inside every alert detail.
6. Add first source packs: US live, Indonesia live, EU beta.
7. Add Telegram bot webhook and send-only delivery.
8. Add Stripe customer/subscription tables.
9. Add "forward to broker" and "mark not relevant" actions.
10. Add HTS/CROSS search mode in chat, then TARIC/local-code modes.
11. Add "evidence packet" export for one alert.

## Sources Reviewed

- GingerControl: https://gingercontrol.com/
- GingerControl trade platform article: https://gingercontrol.com/blog/best-tariff-compliance-software-trade-platforms
- Quickcode: https://quickcode.ai/
- Quickcode FAQs: https://quickcode.ai/faqs/
- Quickcode 24/7 monitoring: https://quickcode.ai/introducing-24-7-trade-compliance-monitoring/
- Descartes customs and regulatory compliance: https://www.descartes.com/solutions/customs-and-regulatory-compliance
- Descartes tariff mitigation/compliance automation: https://www.descartes.com/resources/knowledge-center/trade-compliance-side-tariff-mitigation-strategies-how-automation
- E2open trade compliance software guide: https://www.e2open.com/blog/trade-compliance-software
- E2open global trade management for manufacturers/exporters: https://www.e2open.com/blog/global-trade-management-for-manufacturers-and-exporters
- Assent REACH compliance: https://www.assent.com/solutions/product-compliance/reach-compliance-solution/
- Assent TSCA compliance: https://www.assent.com/solutions/product-compliance/tsca-compliance-solution/
- Altana: https://altana.ai/
- Onyx trade regulatory monitoring: https://www.onyxsi.com/trade-regulatory-monitoring/
- Kharon manufacturing trade compliance: https://www.kharon.com/solutions/industries/manufacturing
- Kharon supply chain integrations: https://www.kharon.com/resources/article/supply-chain/strengthening-supply-chain-risk-intelligence-how-kharon-data-powers-leading-supply-chain-mapping-and-traceability-platforms
