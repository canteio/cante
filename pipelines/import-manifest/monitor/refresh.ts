import { buildLeads, type MonitorState, type SourceStatus } from "./model";
import { ShipmentSourceBlocked, loadShipmentExport, fetchMonitorRecalls } from "./sources";

export interface MonitorStore {
  read(customerId: string): Promise<MonitorState | null>;
  save(customerId: string, state: MonitorState, previousRevision: number): Promise<void>;
}
export async function refreshMonitor(customerId: string, store: MonitorStore, options: {
  now?: string; file?: string;
  shipments?: typeof loadShipmentExport; recalls?: typeof fetchMonitorRecalls;
} = {}) {
  const previous = await store.read(customerId);
  const now = options.now ?? new Date().toISOString();
  const [shipmentResult, recallResult] = await Promise.allSettled([
    (options.shipments ?? loadShipmentExport)(options.file, now),
    (options.recalls ?? fetchMonitorRecalls)(now),
  ]);
  const failure = (error: unknown, old: SourceStatus | undefined): SourceStatus => ({
    status: error instanceof ShipmentSourceBlocked ? "blocked" : "error", checkedAt: now,
    dataAsOf: old?.dataAsOf ?? null, count: old?.count ?? 0,
    // Do not expose local paths, credentials or raw responses in the product.
    message: error instanceof ShipmentSourceBlocked ? error.message : "Refresh failed; any retained data is from the previous successful refresh. Check worker logs.",
    // Keep the blocker actionable in both the UI and API without leaking a
    // worker path: the environment-variable name is stable across deployments.
    nextAction: error instanceof ShipmentSourceBlocked
      ? "Configure CANTE_IMPORT_SHIPMENTS_FILE with an authorized rolling JSON snapshot, then run npm run imports:refresh."
      : "Review the trusted-worker logs, correct the source failure, then run npm run imports:refresh.",
  });
  const shipments = shipmentResult.status === "fulfilled" ? shipmentResult.value.rows : previous?.shipments ?? [];
  const recalls = recallResult.status === "fulfilled" ? recallResult.value : previous?.recalls ?? [];
  const sources: MonitorState["sources"] = {
    shipments: shipmentResult.status === "fulfilled" ? {
      status: shipmentResult.value.sample ? "sample" : "ok", checkedAt: now,
      dataAsOf: shipmentResult.value.observedAt, count: shipments.length,
      message: shipmentResult.value.sample ? "Synthetic sample; excluded from importer leads." : "Authorized file export; not a public live manifest feed.",
    } : failure(shipmentResult.reason, previous?.sources.shipments),
    recalls: recallResult.status === "fulfilled" ? { status: "ok", checkedAt: now, dataAsOf: now,
      count: recalls.length, message: "Official CPSC API, 180-day recall window." } : failure(recallResult.reason, previous?.sources.recalls),
  };
  const seen = { ...previous?.seen };
  const leads = buildLeads(shipments, recalls, now, seen);
  // Outages can retain searchable evidence, but cannot generate fresh lead alerts.
  const healthy = sources.shipments.status === "ok" && sources.recalls.status === "ok" &&
    Date.parse(now) - Date.parse(sources.shipments.dataAsOf!) <= 7 * 86400000;
  const newLeadIds: string[] = [];
  if (healthy) for (const lead of leads.filter(l => l.kind === "named_importer")) {
    // Discovery is importer + recall, not B/L: a second shipment from the same
    // importer must not create another "new importer" notification.
    if (!seen[lead.discoveryId]) newLeadIds.push(lead.id);
    seen[lead.discoveryId] ??= now;
  }
  const state: MonitorState = { revision: (previous?.revision ?? 0) + 1, updatedAt: now,
    shipments, recalls, sources, leads, seen, newLeadIds };
  // Compare-and-swap prevents overlapping cron executions overwriting a newer
  // snapshot or reporting the same first-discovery as two successful runs.
  await store.save(customerId, state, previous?.revision ?? 0);
  return { state, healthy, errors: [shipmentResult, recallResult].flatMap(r => r.status === "rejected" ? [String(r.reason)] : []) };
}
