import { z } from "zod";
import {shipmentFields,shipmentSchema,type ShipmentDetails} from './shipment';

export const AUDIT_VERSION = "historical-audit-v37";
export const READABLE_AUDIT_VERSIONS = ["historical-audit-v1", "historical-audit-v2", "historical-audit-v3", "historical-audit-v4", "historical-audit-v5", "historical-audit-v6", "historical-audit-v7", "historical-audit-v8", "historical-audit-v9", "historical-audit-v10", "historical-audit-v11", "historical-audit-v12", "historical-audit-v13", "historical-audit-v14", "historical-audit-v15", "historical-audit-v16", "historical-audit-v17", "historical-audit-v18", "historical-audit-v19", "historical-audit-v20", "historical-audit-v21", "historical-audit-v22", "historical-audit-v23", "historical-audit-v24", "historical-audit-v25", "historical-audit-v26", "historical-audit-v27", "historical-audit-v28", "historical-audit-v29", "historical-audit-v30", "historical-audit-v31", "historical-audit-v32", "historical-audit-v33", "historical-audit-v34", "historical-audit-v35", "historical-audit-v36", AUDIT_VERSION];
export const fields = {
  entry: "Entry number", line: "Entry line", date: "Entry date", sku: "SKU / product identifier",
  description: "Product description", hts: "HTS code", origin: "Declared origin", supplier: "Supplier",
  value: "Customs value (USD)", basePaid: "Base duty paid", additionalPaid: "Additional duties paid", paid: "Total duties paid",
  currency: "Currency", chapter99: "Chapter 99 codes", quantity: "Quantity", unit: "Quantity unit",
  documents: "Supporting document references", evidenceOrigin: "Origin on supporting evidence", evidenceHts: "HTS on supporting evidence", exclusion: "Exclusion claim",
  ...shipmentFields,
} as const;
export type Field = keyof typeof fields;
export type Mapping = Record<Field, string | null>;
export const optionsSchema = z.object({ dateFormat: z.enum(["iso", "mdy", "dmy"]), currencyUsd: z.boolean(), dutiesOnly: z.boolean(), ordinaryConsumption: z.boolean(), componentsComplete: z.boolean(), standardCoverage: z.boolean().default(false),programExceptionsClear:z.boolean().default(false),saveMissingProducts:z.boolean().optional() }).strict();
export type AuditOptions = z.infer<typeof optionsSchema>;
export const defaultOptions: AuditOptions = { dateFormat: "iso", currencyUsd: false, dutiesOnly: false, ordinaryConsumption: false, componentsComplete: false, standardCoverage: false,programExceptionsClear:false,saveMissingProducts:true };
export interface AuditEntry {
  shipment?:ShipmentDetails;
  row: number; entry: string; line: string; date: string; sku: string; description: string; hts: string; origin: string; supplier: string;
  value: string | null; paid: string | null; basePaid: string | null; additionalPaid: string | null; quantity: string | null; unit: string;
  chapter99: string[]; documents: string[]; evidenceOrigin: string; evidenceHts: string; exclusion: string; errors: string[]; warnings: string[]; raw: Record<string, string>;
}
export type FactValue = string | boolean;
export const facts = ["wood_scope_verified", "wood_auto_overlap_clear", "wood_cabinet_use", "origin_verified", "classification_verified", "related_article_verified", "exclusion_qualified", "adcvd_clear", "other_232_clear", "russian_aluminum_clear", "section301_transit_clear", "ieepa_exceptions_clear", "border_exceptions_clear", "reciprocal_exceptions_clear", "section122_exceptions_clear", "country301_exceptions_clear", "standard_commercial", "content_values_verified", "adcvd_scope_verified", "adcvd_party_verified", "adcvd_instructions_clear", "adcvd_cases_complete", "usmca_qualified", "usmca_duty_free", "metal_weight_verified", "no_metal_content", "metal_special_claim", "copper_exceptions_clear", "copper_full_value_assessment", "steel_derivative_covered", "aluminum_derivative_covered", "aluminum_primary_covered", "us_steel_melt_pour", "us_aluminum_smelt_cast", "russian_aluminum_subject", "us_metal_qualified", "uk_metal_qualified", "motorcycle_use", "equipment_use"] as const;
export const factDecisionSchema = z.object({ row: z.number().int().min(0).max(500), kind: z.enum(["note", "reviewed", "resolved", "confirm_facts", "rules_updated"]), note: z.string().trim().min(10).max(2000), evidence: z.array(z.string().trim().min(1).max(200)).max(20).default([]), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), validBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), productId:z.string().min(1).max(100).optional(), origin: z.string().regex(/^[A-Z]{2}$/).optional(), hts: z.string().regex(/^\d{10}$/).optional(), exclusion: z.string().regex(/^99\d{2}\.\d{2}\.\d{2}$/).optional(), shipment:shipmentSchema.optional(), exclusionScope:z.string().regex(/^20\([a-z]{1,3}\)(?:\((?:i|ii|iii|iv)\))?\(\d{1,3}\)$/).optional(), facts: z.record(z.enum(facts), z.boolean()).optional() }).strict().refine(d=>d.row>0||d.kind==="rules_updated","Audit-wide events must be rule updates.").refine(d=>!d.origin||d.facts?.origin_verified===true,"An origin correction requires an explicit reviewed legal-origin decision.").refine(d=>!d.hts||d.facts?.classification_verified===true,"An HTS correction requires an explicit reviewed classification decision.").refine(d=>!d.shipment?.relatedArticleHts||d.facts?.related_article_verified===true,"A complete article correction requires an explicit reviewed relationship and classification decision.").refine(d=>!d.exclusion||d.facts?.exclusion_qualified===true,"An exclusion decision requires explicit evidence-backed qualification.");
export type FactDecision = z.infer<typeof factDecisionSchema> & { id?: string; actor_id?: string; created_at?: string; revision?: number };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const conditions = z.record(z.string().max(60), z.union([z.boolean(), z.string().max(100)]));
export const bundleSchema = z.object({
  version: z.literal(1), synthetic: z.boolean().default(false), title: z.string().trim().min(3).max(160),
  supersedes: z.array(z.string().uuid()).max(20).default([]),
  coverage: z.array(z.object({ hts: z.array(z.string().regex(/^\d{10}$/)).min(1).max(100), origins: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(100), from: date, before: date, entryTypes:z.array(z.string().regex(/^\d{2}$/)).min(1).max(100).optional(), requiredFacts: z.array(z.enum(facts)).max(facts.length), sourceIds: z.array(z.string().min(1).max(80)).min(1).max(20) }).strict()).min(1).max(50),
  measures: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(180), type: z.enum(["base", "section301", "section232", "chapter99", "adcvd"]), hts: z.array(z.string().regex(/^\d{2,10}$/)).min(1).max(100), origins: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(100), from: date, before: date, rate: z.string().min(1).max(100), basis: z.enum(["customs_value", "steel_content", "aluminum_content", "copper_content", "non_metal_content", "non_steel_content", "non_aluminum_content", "non_copper_content", "non_steel_aluminum_content", "non_steel_copper_content", "non_aluminum_copper_content", "non_us_content", "non_us_content_capped40", "dutiable_value"]).default("customs_value"), quantityBasis: z.literal("copper_content").optional(), conditions: conditions.default({}), sourceIds: z.array(z.string().min(1).max(80)).min(1).max(20) }).strict()).min(1).max(500),
  stacking: z.array(z.object({ id: z.string().min(1).max(80), target: z.string().min(1).max(80), action: z.enum(["include", "exclude", "cap_at"]), cap: z.string().regex(/^\d+(?:\.\d{1,8})?$/).nullable(), conditions, from: date, before: date, explanation: z.string().min(10).max(2000), sourceIds: z.array(z.string().min(1).max(80)).min(1).max(20) }).strict()).max(100).default([]),
}).strict();
export type BundleDefinition = z.infer<typeof bundleSchema>;
export interface BundleSource { id: string; url: string; title: string; sha256: string; body: string; encoding: "utf8" | "base64"; capturedAt: string; referenceId?:string }
export interface RuleBundle { id: string; definition: BundleDefinition; sources: BundleSource[]; approved_by: string | null; approved_at: string | null; status: "draft" | "approved" | "rejected" }
export interface Finding { type: string; title: string; reason: string; next: string; missing: string[]; certainty: "calculated" | "review" }
export interface AuditResult {
  tariffColumn?:'column1'|'column2';
  componentReporting?:{group:string;articleValue:string;componentValueSum:string;memberRows:number[];suffixes:string[];note:string};
  paymentStage?:"cash_deposit"|"final_assessment";
  chapter99?:{declared:string[];evaluated:string[];unresolved:string[];exclusion:string|null;exemptions?:{heading:string;taxableBasis:string;reason:string;sourceIds:string[]}[];notApplicable?:{heading:string;reason:string}[]};
  appliedExclusion?:string;
  appliedExclusionScope?:string;
  validation?: {kind:"human_reviewed"|"cante_validated";compiler:string;assumptions:string[]};
  reference?: import("@/app/api/tariff/references/store").AuditReference;
  row: number; productId: string | null; expected: string | null; paid: string | null; difference: string | null;
  appliedHts:string;appliedOrigin:string;factsUsed:Record<string,FactValue>;
  basis: "declared" | "reviewed"; components: { quantityInputs?:{rate:string;unit:string;quantity:string|null}[];basis?:BundleDefinition["measures"][number]["basis"];assessedValue?:string|null;quantity?:string|null;unit?:string;id: string; label: string; rate: string; amount: string; effectiveFrom: string; effectiveBefore: string; sourceIds: string[]; explanation: string }[];
  findings: Finding[]; bundleId: string | null; decisions: string[];
}
