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

// Machine-readable parameter docs so an AI agent probing GET /api/import-monitor
// with bad/no params (its first likely move) gets enough to self-correct from the
// 400 body alone, instead of having to go read this source file or the README.
// Kept as plain data (not derived from the zod schema) so it stays a stable,
// prose-friendly contract even if the schema's internal validation shape changes.
export const monitorQueryDocs = {
  cargo: { type: "string", max: 200, example: "stroller", note: "Substring match against cargo description." },
  country: { type: "string", pattern: "^[A-Z]{2}$", example: "CN", note: "ISO-3166 alpha-2 shipper country, e.g. CN, ID." },
  importer: { type: "string", max: 200, example: "Acme Imports", note: "Substring match against consignee/importer name." },
  hsChapter: { type: "string", pattern: "^\\d{2}$", example: "95", note: "Two-digit HS chapter code." },
  kind: { type: "enum", values: ["named_importer", "commodity_candidate", "all"], default: "named_importer" },
  offset: { type: "integer", min: 0, max: 100000, default: 0 },
  limit: { type: "integer", min: 1, max: 100, default: 50 },
} as const;
export function searchMonitor(state: MonitorState | null, rawQuery: unknown, now = new Date().toISOString()) {
  const query = monitorQuery.parse(rawQuery);
  const caveats = [
    "Ocean manifests only; confidentiality redactions and unknown parties reduce coverage.",
    "Country means shipper address country, not country of manufacture or origin.",
    "Named importer means an exact normalized CPSC importer name plus commodity overlap; verify the linked recall. It does not prove this shipment contains recalled units.",
    "Active means a manifest filed in the past 180 days, not confirmed delivery. Commodity candidates do not establish that the importer was recalled.",
  ];
  // params is echoed on the 200 path too (not just 401/400 in http.ts) so an
  // agent chaining queries — e.g. narrowing a "never_run"/large result set —
  // can read the field contract straight off any response, without having to
  // trigger an error first or go read source/README. Same "self-correct from
  // the body alone" posture as the machine-readable 401/400 docs.
  if (!state) return { status: "never_run", updatedAt: null, sources: null, caveats, total: 0, results: [], params: monitorQueryDocs };
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
  // params doc was only echoed on the "never_run" 200 path plus the 400/401/503
  // error paths (see http.ts) — an agent that gets real "current"/"incomplete"
  // results back (the common case once a workspace has data) lost the field
  // contract exactly when it's chaining/narrowing a real query, the moment it
  // matters most. Echo it on every 200 response, not just the empty-state one.
  return { status: stale ? "incomplete" : "current", updatedAt: state.updatedAt, sources: state.sources,
    caveats, total: leads.length, results: leads.slice(query.offset, query.offset + query.limit).map(l => ({
      ...l, newInLatestRun: state.newLeadIds.includes(l.id), shipment: byId.get(l.shipmentId)!,
    })), params: monitorQueryDocs };
}
