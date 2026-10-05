import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { type ChecklistItem, type Customer, type CustomerProfile, type Memory } from "@/lib/db/schema";
import { extractKbliCodes, resolveHsCodes } from "@/lib/checks/facts";
import { DEFAULT_JURISDICTION, type JurisdictionName } from "@/lib/countries";

import { checklistStatusSchema } from "@/lib/checks/checklist-status";
type ChecklistStatus = z.infer<typeof checklistStatusSchema>;

type ChecklistDraft = {
  /** Stable identity — rows are matched and pruned on this, never on the title. */
  key: string;
  title: string;
  category: string;
  status: ChecklistStatus;
  priority: "low" | "medium" | "high";
  whyApplies: string;
  linkedFacts: string[];
  evidenceRequired: string;
  sourceHealth: "working" | "manual_assisted" | "untested" | "not_checked" | "failed" | "blocked";
  confidence: "verified" | "lead" | "inferred";
  openQuestions: string[];
  origin?: string;
};

/**
 * Rebuilds the customer's living compliance checklist from profile data,
 * KBLI records, and memory. This intentionally creates review tasks instead
 * of silently upgrading unconfirmed chat leads into verified compliance facts.
 */
export async function refreshChecklistForCustomer(
  customerId: string,
  jurisdiction: JurisdictionName = DEFAULT_JURISDICTION,
): Promise<void> {
  const supabase = await createClient();
  const customer = (cloudResult<typeof Schema.customers.$inferSelect | null>(
    await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  const profile = (cloudResult<typeof Schema.customerProfiles.$inferSelect | null>(
    await supabase
      .from("customer_profiles")
      .select("*")
      .eq("customer_id", customerId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!customer || !profile) return;

  if (jurisdiction === "United States") {
    await refreshUsChecklist(customerId, customer, profile);
    return;
  }

  const memoryRows = cloudResult<Array<typeof Schema.memories.$inferSelect>>(
    await supabase
      .from("memories")
      .select("*")
      .eq("customer_id", customerId)
      .eq("jurisdiction", jurisdiction),
  );
  await rememberKbliLeads(customerId, memoryRows);

  const kbliRows = cloudResult<Array<typeof Schema.kbliRecords.$inferSelect>>(
    await supabase
      .from("kbli_records")
      .select("*")
      .eq("customer_id", customerId),
  );
  const unconfirmedMemories = memoryRows.filter((m) => !m.confirmed);
  const confirmedKbli = kbliRows.filter((k) => k.confirmed || k.status === "confirmed");
  const unconfirmedKbli = kbliRows.filter((k) => !k.confirmed && k.status !== "confirmed");
  const profileKbli = profile.kbliCodes ?? [];
  // Same three tiers the judgment stage uses. "A person confirmed it in Memory"
  // is not "it came off a PEB", and this row exists precisely to chase the
  // second one — so only a document closes it.
  const hs = resolveHsCodes(profile, memoryRows);
  const hsLeads = [
    ...hs.leads.map((h) => `HS ${h.code} (unconfirmed lead): ${h.basis}`),
    ...hs.guesses.map(
      (h) => `HS ${h.code} (${hs.guessesSuperseded ? "superseded guess" : "guess"}): ${h.basis}`,
    ),
  ];
  const products = [
    profile.productDescription,
    ...memoryRows.filter((m) => m.kind === "product").map((m) => m.content),
  ].filter(Boolean);
  const locationFacts = [
    customer.city ? `${customer.city}, ${customer.country}` : customer.country,
    ...memoryRows
      .filter((m) => m.kind === "location" || /\b(factory|address|lokasi|pabrik|surabaya|jawa timur|east java)\b/i.test(m.content))
      .map((m) => m.content),
  ].filter(Boolean);

  const drafts: ChecklistDraft[] = [
    {
      key: "kbli-confirm",
      title: "Confirm real KBLI from OSS/NIB",
      category: "kbli",
      status:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? "completed"
          : unconfirmedKbli.length > 0
            ? "needs_review"
            : "needs_review",
      priority: "high",
      whyApplies:
        "KBLI is the bridge between the company profile and Indonesian licensing, OSS risk, sector rules, and future regulatory checks.",
      linkedFacts: [
        ...profileKbli.map((code) => `Profile KBLI ${code}`),
        ...kbliRows.map((k) => `KBLI ${k.code}${k.title ? ` - ${k.title}` : ""}`),
      ],
      evidenceRequired: "OSS/NIB document or screenshot showing the registered KBLI and business activity.",
      sourceHealth: confirmedKbli.length > 0 ? "manual_assisted" : "not_checked",
      confidence: confirmedKbli.length > 0 || profileKbli.length > 0 ? "verified" : "lead",
      openQuestions:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? []
          : ["Which KBLI codes are printed on the current OSS/NIB?"],
    },
    {
      key: "trade-hs-confirm",
      title: "Confirm HS codes from PEB or invoice",
      category: "trade",
      status: hs.documentVerified ? "completed" : "needs_review",
      priority: "high",
      whyApplies:
        "HS codes decide which export, tariff, customs, and standards changes are relevant. Codes confirmed in Memory are the working set, but only an export document closes this row.",
      linkedFacts: [
        ...hs.document.map((h) => `HS ${h.code} (document-verified): ${h.basis}`),
        ...hs.human.map((h) => `HS ${h.code} (human-confirmed in Memory): ${h.basis}`),
        ...hsLeads,
      ],
      evidenceRequired: "PEB, commercial invoice, packing list, or broker confirmation showing the actual shipped HS code.",
      sourceHealth: "manual_assisted",
      confidence: hs.documentVerified ? "verified" : hs.human.length > 0 ? "inferred" : "lead",
      openQuestions: hs.documentVerified
        ? []
        : hs.human.length > 0
          ? [
            `Do the confirmed codes (${hs.human.map((h) => h.code).join(", ")}) match the last PEB or invoice?`,
          ]
          : ["Which HS code appears on the last real export document?"],
    },
    {
      key: "oss-licensing",
      title: "Check OSS licensing requirements for each KBLI",
      category: "oss",
      status: confirmedKbli.length > 0 || profileKbli.length > 0 ? "required" : "needs_review",
      priority: "high",
      whyApplies:
        "OSS determines risk level, business licensing status, and permits/certificates tied to KBLI.",
      linkedFacts: [
        ...profileKbli.map((code) => `Profile KBLI ${code}`),
        ...kbliRows.map((k) => `KBLI ${k.code}${k.ossLicenseType ? `: ${k.ossLicenseType}` : ""}`),
      ],
      evidenceRequired: "OSS licensing status, risk level, and any attached sector permit requirement.",
      sourceHealth: "manual_assisted",
      confidence: confirmedKbli.length > 0 || profileKbli.length > 0 ? "inferred" : "lead",
      openQuestions:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? ["Has the OSS business licensing status changed since the NIB was issued?"]
          : ["Confirm KBLI first, then map OSS obligations."],
    },
    {
      key: "kbli-rule-mapping",
      title: "Map KBLI against Indonesian rule families",
      category: "kbli",
      status: confirmedKbli.length > 0 || profileKbli.length > 0 ? "required" : "needs_review",
      priority: "high",
      whyApplies:
        "The core product promise is KBLI-to-rule mapping across UU, PP, Perpres/Kepres, Permen/Kepmen, tax/customs, SNI, OSS, and regional rules.",
      linkedFacts: [
        ...profileKbli.map((code) => `Profile KBLI ${code}`),
        ...kbliRows.map((k) => `KBLI ${k.code}${k.title ? ` - ${k.title}` : ""}`),
      ],
      evidenceRequired:
        "Confirmed KBLI plus source evidence from OSS, peraturan.go.id/JDIHN, relevant ministry JDIH, Kemenkeu/DJBC/DJP, BSN/SNI, and regional JDIH.",
      sourceHealth: confirmedKbli.length > 0 || profileKbli.length > 0 ? "not_checked" : "manual_assisted",
      confidence: confirmedKbli.length > 0 || profileKbli.length > 0 ? "inferred" : "lead",
      openQuestions:
        confirmedKbli.length > 0 || profileKbli.length > 0
          ? ["Which linked rules apply directly to this KBLI versus only to the product/HS code?"]
          : ["Confirm KBLI first; complete Indonesian rule mapping cannot be claimed without it."],
    },
    {
      key: "national-monitoring",
      title: "Monitor UU, PP, Perpres/Kepres, and Permen/Kepmen",
      category: "national",
      status: "required",
      priority: "high",
      whyApplies:
        "National legal changes can create licensing, reporting, product, tax, labor, environmental, or export obligations even when Kemendag is quiet.",
      linkedFacts: [
        `Business type: ${profile.businessType ?? "unknown"}`,
        ...products,
        ...profileKbli.map((code) => `Profile KBLI ${code}`),
        ...kbliRows.map((k) => `KBLI ${k.code}`),
      ],
      evidenceRequired:
        "Successful JDIH Setneg results for the national hierarchy plus relevant ministry JDIH evidence for Permen/Kepmen.",
      sourceHealth: "manual_assisted",
      confidence: "inferred",
      openQuestions: [
        "Which ministry JDIH is authoritative for the confirmed KBLI sector?",
        "Did any national rule change since the last successful check affect this KBLI/product?",
      ],
    },
    {
      key: "sni-screen",
      title: "Screen mandatory SNI exposure",
      category: "sni",
      status: products.length > 0 ? "needs_review" : "unknown",
      priority: "medium",
      whyApplies:
        "BSN/SNI obligations are product-specific, and should be checked from the actual product description plus HS code.",
      linkedFacts: products,
      evidenceRequired: "Product specs, SKUs, SNI certificate if any, and a BSN/SNI lookup result.",
      sourceHealth: "working",
      confidence: "lead",
      openQuestions: ["Is PVC tarpaulin sold under any mandatory SNI category or sector technical rule?"],
    },
    {
      key: "tax-customs-monitor",
      title: "Monitor Kemenkeu, DJBC, and DJP tax-customs changes",
      category: "tax_customs",
      status: "needs_review",
      priority: "medium",
      whyApplies:
        "Exporters can be affected by PMK, Bea Cukai, and tax-administration changes even when trade-ministry feeds are quiet.",
      linkedFacts: [
        `Trade side: ${profile.sideOfTrade}`,
        ...profile.destinationMarkets.map((market) => `Destination: ${market}`),
      ],
      evidenceRequired: "PMK/DJBC/DJP source check, broker notes, and any current facility status.",
      sourceHealth: "working",
      confidence: "lead",
      openQuestions: ["Does the customer use any bonded-zone, KITE, VAT, or customs facility?"],
    },
    {
      key: "environment-monitor",
      title: "Monitor environmental rules and facility-document notices",
      category: "environment",
      status: "required",
      priority: "high",
      whyApplies:
        "Manufacturing can trigger national environmental rules plus location-specific AMDAL, UKL-UPL, DELH, DPLH, waste, emissions, and wastewater obligations.",
      linkedFacts: [...products, ...locationFacts],
      evidenceRequired:
        "Current environmental approval/document, waste and emissions permits, facility processes, materials, and successful KLH/local DLH source checks.",
      sourceHealth: "working",
      confidence: "inferred",
      openQuestions: [
        "Which environmental approval and reporting obligations are printed on the facility's current documents?",
      ],
    },
    {
      key: "labor-safety-monitor",
      title: "Monitor labor and occupational safety rules",
      category: "labor_safety",
      status: "required",
      priority: "high",
      whyApplies:
        "A manufacturer has workforce and workplace-safety obligations independent of its export product rules.",
      linkedFacts: [...products, ...locationFacts],
      evidenceRequired:
        "Workforce, machinery/process, K3/P2K3, training, inspection, and incident records plus successful Kemnaker source checks.",
      sourceHealth: "working",
      confidence: "inferred",
      openQuestions: ["Which K3, machinery, workforce, and provincial wage obligations apply to this facility?"],
    },
    {
      key: "regional-perda",
      title: "Monitor regional Perda and Perkada by factory location",
      category: "regional",
      status: locationFacts.length > 0 ? "required" : "needs_review",
      priority: "medium",
      whyApplies:
        "Perda and Perkada coverage depends on the factory/legal-entity location and may affect business licensing, nuisance permits, labor, environment, taxes, and local operations.",
      linkedFacts: locationFacts,
      evidenceRequired: "Factory address, legal entity domicile, and relevant province/city/regency JDIH sources.",
      sourceHealth: "manual_assisted",
      confidence: locationFacts.length > 0 ? "inferred" : "lead",
      openQuestions:
        locationFacts.length > 0
          ? ["Which provincial and city sources successfully covered this location in the latest run?"]
          : ["What city/regency and province should regional monitoring cover?"],
    },
    {
      key: "memory-review",
      title: "Review unconfirmed memory leads",
      category: "memory",
      status: unconfirmedMemories.length > 0 ? "needs_review" : "completed",
      priority: unconfirmedMemories.length > 0 ? "high" : "low",
      whyApplies:
        "Chat can make the monitor smarter only after a person confirms which remembered facts are real.",
      linkedFacts: unconfirmedMemories.map((m) => `[${m.kind}] ${m.content}`),
      evidenceRequired: "Open Memory and confirm, edit, or delete each lead.",
      sourceHealth: "manual_assisted",
      confidence: unconfirmedMemories.length > 0 ? "lead" : "verified",
      openQuestions:
        unconfirmedMemories.length > 0
          ? [`${unconfirmedMemories.length} memory lead(s) still need human confirmation.`]
          : [],
    },
  ];

  for (const draft of drafts) {
    await upsertChecklistItem(customerId, jurisdiction, draft);
  }

  await pruneObsoleteChecklistItems(customerId, jurisdiction, drafts);
}

async function refreshUsChecklist(
  customerId: string,
  customer: Customer,
  baseProfile: CustomerProfile,
): Promise<void> {
  const supabase = await createClient();
  const jurisdiction = "United States" as const;
  const us = (cloudResult<typeof Schema.jurisdictionProfiles.$inferSelect | null>(
    await supabase
      .from("jurisdiction_profiles")
      .select("*")
      .eq("customer_id", customerId)
      .eq("country", jurisdiction)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  const memoryRows = cloudResult<Array<typeof Schema.memories.$inferSelect>>(
    await supabase
      .from("memories")
      .select("*")
      .eq("customer_id", customerId)
      .eq("jurisdiction", jurisdiction),
  );
  const unconfirmedMemories = memoryRows.filter((memory) => !memory.confirmed);
  const confirmedMemory = memoryRows.filter((memory) => memory.confirmed);
  const remembered = (kind: string) =>
    confirmedMemory.filter((memory) => memory.kind === kind).map((memory) => memory.content);
  const rememberedCodes = (kind: string) =>
    remembered(kind).map((content) => ({
      code:
        (kind === "naics"
          ? content.match(/\b\d{2,6}\b/)?.[0]
          : content.match(/\b(?:EAR99|[0-9][A-E][0-9]{3}|\d{4}(?:[.\s-]?\d{2}){1,3})\b/i)?.[0]) ??
        content,
      basis: `confirmed memory: ${content}`,
      confirmed: true,
    }));

  const facts = {
    facilities: [...(us?.facilityAddresses ?? []), ...remembered("location")],
    naics: [...(us?.naicsCodes ?? []), ...rememberedCodes("naics")],
    products: [
      ...(us?.products?.length ? us.products : [baseProfile.productDescription].filter(Boolean)),
      ...remembered("product"),
    ],
    skus: us?.skus ?? [],
    materials: [...(us?.materialsChemicals ?? []), ...remembered("material")],
    processes: [...(us?.manufacturingProcesses ?? []), ...remembered("process")],
    waste: [...(us?.wasteStreams ?? []), ...remembered("waste")],
    states: [...(us?.distributionStates ?? []), ...remembered("distribution_state")],
    claims: [...(us?.labelsClaims ?? []), ...remembered("label_claim")],
    hts: [...(us?.htsScheduleBCodes ?? []), ...rememberedCodes("hs_code")],
    exportClasses: [
      ...(us?.exportClassifications ?? []),
      ...rememberedCodes("export_classification"),
    ],
    exportCountries: [...(us?.exportCountries ?? []), ...remembered("market")],
    flags: [...(us?.regulatedProductFlags ?? []), ...remembered("product_flag")],
  };
  const codeFacts = (label: string, rows: { code: string; basis: string; confirmed: boolean; }[]) =>
    rows.map((row) => `${label} ${row.code} (${row.confirmed ? "confirmed" : "needs evidence"}): ${row.basis}`);
  const confirmedCodes = (rows: { confirmed: boolean; }[]) =>
    rows.length > 0 && rows.every((row) => row.confirmed);
  const hasNorthCarolinaFacility = facts.facilities.some((address) =>
    /\b(NC|North Carolina|Charlotte|Mecklenburg)\b/i.test(address),
  );
  const hasExplicitNoDefenseSignal = facts.flags.some((flag) =>
    /\b(no|not|non)[-\s]?(defen[cs]e|military|aerospace|space|itar)\b/i.test(flag),
  );
  const hasDefenseSignal = facts.flags.some(
    (flag) =>
      /\b(defen[cs]e|military|aerospace|space|itar)\b/i.test(flag) &&
      !/\b(no|not|non)[-\s]?(defen[cs]e|military|aerospace|space|itar)\b/i.test(flag),
  );
  const hasConsumerProduct = facts.flags.some((flag) => /consumer product/i.test(flag));
  const hasRegulatedProduct = facts.flags.some((flag) =>
    /\b(food|device|drug|cosmetic|chemical|consumer product|electronics|automotive)\b/i.test(flag),
  );
  const hasExports = facts.exportCountries.length > 0 || facts.hts.length > 0 || facts.exportClasses.length > 0;

  const drafts: ChecklistDraft[] = [
    {
      key: "us-naics-confirm",
      title: "Confirm NAICS codes",
      category: "business",
      status: confirmedCodes(facts.naics) ? "verified" : "needs_evidence",
      priority: "high",
      whyApplies: "NAICS anchors industry-specific federal and state applicability, but is not sufficient by itself.",
      linkedFacts: codeFacts("NAICS", facts.naics),
      evidenceRequired: "Tax filing, SAM registration, Census classification, or a reviewed company activity description.",
      sourceHealth: "manual_assisted",
      confidence: confirmedCodes(facts.naics) ? "verified" : "lead",
      openQuestions: facts.naics.length ? [] : ["What does each U.S. facility actually manufacture or distribute?"],
    },
    {
      key: "us-facility-address",
      title: "Confirm each facility and warehouse address",
      category: "regional",
      status: facts.facilities.length ? "verified" : "needs_evidence",
      priority: "high",
      whyApplies: "State OSHA, environmental permits, tax, zoning, fire, and local rules depend on the physical location.",
      linkedFacts: facts.facilities,
      evidenceRequired: "Street address and whether each site manufactures, stores, or only administers the business.",
      sourceHealth: "manual_assisted",
      confidence: facts.facilities.length ? "verified" : "lead",
      openQuestions: facts.facilities.length ? [] : ["Which U.S. facilities and warehouses are in scope?"],
    },
    {
      key: "us-product-category",
      title: "Confirm product categories and regulated-product flags",
      category: "product",
      status: facts.products.length && facts.flags.length ? "verified" : "needs_evidence",
      priority: "high",
      whyApplies: "CPSC, FDA, USDA, FCC, DOT, and sector rules only apply after the actual products are classified.",
      linkedFacts: [...facts.products, ...facts.skus.map((sku) => `SKU ${sku}`), ...facts.flags],
      evidenceRequired: "Product catalogue, SKU list, intended users, technical specs, and regulated-category review.",
      sourceHealth: "manual_assisted",
      confidence: facts.flags.length ? "inferred" : "lead",
      openQuestions: facts.flags.length ? [] : ["Are any products food, medical, chemical, electronic, automotive, or consumer goods?"],
    },
    {
      key: "us-materials-sds",
      title: "Confirm materials, chemicals, and SDS inventory",
      category: "environment",
      status: facts.materials.length ? "verified" : "needs_evidence",
      priority: "high",
      whyApplies: "Chemical identity and quantities drive OSHA HazCom, EPA TSCA, reporting, storage, and transport duties.",
      linkedFacts: facts.materials,
      evidenceRequired: "Current chemical inventory, supplier SDS files, annual quantities, and storage locations.",
      sourceHealth: "manual_assisted",
      confidence: facts.materials.length ? "inferred" : "lead",
      openQuestions: facts.materials.length ? [] : ["Which chemicals and mixtures are used or stored, and in what quantities?"],
    },
    {
      key: "us-waste-streams",
      title: "Classify waste streams and generator status",
      category: "environment",
      status: facts.waste.length ? "requires_expert_review" : "needs_evidence",
      priority: "high",
      whyApplies: "RCRA and state hazardous-waste duties depend on actual waste composition and monthly generation volume.",
      linkedFacts: [...facts.waste, ...facts.processes.map((process) => `Process: ${process}`)],
      evidenceRequired: "Waste profiles, manifests, disposal records, process map, and generator-category determination.",
      sourceHealth: "manual_assisted",
      confidence: facts.waste.length ? "inferred" : "lead",
      openQuestions: facts.waste.length ? ["Has a qualified person classified each waste stream?"] : ["What waste does each process generate?"],
    },
    {
      key: "us-osha-applicability",
      title: "Monitor federal OSHA and state-plan applicability",
      category: "safety",
      status: facts.facilities.length ? "monitored" : "needs_evidence",
      priority: "high",
      whyApplies: "Workplace standards and state-plan jurisdiction depend on facility location, workforce, equipment, and processes.",
      linkedFacts: [...facts.facilities, ...facts.processes],
      evidenceRequired: "Facility/process profile, injury logs, written programs, training records, and latest OSHA source result.",
      sourceHealth: "working",
      confidence: facts.facilities.length ? "inferred" : "lead",
      openQuestions: facts.facilities.length ? [] : ["Which site and state-plan jurisdiction should OSHA monitoring cover?"],
    },
    {
      key: "us-epa-tsca-rcra",
      title: "Monitor EPA TSCA and RCRA applicability",
      category: "environment",
      status: facts.materials.length || facts.waste.length ? "requires_expert_review" : "needs_evidence",
      priority: "high",
      whyApplies: "Chemical manufacturing/import, use restrictions, reporting, and hazardous waste cannot be screened without material and waste facts.",
      linkedFacts: [...facts.materials, ...facts.waste],
      evidenceRequired: "Chemical inventory, supplier status, import/manufacture role, waste characterization, and CFR/source review.",
      sourceHealth: "working",
      confidence: facts.materials.length || facts.waste.length ? "inferred" : "lead",
      openQuestions: ["Does the company manufacture or import any chemical substance, or only buy domestic mixtures?"],
    },
    {
      key: "us-permits",
      title: "Verify air, water, stormwater, and waste permits",
      category: "environment",
      status: facts.facilities.length && facts.processes.length ? "requires_expert_review" : "needs_evidence",
      priority: "high",
      whyApplies: "Permit thresholds are facility- and process-specific and may be federal, state, county, or municipal.",
      linkedFacts: [...facts.facilities, ...facts.processes],
      evidenceRequired: "Permit register, emissions and discharge data, stormwater exposure review, and regulator correspondence.",
      sourceHealth: hasNorthCarolinaFacility ? "working" : "not_checked",
      confidence: facts.facilities.length && facts.processes.length ? "inferred" : "lead",
      openQuestions: hasNorthCarolinaFacility
        ? ["Do NC DEQ or Mecklenburg Air Quality permits apply to the Charlotte-area site?"]
        : ["Which state and local permitting agencies govern each facility?"],
    },
    {
      key: "us-product-safety",
      title: "Check product safety, testing, and certificates",
      category: "product",
      status: hasRegulatedProduct ? "requires_expert_review" : facts.flags.length ? "monitored" : "needs_evidence",
      priority: "high",
      whyApplies: "Testing, certification, recall, and reporting duties depend on product category and intended user.",
      linkedFacts: [...facts.products, ...facts.flags],
      evidenceRequired: "Test reports, conformity certificates, incident/complaint process, and product-category determination.",
      sourceHealth: hasConsumerProduct ? "working" : "manual_assisted",
      confidence: facts.flags.length ? "inferred" : "lead",
      openQuestions: facts.flags.length ? [] : ["Which federal product-safety agency, if any, has jurisdiction?"],
    },
    {
      key: "us-ftc-label-claims",
      title: "Review labels, Made in USA, and marketing claims",
      category: "labeling",
      status: facts.claims.length ? "requires_expert_review" : "needs_evidence",
      priority: "medium",
      whyApplies: "Origin, environmental, performance, warranty, and safety claims need substantiation across labels and online sales.",
      linkedFacts: facts.claims,
      evidenceRequired: "Label artwork, website/product listings, origin substantiation, and claim-support files.",
      sourceHealth: "working",
      confidence: facts.claims.length ? "inferred" : "lead",
      openQuestions: facts.claims.length ? [] : ["What claims appear on products, packaging, website, and sales materials?"],
    },
    {
      key: "us-distribution-states",
      title: "Monitor distribution states and state-specific rules",
      category: "distribution",
      status: facts.states.length ? "monitored" : "needs_evidence",
      priority: "high",
      whyApplies: "Sales tax, EPR, packaging, PFAS, chemical, consumer, warranty, and product rules follow where goods are sold or stored.",
      linkedFacts: facts.states.map((state) => `Distribution: ${state}`),
      evidenceRequired: "Current ship-to states, warehouse states, marketplace channels, tax registrations, and product/packaging profile.",
      sourceHealth: facts.states.length ? "manual_assisted" : "not_checked",
      confidence: facts.states.length ? "inferred" : "lead",
      openQuestions: facts.states.length ? ["Are online marketplace and distributor sales included?"] : ["Into which states are products sold, shipped, or warehoused?"],
    },
    {
      key: "us-export-hts",
      title: "Confirm HTS and Schedule B classifications",
      category: "export",
      status: confirmedCodes(facts.hts) ? "verified" : "needs_evidence",
      priority: "high",
      whyApplies: "HTS and Schedule B drive customs treatment, AES filing, statistics, and document consistency.",
      linkedFacts: codeFacts("HTS/Schedule B", facts.hts),
      evidenceRequired: "Broker ruling, prior entry/export documents, product specs, and classification rationale.",
      sourceHealth: "manual_assisted",
      confidence: confirmedCodes(facts.hts) ? "verified" : "lead",
      openQuestions: facts.hts.length ? [] : ["Which HTS and Schedule B codes appear on actual transactions?"],
    },
    {
      key: "us-export-eccn",
      title: "Determine ECCN or document EAR99",
      category: "export",
      status: confirmedCodes(facts.exportClasses) ? "verified" : "needs_evidence",
      priority: "high",
      whyApplies: "Export license requirements cannot be assessed without a defensible ECCN or EAR99 determination.",
      linkedFacts: codeFacts("Export classification", facts.exportClasses),
      evidenceRequired: "CCATS/vendor classification or documented self-classification against the CCL.",
      sourceHealth: "working",
      confidence: confirmedCodes(facts.exportClasses) ? "verified" : "lead",
      openQuestions: facts.exportClasses.length ? [] : ["Is each exported item on the CCL or EAR99?"],
    },
    {
      key: "us-export-aes",
      title: "Determine AES and EEI filing requirements",
      category: "export",
      status: hasExports ? "requires_expert_review" : "needs_evidence",
      priority: "high",
      whyApplies: "AES depends on value, destination, license status, shipment structure, and specific FTR exemptions.",
      linkedFacts: [...facts.exportCountries, ...codeFacts("HTS/Schedule B", facts.hts)],
      evidenceRequired: "Shipment values, destinations, Schedule B, license status, and filing/exemption records.",
      sourceHealth: "working",
      confidence: hasExports ? "inferred" : "lead",
      openQuestions: ["Who files EEI, and which exemption citation is used when no filing is made?"],
    },
    {
      /*
       * The US tax/customs counterpart to Indonesia's `tax-customs-monitor`.
       * The US pack watched thirteen agencies and no tax authority until IRS,
       * 19 CFR and 26 CFR were added, so this row exists to make that coverage
       * visible as an obligation rather than only as source rows.
       */
      key: "us-tax-customs",
      title: "Monitor IRS, 19 CFR customs, and 26 CFR tax changes",
      category: "tax_customs",
      status: "monitored",
      priority: hasExports ? "high" : "medium",
      whyApplies:
        "The US cannot tax exports (Constitution, Art. I §9 cl. 5), so the exposure is on the customs and income-tax side: duty drawback under 19 CFR 190, entry, valuation and origin rules, plus federal tax changes. Import duty on inputs is where an exporter's money actually moves.",
      linkedFacts: codeFacts("HTS/Schedule B", facts.hts),
      evidenceRequired:
        "Import entry records, duties paid on inputs, drawback claims or a recorded decision not to claim, and the responsible tax adviser or customs broker.",
      sourceHealth: "working",
      confidence: "inferred",
      openQuestions: [
        "Are duties paid on imported inputs that are later re-exported? If so, is drawback being claimed under 19 CFR 190?",
        "Is an FTZ, FDII, or IC-DISC position in use, and who reviews it?",
      ],
    },
    {
      key: "us-export-ofac",
      title: "Screen OFAC, destination, end user, and end use",
      category: "export",
      status: facts.exportCountries.length ? "monitored" : "needs_evidence",
      priority: "high",
      whyApplies: "Sanctions and restricted-party controls are transaction-specific and can change independently of product classification.",
      linkedFacts: facts.exportCountries.map((country) => `Export destination: ${country}`),
      evidenceRequired: "Party-screening records, ownership checks, end-use statement, destination, and escalation procedure.",
      sourceHealth: "working",
      confidence: facts.exportCountries.length ? "inferred" : "lead",
      openQuestions: facts.exportCountries.length ? ["Are customers, owners, banks, freight forwarders, and end users screened?"] : ["Which countries, counterparties, and end uses are involved?"],
    },
    {
      key: "us-export-itar",
      title: "Resolve ITAR and defense-trade exposure",
      category: "export",
      status: hasDefenseSignal
        ? "requires_expert_review"
        : hasExplicitNoDefenseSignal
          ? "not_applicable"
          : "needs_evidence",
      priority: hasDefenseSignal ? "high" : "medium",
      whyApplies: "Defense articles, technical data, brokering, and defense services can trigger DDTC controls outside ordinary EAR analysis.",
      linkedFacts: facts.flags,
      evidenceRequired: "Product/end-use review against the USML and written jurisdiction/classification rationale.",
      sourceHealth: "manual_assisted",
      confidence: hasDefenseSignal ? "inferred" : hasExplicitNoDefenseSignal ? "verified" : "lead",
      openQuestions: hasDefenseSignal ? ["Does counsel or an empowered official confirm USML jurisdiction?"] : [],
    },
    {
      key: "us-memory-review",
      title: "Review unconfirmed United States memory leads",
      category: "memory",
      status: unconfirmedMemories.length ? "needs_evidence" : "verified",
      priority: unconfirmedMemories.length ? "high" : "low",
      whyApplies: "Chat can improve the U.S. monitor only after a person verifies the facts it extracted.",
      linkedFacts: unconfirmedMemories.map((memory) => `[${memory.kind}] ${memory.content}`),
      evidenceRequired: "Confirm, correct, or delete each U.S.-scoped memory lead.",
      sourceHealth: "manual_assisted",
      confidence: unconfirmedMemories.length ? "lead" : "verified",
      openQuestions: unconfirmedMemories.length ? [`${unconfirmedMemories.length} lead(s) need review.`] : [],
    },
  ];

  for (const draft of drafts) await upsertChecklistItem(customerId, jurisdiction, draft);
  await pruneObsoleteChecklistItems(customerId, jurisdiction, drafts);
}

/**
 * Drop system rows this refresh no longer generates.
 *
 * Keys make this self-maintaining: a reworded row keeps its key and is
 * updated, a removed row disappears on the next refresh. The previous approach
 * was a hardcoded list of old titles to delete, which only grows and only ever
 * catches renames somebody remembered to add to it. Rows a person created
 * (`origin` != system) are never touched.
 */
async function pruneObsoleteChecklistItems(
  customerId: string,
  jurisdiction: JurisdictionName,
  drafts: ChecklistDraft[],
): Promise<void> {
  const supabase = await createClient();
  const live = new Set(drafts.map((d) => d.key));
  const rows = cloudResult<Array<typeof Schema.checklistItems.$inferSelect>>(
    await supabase
      .from("checklist_items")
      .select("*")
      .eq("customer_id", customerId)
      .eq("jurisdiction", jurisdiction),
  );

  for (const row of rows) {
    if (row.origin !== "system") continue;
    if (row.key && live.has(row.key)) continue;
    cloudResult(
      await supabase
        .from("checklist_items")
        .delete()
        .eq("id", row.id),
    );
  }
}

async function rememberKbliLeads(customerId: string, memoryRows: Memory[]): Promise<void> {
  const supabase = await createClient();
  const existing = cloudResult<Array<typeof Schema.kbliRecords.$inferSelect>>(
    await supabase
      .from("kbli_records")
      .select("*")
      .eq("customer_id", customerId),
  );
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  for (const memory of memoryRows) {
    if (memory.kind !== "kbli" && !/\b(kbli|oss|nib)\b/i.test(memory.content)) continue;
    const codes = extractKbliCodes(memory.content);
    for (const code of codes) {
      const existingRow = existingByCode.get(code);
      if (existingRow) {
        if (memory.confirmed && !existingRow.confirmed) {
          cloudResult(
            await supabase
              .from("kbli_records")
              .update(snakeRow({
                confirmed: true,
                status: "confirmed",
                updatedAt: new Date().toISOString(),
              }))
              .eq("id", existingRow.id),
          );
          existingByCode.set(code, { ...existingRow, confirmed: true, status: "confirmed" });
        }
        continue;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      cloudResult(
        await supabase
          .from("kbli_records")
          .insert(snakeRow({
            id,
            customerId,
            code,
            source: memory.source ?? "memory",
            status: memory.confirmed ? "confirmed" : "unconfirmed",
            confirmed: memory.confirmed,
          })),
      );
      existingByCode.set(code, {
        id,
        customerId,
        code,
        version: "unknown",
        title: null,
        riskLevel: null,
        ossLicenseType: null,
        requiredCertificates: [],
        sectorMinistry: null,
        source: memory.source ?? "memory",
        status: memory.confirmed ? "confirmed" : "unconfirmed",
        confirmed: memory.confirmed,
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function upsertChecklistItem(
  customerId: string,
  jurisdiction: JurisdictionName,
  draft: ChecklistDraft,
): Promise<void> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const existing =
    (cloudResult<typeof Schema.checklistItems.$inferSelect | null>(
      await supabase
        .from("checklist_items")
        .select("*")
        .eq("customer_id", customerId)
        .eq("jurisdiction", jurisdiction)
        .eq("key", draft.key)
        .limit(1)
        .maybeSingle(),
    ) ?? undefined) ??
    // Rows created before keys existed — adopt them by title once, rather than
    // leaving a duplicate behind.
    (cloudResult<typeof Schema.checklistItems.$inferSelect | null>(
      await supabase
        .from("checklist_items")
        .select("*")
        .eq("customer_id", customerId)
        .eq("jurisdiction", jurisdiction)
        .eq("category", draft.category)
        .eq("title", draft.title)
        .limit(1)
        .maybeSingle(),
    ) ?? undefined);

  const values = {
    key: draft.key,
    title: draft.title,
    status: draft.status,
    priority: draft.priority,
    whyApplies: draft.whyApplies,
    linkedFacts: draft.linkedFacts,
    evidenceRequired: draft.evidenceRequired,
    sourceHealth: draft.sourceHealth,
    confidence: draft.confidence,
    openQuestions: draft.openQuestions,
    origin: draft.origin ?? "system",
    updatedAt: now,
  };

  if (existing) {
    cloudResult(
      await supabase
        .from("checklist_items")
        .update(snakeRow(values))
        .eq("id", existing.id),
    );
    return;
  }

  cloudResult(
    await supabase
      .from("checklist_items")
      .insert(snakeRow({
        id: randomUUID(),
        customerId,
        jurisdiction,
        category: draft.category,
        ...values,
      })),
  );
}

export function countOpenChecklistItems(items: ChecklistItem[]): number {
  return items.filter(
    (item) => !["completed", "not_required", "verified", "not_applicable"].includes(item.status),
  ).length;
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
