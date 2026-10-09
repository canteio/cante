import "./load-env";
import { readFileSync } from "node:fs";
import { importProductsCsv } from "../lib/catalogue/products";
import { parseBusinessImpact, evaluateBusinessImpact } from "../lib/tariff/business-impact";
import { createImpactRun } from "../lib/tariff/business-impact-store";
import { getDefaultCustomerId } from "../lib/db/queries";

/**
 * Runs the real, un-mocked product-catalogue import and tariff-impact
 * pipeline (the same functions app/api/products and app/api/tariff/impact-runs
 * call) against the real public LulzBot product list and the real public
 * Aleph Objects import manifests ImportGenius publishes. No credentials
 * entered, no browser session faked: outside a request `createClient()`
 * falls back to the service-role client (see lib/supabase/server.ts), which
 * is the documented pattern every other scripts/*.ts file already uses.
 *
 * This writes one real, retrievable run into the configured tenant
 * (CANTE_CUSTOMER_ID) so it shows up in Tariff → Saved reviews the next time
 * someone signs in — proof the pipeline works end to end, not a console log.
 */
async function main() {
  const customerId = process.argv[2] ?? process.env.CANTE_CUSTOMER_ID ?? (await getDefaultCustomerId());
  if (!customerId) throw new Error("No customer id. Set CANTE_CUSTOMER_ID or pass one as an argument.");
  console.log(`Using customer ${customerId}\n`);

  console.log("== 1. Importing public LulzBot product list ==");
  const productsCsv = readFileSync("public/examples/lulzbot-public-products.csv", "utf8");
  const productSummary = await importProductsCsv(customerId, productsCsv);
  console.log(`created=${productSummary.created} updated=${productSummary.updated} unchanged=${productSummary.unchanged} rejected=${productSummary.rejected}`);
  for (const row of productSummary.rows) console.log(`  row ${row.line} (${row.sku}): ${row.outcome}${row.reason ? ` — ${row.reason}` : ""}`);

  console.log("\n== 2. Evaluating the real public Aleph Objects import manifests ==");
  const manifestCsv = readFileSync("scripts/test-fixtures/lulzbot-public-manifests.csv", "utf8");
  const parsed = parseBusinessImpact(manifestCsv);
  const evaluated = await evaluateBusinessImpact(parsed);
  for (const row of evaluated) {
    console.log(`  row ${row.row_number}: status=${row.status} sku=${row.sku ?? "—"} hts=${row.hts ?? "—"} error=${row.error ?? "—"}`);
  }

  console.log("\n== 3. Persisting the run exactly as the Imports & results upload would ==");
  const run = await createImpactRun(customerId, manifestCsv, "lulzbot-public-manifests.csv (verification run)", evaluated);
  console.log(`Saved run ${run.id}: ${run.computed_count} computed, ${run.unresolved_count} unresolved, ${run.error_count} need corrected data.`);
  console.log(`Estimated annual duty delta: ${run.estimated_annual_duty_delta_usd === null ? "withheld (not calculable)" : run.estimated_annual_duty_delta_usd}`);
  console.log("\nSign in and open Tariff → Saved reviews to see this run in the UI.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
