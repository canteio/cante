import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Multi-tenant from day one, even though only MA exists.
 *
 * Everything hangs off customer_id, and sources are keyed by country +
 * regulation_type, so "add customer #2" or "add Vietnam" is a row rather than
 * a refactor. SQLite via Drizzle locally; the schema is portable to Postgres
 * when deploy becomes a real decision.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  city: text("city"),
  createdAt: text("created_at").notNull().default(now),
});

export const customerProfiles = sqliteTable("customer_profiles", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  productDescription: text("product_description").notNull(),
  businessType: text("business_type"),
  sideOfTrade: text("side_of_trade").notNull().default("export"),
  /** JSON array of {code, basis, confirmed} */
  hsCodes: text("hs_codes", { mode: "json" }).$type<HsCode[]>().notNull(),
  /** JSON array of KBLI codes — empty until MA's OSS/NIB is read. */
  kbliCodes: text("kbli_codes", { mode: "json" }).$type<string[]>().notNull(),
  /** JSON array of ISO country names */
  destinationMarkets: text("destination_markets", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  /**
   * False until the codes come off a real export document. The judgment stage
   * reads this and must disclose it rather than implying verified coverage.
   */
  hsCodesConfirmed: integer("hs_codes_confirmed", { mode: "boolean" })
    .notNull()
    .default(false),
  destinationsConfirmed: integer("destinations_confirmed", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Free-form judgment guidance — not a keyword filter. */
  relevanceGuidance: text("relevance_guidance", { mode: "json" })
    .$type<RelevanceGuidance>()
    .notNull(),
});

/**
 * Country-specific operating facts. A customer can be incorporated in one
 * country while manufacturing, distributing, or exporting under another
 * jurisdiction, so these facts cannot live on `customers.country`.
 */
export const jurisdictionProfiles = sqliteTable("jurisdiction_profiles", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  country: text("country").notNull(),
  legalName: text("legal_name"),
  facilityAddresses: text("facility_addresses", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  naicsCodes: text("naics_codes", { mode: "json" })
    .$type<ClassificationCode[]>()
    .notNull()
    .default([]),
  products: text("products", { mode: "json" }).$type<string[]>().notNull().default([]),
  skus: text("skus", { mode: "json" }).$type<string[]>().notNull().default([]),
  materialsChemicals: text("materials_chemicals", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  manufacturingProcesses: text("manufacturing_processes", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  wasteStreams: text("waste_streams", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  distributionStates: text("distribution_states", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  labelsClaims: text("labels_claims", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  htsScheduleBCodes: text("hts_schedule_b_codes", { mode: "json" })
    .$type<ClassificationCode[]>()
    .notNull()
    .default([]),
  exportClassifications: text("export_classifications", { mode: "json" })
    .$type<ClassificationCode[]>()
    .notNull()
    .default([]),
  exportCountries: text("export_countries", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  regulatedProductFlags: text("regulated_product_flags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const kbliRecords = sqliteTable("kbli_records", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  code: text("code").notNull(),
  version: text("version").notNull().default("unknown"),
  title: text("title"),
  riskLevel: text("risk_level"),
  ossLicenseType: text("oss_license_type"),
  requiredCertificates: text("required_certificates", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  sectorMinistry: text("sector_ministry"),
  source: text("source"),
  /** confirmed | unconfirmed | needs_review | obsolete */
  status: text("status").notNull().default("unconfirmed"),
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
  lastCheckedAt: text("last_checked_at"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  country: text("country").notNull(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  url: text("url").notNull(),
  /** trade | tax | national | regional | standards | customs */
  regulationType: text("regulation_type").notNull(),
  /** working | blocked | unstable | untested */
  reliabilityStatus: text("reliability_status").notNull().default("untested"),
  /** Which listing view this row fetches, e.g. semua | ekspor | perizinan */
  view: text("view"),
  notes: text("notes"),
  lastSuccessAt: text("last_success_at"),
});

/**
 * Product coverage map, separate from fetchable source rows. A pack can exist
 * before it is automated; that is how the UI can show "manual-assisted" or
 * "untested" without claiming a daily check ran there.
 */
export const sourcePacks = sqliteTable("source_packs", {
  id: text("id").primaryKey(),
  country: text("country").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("national"),
  name: text("name").notNull(),
  /** kbli | oss | sni | tax_customs | trade | national_law | regional | environment | labor_safety */
  category: text("category").notNull(),
  /** automated | manual_assisted | untested | blocked | planned */
  status: text("status").notNull().default("planned"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const checkRuns = sqliteTable("check_runs", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  jurisdiction: text("jurisdiction").notNull().default("Indonesia"),
  startedAt: text("started_at").notNull().default(now),
  completedAt: text("completed_at"),
  /** running | complete | failed */
  status: text("status").notNull().default("running"),
  errorMessage: text("error_message"),
});

/**
 * The table that makes failure honest. One row per source per run, so a fetch
 * that failed can never be rendered as "checked, nothing found".
 */
export const sourceResults = sqliteTable("source_results", {
  id: text("id").primaryKey(),
  checkRunId: text("check_run_id")
    .notNull()
    .references(() => checkRuns.id),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id),
  success: integer("success", { mode: "boolean" }).notNull(),
  errorMessage: text("error_message"),
  /**
   * Fetched OK but parsed nothing — a broken parser, NOT a quiet day.
   * Stored separately from `success` because they mean different things.
   */
  entriesParsed: integer("entries_parsed").notNull().default(0),
  parseWarning: text("parse_warning"),
  rawContentPath: text("raw_content_path"),
  fetchedAt: text("fetched_at").notNull().default(now),
});

/**
 * Per-customer source inventory fingerprints. Complete catalogues can be
 * fetched on every run while only new/changed records enter model judgment.
 */
export const sourceDocuments = sqliteTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    jurisdiction: text("jurisdiction").notNull().default("Indonesia"),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    identity: text("identity").notNull(),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: text("first_seen_at").notNull().default(now),
    lastSeenAt: text("last_seen_at").notNull().default(now),
    lastChangedAt: text("last_changed_at").notNull().default(now),
  },
  (table) => ({
    customerSourceIdentity: uniqueIndex("source_documents_customer_source_identity_unique").on(
      table.customerId,
      table.jurisdiction,
      table.sourceId,
      table.identity,
    ),
  }),
);

export const findings = sqliteTable("findings", {
  id: text("id").primaryKey(),
  checkRunId: text("check_run_id")
    .notNull()
    .references(() => checkRuns.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  sourceId: text("source_id").references(() => sources.id),
  /** e.g. "Permendag 12 Tahun 2026" */
  regulationRef: text("regulation_ref"),
  title: text("title").notNull(),
  url: text("url"),
  /** Enactment date read off the detail page, when known. */
  enactedOn: text("enacted_on"),
  summaryId: text("summary_id"),
  summaryEn: text("summary_en"),
  /** flagged | noted | baseline | clear */
  relevance: text("relevance").notNull(),
  reasoning: text("reasoning"),
  createdAt: text("created_at").notNull().default(now),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  findingId: text("finding_id").references(() => findings.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  checkRunId: text("check_run_id").references(() => checkRuns.id),
  /** The full ready-to-send message body. */
  body: text("body").notNull(),
  /** whatsapp | telegram | email | manual */
  channel: text("channel").notNull().default("manual"),
  /**
   * pending | delivered | failed | skipped
   *
   * `failed` and `skipped` are separate on purpose. Skipped means no channel
   * was configured — nobody tried. Failed means we tried and it did not
   * arrive. A monitoring product that cannot tell those apart will report a
   * silent outage as a quiet day.
   */
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveredAt: text("delivered_at"),
  /** Why a delivery failed, kept verbatim for the operator. */
  deliveryError: text("delivery_error"),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * Saved chats. The CLI has no session of its own, so a conversation only
 * survives if we store it.
 */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  jurisdiction: text("jurisdiction").notNull().default("Indonesia"),
  title: text("title").notNull().default("New chat"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  /** user | agent */
  role: text("role").notNull(),
  content: text("content").notNull(),
  /**
   * Tool calls made while producing this message, for replay in the UI.
   * `results` holds the links a search actually returned, so a reopened
   * conversation shows the same sources it showed live.
   */
  activity: text("activity", { mode: "json" }).$type<MessageActivity[]>().notNull().default([]),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * Durable context about the customer — the thing that makes tomorrow's check
 * better than today's.
 *
 * Read by BOTH the chat and the judgment stage, which is the whole point:
 * memory only the chat sees changes nothing about the product.
 *
 * `confirmed` carries the same discipline as `customer_profiles.hsCodesConfirmed`.
 * Anything the model inferred from a conversation lands as false, and the
 * judgment stage is told to treat unconfirmed memory as a lead, never as a
 * verified fact. Promotion to confirmed is a human action in the UI.
 */
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  jurisdiction: text("jurisdiction").notNull().default("Indonesia"),
  /** product | hs_code | market | contact | operational | preference | other */
  kind: text("kind").notNull().default("other"),
  content: text("content").notNull(),
  /** Where it came from, in plain words — "said in chat 15 Aug", "PEB document". */
  source: text("source"),
  /** chat | manual | run */
  origin: text("origin").notNull().default("manual"),
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

export const checklistItems = sqliteTable("checklist_items", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  jurisdiction: text("jurisdiction").notNull().default("Indonesia"),
  /**
   * Stable identity for system-generated rows, so a row can be reworded without
   * orphaning the old one. Matching on the title meant every rename left a
   * duplicate behind and needed a hardcoded delete-by-old-title list.
   */
  key: text("key"),
  title: text("title").notNull(),
  /** kbli | national | oss | sni | tax_customs | trade | regional | document | memory | other */
  category: text("category").notNull().default("other"),
  /** unknown | required | not_required | completed | expiring | blocked | needs_review */
  status: text("status").notNull().default("unknown"),
  /** low | medium | high */
  priority: text("priority").notNull().default("medium"),
  whyApplies: text("why_applies"),
  linkedFacts: text("linked_facts", { mode: "json" }).$type<string[]>().notNull().default([]),
  linkedRules: text("linked_rules", { mode: "json" })
    .$type<ChecklistRule[]>()
    .notNull()
    .default([]),
  evidenceRequired: text("evidence_required"),
  owner: text("owner").notNull().default("user"),
  dueAt: text("due_at"),
  lastCheckedAt: text("last_checked_at"),
  /** working | manual_assisted | untested | not_checked | failed | blocked */
  sourceHealth: text("source_health").notNull().default("not_checked"),
  /** verified | lead | inferred */
  confidence: text("confidence").notNull().default("lead"),
  openQuestions: text("open_questions", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** system | memory | manual | run */
  origin: text("origin").notNull().default("system"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

/* ---------------------------------------------------------------------------
 * Operating data.
 *
 * Everything above this line describes regulations. Everything below describes
 * the customer's own business — the products, lanes, suppliers, documents and
 * decisions a regulation has to be matched *against* before "something changed"
 * can become "this affects you, here, by this much".
 *
 * `products` is the keystone: lanes, impact, document audit and supplier
 * evidence are all meaningless without a first-class SKU to hang them on.
 * ------------------------------------------------------------------------- */

/**
 * A real SKU, not a string in a profile array.
 *
 * `jurisdiction_profiles.products/skus` stay as they are — they describe the
 * company in prose for source activation. This table is the operating
 * catalogue, and it is deliberately country-agnostic: one product gets
 * classified differently per jurisdiction, which is what `productClassifications`
 * is for.
 */
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    /** The customer's own identifier. Stable across imports — it is the merge key. */
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Free-text materials, e.g. "PVC coated polyester scrim". Drives PFAS/REACH-style relevance. */
    materials: text("materials", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** ISO country name where the good is manufactured — origin drives duty and FTA questions. */
    originCountry: text("origin_country"),
    unitOfMeasure: text("unit_of_measure"),
    /** Declared unit value and its currency, used only for disclosed-estimate exposure maths. */
    unitValue: real("unit_value"),
    currency: text("currency").notNull().default("USD"),
    /** consumer | industrial | component | unknown — gates consumer-product source packs. */
    productClass: text("product_class").notNull().default("unknown"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => ({
    customerSku: uniqueIndex("products_customer_sku_unique").on(table.customerId, table.sku),
  }),
);

/**
 * Classification history, one row per code ever asserted for a product.
 *
 * Rows are never mutated into a new code and never deleted — a superseded code
 * gets `supersededAt` and stays, because "what did we declare last March" is a
 * question customs actually asks. This is item 6's version history and item 2's
 * per-SKU codes in one table.
 *
 * `tier` reuses lib/checks/facts.ts exactly (document | human | lead | guess) so
 * the customer-level and SKU-level answers to "is this established?" cannot
 * drift apart.
 */
export const productClassifications = sqliteTable("product_classifications", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  /** hs | hts | schedule_b | kbli | eccn | hs_destination */
  system: text("system").notNull(),
  /** Jurisdiction the code applies in; null for a globally-valid HS-6. */
  jurisdiction: text("jurisdiction"),
  code: text("code").notNull(),
  /** document | human | lead | guess — see lib/checks/facts.ts. Only `document` is verified. */
  tier: text("tier").notNull().default("lead"),
  /** Plain-words provenance: "read off PEB 000123", "broker email 4 Aug", "model suggestion". */
  basis: text("basis").notNull(),
  /** Official supporting material — CROSS ruling, HTS note, GRI rationale. */
  supportingRefs: text("supporting_refs", { mode: "json" })
    .$type<ClassificationRef[]>()
    .notNull()
    .default([]),
  /** Written rationale for the classification decision. Required before approval. */
  rationale: text("rationale"),
  /** proposed | approved | rejected | superseded */
  status: text("status").notNull().default("proposed"),
  /** Who approved it. Never set by the model — approval is a human act. */
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  supersededAt: text("superseded_at"),
  supersededBy: text("superseded_by"),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * Origin → destination movement of a product. Item 3.
 *
 * A lane is what turns "Indonesia changed an export rule" into "this affects
 * your Surabaya → Rotterdam lane", and it carries the volume/value figures every
 * exposure estimate depends on.
 */
export const tradeLanes = sqliteTable("trade_lanes", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  /** Null means the lane applies to the whole catalogue. */
  productId: text("product_id").references(() => products.id),
  /** export | import */
  direction: text("direction").notNull().default("export"),
  originCountry: text("origin_country").notNull(),
  destinationCountry: text("destination_country").notNull(),
  transitCountries: text("transit_countries", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  supplierId: text("supplier_id").references(() => suppliers.id),
  brokerName: text("broker_name"),
  brokerContact: text("broker_contact"),
  incoterm: text("incoterm"),
  /** weekly | monthly | quarterly | ad_hoc | unknown */
  shipmentFrequency: text("shipment_frequency").notNull().default("unknown"),
  annualShipments: integer("annual_shipments"),
  annualValue: real("annual_value"),
  annualVolume: real("annual_volume"),
  volumeUnit: text("volume_unit"),
  currency: text("currency").notNull().default("USD"),
  /** Next known shipment, so an effective date can be compared against it. */
  nextShipmentAt: text("next_shipment_at"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

/** Counterparties. Item 9's subject, and item 10's screening target. */
export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  name: text("name").notNull(),
  country: text("country"),
  address: text("address"),
  contactEmail: text("contact_email"),
  /** supplier | manufacturer | broker | forwarder | consignee | other */
  role: text("role").notNull().default("supplier"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * Evidence a supplier owes us. Item 9.
 *
 * `status` distinguishes "we never asked" from "asked and waiting" from
 * "expired" — three different facts that a single boolean would flatten into a
 * misleading "missing".
 */
export const supplierDocuments = sqliteTable("supplier_documents", {
  id: text("id").primaryKey(),
  supplierId: text("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  /** Null when the certificate covers the supplier rather than one SKU. */
  productId: text("product_id").references(() => products.id),
  /** certificate_of_origin | material_declaration | reach | rohs | pfas | sni | test_report | other */
  docType: text("doc_type").notNull(),
  /** not_requested | requested | received | expired | rejected | not_applicable */
  status: text("status").notNull().default("not_requested"),
  requestedAt: text("requested_at"),
  receivedAt: text("received_at"),
  expiresAt: text("expires_at"),
  /** Path or filename of the stored artefact; null while only a status is known. */
  fileRef: text("file_ref"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

/**
 * An uploaded trade document. Item 8.
 *
 * This is also the missing half of the project's own roadmap: the `document`
 * classification tier is the only one that counts as verified, and a PEB or
 * commercial invoice is where that tier comes from.
 *
 * `parseStatus` is load-bearing under rule 2. A document we could not read is
 * not a document with nothing wrong in it.
 */
export const tradeDocuments = sqliteTable("trade_documents", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  /** peb | commercial_invoice | packing_list | purchase_order | customs_entry | bill_of_lading | other */
  docType: text("doc_type").notNull(),
  filename: text("filename").notNull(),
  /** Document's own reference number, e.g. the PEB number. */
  documentNumber: text("document_number"),
  documentDate: text("document_date"),
  /** parsed | partial | unparsed | failed — never let `failed` read as "clean". */
  parseStatus: text("parse_status").notNull().default("unparsed"),
  parseNote: text("parse_note"),
  /** Structured line items and header fields extracted from the document. */
  extracted: text("extracted", { mode: "json" }).$type<ExtractedDocument | null>(),
  rawText: text("raw_text"),
  uploadedAt: text("uploaded_at").notNull().default(now),
});

/** A discrepancy found by auditing one document, or across documents. Item 8. */
export const documentFindings = sqliteTable("document_findings", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => tradeDocuments.id),
  productId: text("product_id").references(() => products.id),
  /** code_mismatch | origin_mismatch | description_mismatch | value_mismatch | missing_field | uom_mismatch */
  kind: text("kind").notNull(),
  /** high | medium | low */
  severity: text("severity").notNull().default("medium"),
  message: text("message").notNull(),
  /** What the document said vs what the catalogue says. Both sides, always. */
  documentValue: text("document_value"),
  expectedValue: text("expected_value"),
  /** Where the expectation came from, so a guess can't masquerade as a rule. */
  expectationTier: text("expectation_tier").notNull().default("lead"),
  /** open | accepted | dismissed | corrected */
  status: text("status").notNull().default("open"),
  /**
   * Money on a code mismatch: expected duty − declared duty, at published
   * rates. Positive means the declared code under-paid.
   *
   * Detecting that a document declares a different code than the catalogue is
   * a compliance observation; this is the number that makes it a business
   * event. Null whenever either side could not be priced — never zero.
   */
  dutyDifference: real("duty_difference"),
  dutyCurrency: text("duty_currency").notNull().default("USD"),
  /** The arithmetic and its caveats, printed with the figure. */
  dutyBasis: text("duty_basis", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull().default(now),
});

/* ---------------------------------------------------------------------------
 * Regulation lifecycle.
 *
 * A finding records that a rule was observed on a day. It does not record that
 * the rule *replaced* another one, and that gap makes the monitor look like it
 * reads documents rather than law: Permendag 12/2026 is the fifth amendment to
 * 23/2023, and nothing linked them. Competitors track announcement →
 * implementation → revocation; this is the minimum that earns that.
 *
 * Links are their own table rather than columns because the target is often a
 * rule Cante has never fetched — an amendment names its parent whether or not
 * we ever saw the parent.
 * ------------------------------------------------------------------------- */
export const regulationLinks = sqliteTable("regulation_links", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  /** The finding that asserts the relationship. */
  findingId: text("finding_id")
    .notNull()
    .references(() => findings.id),
  /** amends | supersedes | revokes | implements | extends */
  relation: text("relation").notNull(),
  /** The target rule as cited, e.g. "Permendag 23 Tahun 2023". Free text on purpose. */
  targetRef: text("target_ref").notNull(),
  /** Set when the target is a rule we have actually seen. */
  targetFindingId: text("target_finding_id").references(() => findings.id),
  /** The sentence the relationship was read from. Never assert without it. */
  evidence: text("evidence"),
  /** stated | inferred — `stated` means the document said so in terms. */
  confidence: text("confidence").notNull().default("inferred"),
  createdAt: text("created_at").notNull().default(now),
});

/* ---------------------------------------------------------------------------
 * Product structure: bill of materials and substances.
 *
 * `products.materials` is a string array — fine for "PVC coated polyester" and
 * useless for PFAS, REACH or RoHS, which restrict a *substance* at a
 * *concentration* inside a *component*. A flat product cannot answer "does any
 * part of this contain a listed substance above threshold", which is the only
 * question those rules ask.
 * ------------------------------------------------------------------------- */

/** A part within a product. Self-referencing, so assemblies can nest. */
export const productComponents = sqliteTable("product_components", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  /** Null for a top-level component; otherwise the parent part. */
  parentComponentId: text("parent_component_id"),
  name: text("name").notNull(),
  partNumber: text("part_number"),
  supplierId: text("supplier_id").references(() => suppliers.id),
  quantity: real("quantity"),
  unit: text("unit"),
  /** Mass of this component, needed to evaluate concentration thresholds. */
  massGrams: real("mass_grams"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(now),
});

/** A chemical substance, identified the way regulators identify it. */
export const substances = sqliteTable(
  "substances",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** The identifier restriction lists key on. Null only when genuinely unknown. */
    casNumber: text("cas_number"),
    ecNumber: text("ec_number"),
    /** Common synonyms, so a regulation naming one form matches. */
    synonyms: text("synonyms", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => ({
    cas: uniqueIndex("substances_cas_unique").on(table.casNumber),
  }),
);

/** A declared substance inside a component, with its concentration and evidence. */
export const componentSubstances = sqliteTable("component_substances", {
  id: text("id").primaryKey(),
  componentId: text("component_id")
    .notNull()
    .references(() => productComponents.id),
  substanceId: text("substance_id")
    .notNull()
    .references(() => substances.id),
  /** Parts per million within the component. Null means present, amount unknown. */
  concentrationPpm: real("concentration_ppm"),
  /** document | supplier_declaration | human | lead — same discipline as codes. */
  tier: text("tier").notNull().default("lead"),
  basis: text("basis").notNull(),
  /** The supplier declaration this came off, when there is one. */
  supplierDocumentId: text("supplier_document_id").references(() => supplierDocuments.id),
  createdAt: text("created_at").notNull().default(now),
});

/** A regulatory restriction list — REACH SVHC, RoHS Annex II, a state PFAS ban. */
export const restrictedSubstanceLists = sqliteTable("restricted_substance_lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  authority: text("authority"),
  version: text("version"),
  sourceUrl: text("source_url"),
  /** When this snapshot was captured. A stale list is a disclosed caveat. */
  capturedAt: text("captured_at").notNull().default(now),
});

export const restrictedSubstanceEntries = sqliteTable("restricted_substance_entries", {
  id: text("id").primaryKey(),
  listId: text("list_id")
    .notNull()
    .references(() => restrictedSubstanceLists.id),
  substanceId: text("substance_id")
    .notNull()
    .references(() => substances.id),
  /** Concentration at or above which the restriction bites. Null = any presence. */
  thresholdPpm: real("threshold_ppm"),
  /** restricted | banned | authorisation_required | notification_required | candidate */
  restriction: text("restriction").notNull().default("restricted"),
  effectiveOn: text("effective_on"),
  citation: text("citation"),
});

/**
 * What a human did about a finding. Item 4.
 *
 * Kept out of `findings` on purpose: a finding is what the monitor observed and
 * must stay immutable evidence, while this is the mutable human response to it.
 * Collapsing them would let a workflow click rewrite the monitoring record.
 */
export const findingActions = sqliteTable(
  "finding_actions",
  {
    id: text("id").primaryKey(),
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    /** new | acknowledged | assigned | forwarded_to_broker | evidence_requested | irrelevant | closed */
    state: text("state").notNull().default("new"),
    assignee: text("assignee"),
    /** Who it was forwarded to — broker, supplier, internal. */
    forwardedTo: text("forwarded_to"),
    dueAt: text("due_at"),
    /** The broker's or advisor's answer, recorded verbatim. */
    brokerDecision: text("broker_decision"),
    brokerDecidedAt: text("broker_decided_at"),
    note: text("note"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => ({
    finding: uniqueIndex("finding_actions_finding_unique").on(table.findingId),
  }),
);

/**
 * Estimated business impact of one finding on one product/lane. Item 5.
 *
 * Every number here is an estimate built from customer-supplied volumes and a
 * duty delta that may itself be unverified, so `confidence` and `basis` are
 * NOT NULL and the renderer refuses to print a figure without them. A
 * confident-looking dollar amount is exactly the failure rule 2 exists to stop.
 */
export const impactAssessments = sqliteTable("impact_assessments", {
  id: text("id").primaryKey(),
  findingId: text("finding_id")
    .notNull()
    .references(() => findings.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  productId: text("product_id").references(() => products.id),
  laneId: text("lane_id").references(() => tradeLanes.id),
  /** Why this product/lane is implicated — matched code, material, origin, destination. */
  matchReason: text("match_reason").notNull(),
  /** exact_code | code_prefix | material | origin | destination | catalogue_wide */
  matchKind: text("match_kind").notNull(),
  effectiveOn: text("effective_on"),
  /** First shipment on this lane that falls on or after the effective date. */
  nextAffectedShipmentAt: text("next_affected_shipment_at"),
  dutyRateBefore: real("duty_rate_before"),
  dutyRateAfter: real("duty_rate_after"),
  /**
   * Annual duty currently flowing through the matched lane at the published
   * rate — "how much duty this regulation is standing next to".
   *
   * Distinct from `estimatedAnnualExposure`, which is the *delta* when a rate
   * change is known. A published tariff schedule gives today's rate, not
   * tomorrow's, so for most regulation changes the delta is unknowable and the
   * honest magnitude signal is the duty at risk. Reporting one as the other
   * would be the most expensive kind of confident wrong answer.
   */
  annualDutyAtRisk: real("annual_duty_at_risk"),
  /** The HTS row the rate came from, so the figure is checkable. */
  tariffCode: text("tariff_code"),
  /** e.g. "USITC HTS general 8.8%" — printed with the number. */
  tariffBasis: text("tariff_basis"),
  /** Annualised currency delta. Null whenever any input is missing — never zero-as-unknown. */
  estimatedAnnualExposure: real("estimated_annual_exposure"),
  estimatedMonthlyExposure: real("estimated_monthly_exposure"),
  currency: text("currency").notNull().default("USD"),
  /** none | low | medium | high — schedule risk, separate from money. */
  delayRisk: text("delay_risk").notNull().default("none"),
  /**
   * unfavorable | favorable | neutral | unknown.
   *
   * Not every change costs money — a duty reduction or an exclusion grant is
   * worth surfacing too, and a monitor that only ever reports bad news trains
   * the reader to dread it. `unknown` is the default and is a real answer.
   */
  direction: text("direction").notNull().default("unknown"),
  /** Every input and assumption, listed. Printed with the figure or it isn't printed. */
  basis: text("basis", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** verified | estimated | indicative — `verified` requires document-tier inputs throughout. */
  confidence: text("confidence").notNull().default("indicative"),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * A stored restricted-party screening result. Item 10.
 *
 * `lib/screening/csl.ts` already queries Trade.gov's consolidated list; this
 * makes a screen an auditable event with a date, because "we screened them and
 * they were clean" is only worth anything with a timestamp attached.
 */
export const screeningResults = sqliteTable("screening_results", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  supplierId: text("supplier_id").references(() => suppliers.id),
  /** The exact name string screened, preserved so a later re-screen is comparable. */
  screenedName: text("screened_name").notNull(),
  /** csl | manual */
  provider: text("provider").notNull().default("csl"),
  /** clear | match | error — `error` must never render as `clear`. */
  outcome: text("outcome").notNull(),
  matchCount: integer("match_count").notNull().default(0),
  matches: text("matches", { mode: "json" }).$type<StoredScreeningMatch[]>().notNull().default([]),
  errorMessage: text("error_message"),
  /** Source list revision, when the provider reports one. */
  listVersion: text("list_version"),
  screenedAt: text("screened_at").notNull().default(now),
});

export type ClassificationRef = { kind: string; ref: string; title?: string; url?: string };
/**
 * Named `Stored…` so it cannot be confused with `ScreeningMatch` in
 * lib/screening/csl.ts, which is the live upstream shape. This is the flattened
 * copy kept for audit, and the two are allowed to differ.
 */
export type StoredScreeningMatch = {
  name: string;
  source: string;
  programs?: string[];
  url?: string;
  addresses?: string[];
};
export type ExtractedLine = {
  lineNumber?: number;
  sku?: string | null;
  description?: string | null;
  hsCode?: string | null;
  originCountry?: string | null;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  unitValue?: number | null;
  lineValue?: number | null;
};
export type ExtractedDocument = {
  documentNumber?: string | null;
  documentDate?: string | null;
  exporter?: string | null;
  consignee?: string | null;
  originCountry?: string | null;
  destinationCountry?: string | null;
  currency?: string | null;
  totalValue?: number | null;
  lines: ExtractedLine[];
};

export type MessageActivity = {
  id?: string;
  name: string;
  detail: string;
  url?: string;
  hostname?: string;
  results?: { title: string; url: string; hostname: string }[];
};

export type HsCode = { code: string; basis: string; confirmed: boolean };
export type ClassificationCode = { code: string; basis: string; confirmed: boolean };
export type RelevanceGuidance = {
  likelyRelevant: string[];
  almostNeverRelevant: string[];
  note?: string;
};
export type ChecklistRule = { ref: string; title?: string; url?: string };

export type Conversation = typeof conversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type KbliRecord = typeof kbliRecords.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type SourcePack = typeof sourcePacks.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type JurisdictionProfile = typeof jurisdictionProfiles.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type CheckRun = typeof checkRuns.$inferSelect;
export type SourceResult = typeof sourceResults.$inferSelect;
export type SourceDocument = typeof sourceDocuments.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type Alert = typeof alerts.$inferSelect;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductClassification = typeof productClassifications.$inferSelect;
export type TradeLane = typeof tradeLanes.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type SupplierDocument = typeof supplierDocuments.$inferSelect;
export type TradeDocument = typeof tradeDocuments.$inferSelect;
export type DocumentFinding = typeof documentFindings.$inferSelect;
export type FindingAction = typeof findingActions.$inferSelect;
export type ImpactAssessment = typeof impactAssessments.$inferSelect;
/** Row type. `ScreeningResult` in lib/screening/csl.ts is the upstream payload. */
export type ScreeningResultRow = typeof screeningResults.$inferSelect;
export type RegulationLink = typeof regulationLinks.$inferSelect;
export type ProductComponent = typeof productComponents.$inferSelect;
export type Substance = typeof substances.$inferSelect;
export type ComponentSubstance = typeof componentSubstances.$inferSelect;
export type RestrictedSubstanceList = typeof restrictedSubstanceLists.$inferSelect;
export type RestrictedSubstanceEntry = typeof restrictedSubstanceEntries.$inferSelect;
