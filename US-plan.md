# Cante USA Plan

## Implementation Status — Deeper Source Pass 2026-08-15

The product foundation in this plan is implemented locally:

- Structured US jurisdiction profile for facilities, NAICS, products/SKUs,
  materials, processes, waste, distribution states, claims, HTS/Schedule B,
  ECCN/EAR99, export countries, and regulated-product flags.
- Country-scoped checks, conversations, memories, and checklist rows.
- Harvey-style ID/US selector inside the chat composer, plus matching controls
  on Checks, Checklist, Profile, and Memory.
- Agency-specific Federal Register feeds for EPA, OSHA, FTC, CPSC, FDA, USDA,
  FCC, DOT/NHTSA, BIS, Census, OFAC, CBP, and State/DDTC, so one agency cannot
  crowd another out of a broad result window.
- Profile-driven eCFR titles plus OSHA RSS, the structured CPSC Recall API, and
  structured OFAC sanctions-list actions.
- Real North Carolina adapters for the NC Register, DEQ releases, air rule and
  permit notices, NCDOL updates, NCDOR notices, and Charlotte/Mecklenburg air
  permit comment notices.
- Official state-register adapters for California, New York, and Texas,
  activated only by recorded facility/distribution states.
- Source activation from profile facts and human-confirmed Memory. Unconfirmed
  chat leads never turn on a source. Missing facts and unsupported states become
  deterministic coverage caveats in the final alert.
- Seventeen generated US checklist rows spanning domestic manufacturing,
  distribution, and exports, with the status vocabulary below.
- US-specific chat and judgment prompts that separate stored monitor evidence
  from fresh web research and separate proposed rules from current duties.

Initial adapter verification was run without creating an alert:

- All 13 agency-specific Federal Register queries succeeded.
- CPSC parsed 30 recent recalls and OFAC parsed 10 list updates.
- NC Register parsed 12 issues; NC DEQ 15 releases; NC air 3 open notices;
  NCDOL 10 updates; NCDOR 11 updates.
- CA, NY, and TX parsed 2, 1, and 1 current register issues.
- Mecklenburg had no open permit rows and was reported as a validated empty
  listing, not a broken parser.
- The empty-profile baseline selected 7 general federal sources and fetched 37
  deduplicated entries with zero failures. A fully populated synthetic profile
  selected 35 source rows and disclosed Florida as manual-assisted.

The first evidence-grounded US judgment run still requires a real pilot profile.
Only NC, CA, NY, and TX currently have state-register automation, and a general
register does not equal complete EPR, PFAS, packaging, tax, consumer, permit, or
product-rule coverage. Restricted-party screening, ECCN classification, AES
determination, and ITAR jurisdiction workflows are not built; Cante monitors
their official changes and keeps the transaction-specific work as evidence gaps.

Current end-to-end reference run: `2405fb73-d714-4f2d-804b-ce6c4ddfe3be`.
The empty profile selected seven baseline sources; all succeeded and fetched 37
entries. Judgment returned 21 new verdicts, matched 16 earlier exact URLs, left
0 unaccounted, appended all four profile-gating caveats, and explicitly refused
to infer EAR99. Federal Register detail-page access was blocked during judgment
and the alert disclosed that limitation.

Historical pre-depth reference run: `47c65faf-1b70-4313-9a0d-153126127b8f` — 17 source
rows succeeded, 44 entries fetched, 1 newly judged, 43 exact-URL prior matches,
and 0 unaccounted. The alert was English and kept missing company facts visible;
it predates the source adapters above.

## Positioning

Cante USA is a compliance monitor for manufacturers and distributors that maps a
company's products, facility, NAICS, materials, labels, distribution states, and
export lanes against federal, state, local, and trade rules. It keeps a living
checklist and alerts only when something relevant changes.

The U.S. version should cover both domestic manufacturing/distribution and
exports, but the product should keep them as separate coverage tracks so it stays
honest about what was actually checked.

## Core Idea

For Indonesia, KBLI is the key business-activity anchor. The U.S. equivalent is
not one code. It is a bundle:

- NAICS code: business activity.
- Facility address: state/local OSHA, environmental, permitting, tax, and zoning
  exposure.
- Product category: CPSC, FDA, USDA, FCC, DOT, EPA, FTC, or sector-specific
  rules.
- Materials/chemicals/SDS: EPA TSCA, RCRA, hazmat, state chemical rules.
- Labels and claims: FTC, Made in USA, green claims, safety warnings, origin
  claims.
- Distribution states: sales/use tax, product labeling, environmental, EPR,
  packaging, battery, PFAS, and state consumer rules.
- Export profile: HTS/Schedule B, ECCN/EAR99, destination countries, end users,
  and end use.

So the build sequence should be: domestic manufacturing/distribution first as
the core, exports as a module from day one.

## Phase 1: U.S. Company Profile

Add a U.S. customer profile model:

- Company legal name
- Facility address
- NAICS codes
- Products/SKUs
- Materials and chemicals used
- Manufacturing processes
- Waste streams
- Distribution states
- Product labels and marketing claims
- HTS/Schedule B codes
- ECCN/EAR99
- Export countries
- Regulated product flags: food, device, drug, cosmetic, chemical, consumer
  product, electronics, textile, automotive, aerospace, defense

This is the U.S. truth base. Without it, the monitor is only generic legal news.

## Phase 2: Domestic Manufacturing Monitor

Start with general manufacturers and distributors.

Federal source packs:

- Federal Register: new proposed/final rules. Public API, no key.
- eCFR: current CFR text and recent changes. Public API.
- OSHA: workplace safety standards and updates.
- EPA: TSCA, RCRA, Clean Air, Clean Water, hazardous waste, chemical reporting.
- FTC: Made in USA, green claims, advertising, labeling.
- CPSC: consumer product safety, certificates, testing, recalls.
- FDA/USDA/FCC/DOT: only when the product category requires it.

North Carolina / Charlotte starter pack:

- NC OSH / NC Department of Labor: state workplace safety.
- NC DEQ: environmental permits.
- Mecklenburg County Air Quality: local air permitting.
- NCDOR: sales/use tax and manufacturing exemptions.

## Phase 3: Distribution Monitor

Distribution is not just shipping. It includes:

- State-by-state sales/use tax exposure
- Product labeling rules
- Warranty, returns, and consumer protection
- State environmental rules
- EPR, packaging, batteries, PFAS, and chemical restrictions
- Warehouse safety
- Hazmat storage/transport if relevant
- Online sales claims and Made in USA claims

This should become a distribution-states checklist. If a company sells into CA,
NY, TX, NC, or any other state, Cante adds state-specific monitoring.

## Phase 4: Export Monitor

Export should be built in parallel but kept separate from domestic compliance.

Export source packs:

- BIS / EAR / CCL: ECCN, EAR99, license requirements.
- BIS Federal Register notices: export control changes.
- Census / FTR / AES: EEI filing and AES requirements.
- OFAC: sanctions, blocked parties, embargoed destinations.
- DDTC / ITAR: only if defense, space, military, or controlled technical items.
- CBP: export enforcement, port/process updates.
- Trade.gov: exporter guidance.
- Product-specific export certificates: FDA, USDA, APHIS, depending on product.

The export checklist should ask:

- What is the ECCN?
- Is it EAR99?
- What countries are involved?
- Any restricted party, end-use, or sanctions risk?
- Is AES required?
- Are license exceptions available?
- Are export documents using the correct classification?

## Phase 5: U.S. Checklist

The U.S. main screen should generate rows like:

- Confirm NAICS
- Confirm facility address
- Confirm product category
- Confirm materials/SDS
- Confirm waste streams
- OSHA applicability
- EPA TSCA/RCRA applicability
- Air/water/waste permits
- Product safety/testing/certificates
- FTC/Made in USA/label claims
- Distribution states
- Export classification: HTS/Schedule B
- Export classification: ECCN/EAR99
- AES filing requirement
- OFAC/end-user screening
- ITAR risk check

Each row needs status:

- `verified`
- `needs_evidence`
- `monitored`
- `not_applicable`
- `source_failed`
- `requires_expert_review`

## Phase 6: First U.S. MVP

For a Charlotte manufacturer, build this first:

1. Federal Register + eCFR monitor.
2. OSHA + NC OSH.
3. EPA TSCA/RCRA + NC DEQ + Mecklenburg Air Quality.
4. FTC Made in USA / labeling.
5. CPSC if consumer product.
6. BIS/EAR + Census AES for exports.

That gives domestic plus export coverage without pretending every regulated
industry is solved on day one.

## Product Pitch

Cante watches the rules that affect your factory, products, labels,
distribution states, and export lanes. It turns federal, state, local, and trade
compliance changes into a living checklist and plain-English alerts, so small
manufacturers know what changed and what evidence they need without hiring a
compliance team.

## Initial Official Sources

- Federal Register API: https://www.federalregister.gov/developers/documentation/api/v1
- eCFR API: https://www.ecfr.gov/developers/documentation/api/v1
- OSHA laws/regulations: https://www.osha.gov/laws-regs
- EPA TSCA: https://www.epa.gov/laws-regulations/summary-toxic-substances-control-act
- EPA RCRA: https://www.epa.gov/rcra/resource-conservation-and-recovery-act-rcra-overview
- CPSC business guidance: https://www.cpsc.gov/Business--Manufacturing
- FTC Made in USA: https://www.ftc.gov/business-guidance/resources/complying-made-usa-standard
- BIS EAR: https://www.bis.gov/regulations/ear
- Census AES/FTR: https://www.census.gov/foreign-trade/aes/
- NC DOL OSH: https://www.labor.nc.gov/safety-and-health/occupational-safety-and-health
- NC DEQ permit list: https://www.deq.nc.gov/accessdeq/permit-assistance-and-guidance/deq-list-permits
- Mecklenburg Air Quality: https://airquality.mecknc.gov/industry
