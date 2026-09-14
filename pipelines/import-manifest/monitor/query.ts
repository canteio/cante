import { z } from "zod";
import { queryShipments } from "../search/search-shipments";
import { recent, type MonitorState } from "./model";

export const monitorQuery = z.object({
  cargo: z.string().trim().max(200).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  importer: z.string().trim().max(200).optional(),
  hsChapter: z.string().regex(/^\d{2}$/).optional(),
  kind: z.enum(["named_importer", "commodity_candidate", "all"]).default("named_importer"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export function searchMonitor(state: MonitorState | null, rawQuery: unknown, now = new Date().toISOString()) {
  const query = monitorQuery.parse(rawQuery);
  const caveats = [
    "Ocean manifests only; confidentiality redactions and unknown parties reduce coverage.",
    "Country means shipper address country, not country of manufacture or origin.",
    "Named importer means an exact normalized CPSC importer name plus commodity overlap; verify the linked recall. It does not prove this shipment contains recalled units.",
    "Active means a manifest filed in the past 180 days, not confirmed delivery. Commodity candidates do not establish that the importer was recalled.",
  ];
  if (!state) return { status: "never_run", updatedAt: null, sources: null, caveats, total: 0, results: [] };
  const stale = Date.parse(now) - Date.parse(state.updatedAt) > 2 * 86400000 ||
    Object.values(state.sources).some(s => s.status !== "ok" || !s.dataAsOf || Date.parse(now) - Date.parse(s.dataAsOf) > 7 * 86400000);
  if (stale) caveats.unshift("Coverage is incomplete or stale. Results may use retained evidence; an empty list does not mean no importers were recalled.");
  const shipments = queryShipments(state.shipments, { shipperCountryCode: query.country,
    cargoDescriptionContains: query.cargo, consigneeNameContains: query.importer,
    hsChapter: query.hsChapter, excludeRedacted: true });
  const byId = new Map(shipments.map(s => [s.id, s]));
  // Expiry is evaluated when queried too, so a stopped worker cannot leave
  // last month's importer marked active forever.
  const leads = state.leads.filter(l => byId.has(l.shipmentId) && recent(l.recallDate, now) &&
    recent(byId.get(l.shipmentId)!.manifestFiledDate, now) && (query.kind === "all" || query.kind === l.kind))
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || a.id.localeCompare(b.id));
  return { status: stale ? "incomplete" : "current", updatedAt: state.updatedAt, sources: state.sources,
    caveats, total: leads.length, results: leads.slice(query.offset, query.offset + query.limit).map(l => ({
      ...l, newInLatestRun: state.newLeadIds.includes(l.id), shipment: byId.get(l.shipmentId)!,
    })) };
}
