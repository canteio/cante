import "./load-env";
import { loadShipmentExport } from "@/pipelines/import-manifest/monitor/sources";

/** Validate a delivered snapshot without touching customer storage or fetching
 * recalls. Operators can reject a bad provider file before a scheduled refresh
 * replaces the last usable shipment snapshot. */
async function main() {
  const file = process.argv[2] || process.env.CANTE_IMPORT_SHIPMENTS_FILE;
  const result = await loadShipmentExport(file, new Date().toISOString());
  console.log(JSON.stringify({
    valid: true,
    observedAt: result.observedAt,
    shipmentCount: result.rows.length,
    sample: result.sample,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
