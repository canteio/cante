import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImportShipmentRow } from "../schema/shipments";
import type { RegulationEntry } from "@/lib/sources/fetch";
import { scoreShipmentAgainstRecall } from "../match/match-shipment-recalls";

export const WINDOW_DAYS = 180;
export const MAX_SHIPMENTS = 5000;
const nullableText = z.string().max(10000).nullable().default(null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Invalid calendar date");

// A delivered, normalized export is a separate adapter from the incomplete
// CAMIR header parser. Never invent B/Ls, parties or arrival dates from headers.
export const shipmentInput = z.object({
  billOfLading: z.string().trim().min(1).max(100),
  carrierScac: nullableText, manifestSequenceNumber: nullableText,
  vesselName: nullableText, vesselImoCode: nullableText, voyageNumber: nullableText,
  portOfLadingCode: nullableText, portOfUnladingCode: nullableText,
  shipperName: nullableText, shipperAddress: nullableText,
  shipperCountryCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
  consigneeName: nullableText, consigneeAddress: nullableText,
  dataRedacted: z.boolean(), cargoDescription: nullableText,
  hsChapter: z.string().regex(/^\d{2}$/).nullable().default(null),
  grossWeightKg: z.number().nonnegative().nullable().default(null),
  packageCount: z.number().int().nonnegative().nullable().default(null),
  containerNumbers: z.array(z.string()).max(500).nullable().default(null),
  estimatedArrivalDate: date.nullable().default(null),
  manifestFiledDate: date.nullable().default(null),
}).strict();
export const shipmentExport = z.object({
  sourceType: z.enum(["sample_fixture", "authorized_export"]),
  sourceRef: z.string().trim().min(1).max(2000),
  // Producer asserts the observation date; rereading yesterday's drop does not
  // refresh its age. This is deliberately distinct from the worker's run time.
  observedAt: z.string().datetime(),
  shipments: z.array(shipmentInput).max(MAX_SHIPMENTS),
}).strict();
export function stableId(...parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function parseShipmentExport(raw: string, now: string) {
  const data = shipmentExport.parse(JSON.parse(raw));
  if (Date.parse(data.observedAt) > Date.parse(now)) throw new Error("Shipment observation is in the future");
  const rows: ImportShipmentRow[] = data.shipments.map(s => ({
    ...s, id: stableId(data.sourceRef, s.carrierScac ?? "", s.billOfLading),
    sourceType: data.sourceType, sourceFileRef: data.sourceRef, ingestedAt: now,
  }));
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("Duplicate shipment identity in export");
  return { rows, observedAt: data.observedAt, sample: data.sourceType === "sample_fixture" };
}

export interface MonitorRecall {
  id: string;
  date: string;
  importers: string[];
  entry: RegulationEntry;
}
export interface SourceStatus {
  status: "ok" | "blocked" | "error" | "sample";
  checkedAt: string;
  dataAsOf: string | null;
  count: number;
  message: string;
  /** Operator-safe recovery instruction; omitted when no action is required. */
  nextAction?: string;
}
export interface Lead {
  id: string;
  shipmentId: string;
  discoveryId: string;
  importer: string;
  recallId: string;
  recallUrl: string;
  recallTitle: string;
  recallDate: string;
  terms: string[];
  kind: "named_importer" | "commodity_candidate";
  firstSeenAt: string;
}
export interface MonitorState {
  revision: number;
  updatedAt: string;
  shipments: ImportShipmentRow[];
  recalls: MonitorRecall[];
  sources: { shipments: SourceStatus; recalls: SourceStatus };
  leads: Lead[];
  // Preserve first discovery across outages, expiry and subsequent reappearance.
  seen: Record<string, string>;
  newLeadIds: string[];
}
export function recent(value: string | null, now: string) {
  if (!value) return false;
  const age = Date.parse(now.slice(0, 10)) - Date.parse(value.slice(0, 10));
  return Number.isFinite(age) && age >= 0 && age <= WINDOW_DAYS * 86400000;
}
function companyKey(value: string) {
  // Punctuation/case only: stripping suffixes or locations could merge firms.
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function buildLeads(shipments: ImportShipmentRow[], recalls: MonitorRecall[], now: string, seen: Record<string, string> = {}): Lead[] {
  return shipments.flatMap(s => {
    // ETA is not proof of delivery: this means recent manifest activity, not
    // confirmed arrival. Unknown country is never automatically assumed US.
    if (s.sourceType === "sample_fixture" || s.dataRedacted || !s.consigneeName || !companyKey(s.consigneeName) ||
      !recent(s.manifestFiledDate, now) ||
      !/\b(?:USA|U\.?S\.?A\.?|United States(?: of America)?)\b/i.test(s.consigneeAddress ?? "")) return [];
    return recalls.filter(r => recent(r.date, now)).flatMap(r => {
      const match = scoreShipmentAgainstRecall(s, r.entry);
      if (!match) return [];
      const named = r.importers.some(n => companyKey(n) === companyKey(s.consigneeName!));
      const id = stableId(s.id, r.id);
      const discoveryId = stableId(companyKey(s.consigneeName!), r.id);
      return [{ id, discoveryId, shipmentId: s.id, importer: s.consigneeName!, recallId: r.id,
        recallUrl: r.entry.url, recallTitle: r.entry.listingTitle, recallDate: r.date,
        terms: match.matchedTerms, kind: named ? "named_importer" as const : "commodity_candidate" as const,
        firstSeenAt: seen[discoveryId] ?? now }];
    });
  });
}
