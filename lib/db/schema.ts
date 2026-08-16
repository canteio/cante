import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  /** kbli | oss | sni | tax_customs | trade | national_law | regional */
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
  /** whatsapp | email | manual */
  channel: text("channel").notNull().default("manual"),
  /** pending | delivered | skipped */
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveredAt: text("delivered_at"),
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

export type MessageActivity = {
  id?: string;
  name: string;
  detail: string;
  url?: string;
  hostname?: string;
  results?: { title: string; url: string; hostname: string }[];
};

export type HsCode = { code: string; basis: string; confirmed: boolean };
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
export type Source = typeof sources.$inferSelect;
export type CheckRun = typeof checkRuns.$inferSelect;
export type SourceResult = typeof sourceResults.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
