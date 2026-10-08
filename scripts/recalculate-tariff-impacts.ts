// Must be first: loads .env before any module reads process.env.
import "./load-env";
import { recalculateTariffImpacts } from "../lib/tariff/recalculate-customer-impacts";

/**
 * Scheduled entrypoint, invoked on a schedule (cron) — not a permanently
 * running process. Same shape as scripts/scheduled-check.ts: it runs once,
 * logs a line per customer, and exits with a code cron can act on.
 *
 * This closes the gap `lib/checks/run.ts` left open: a monitored
 * trade-rule finding already queues `tariff_monitor_candidates` rows
 * automatically on every scheduled regulatory check, but nothing
 * proactively recomputed the dollar impact or told the customer — they
 * only saw a result if they happened to open the dashboard with the right
 * impact run selected. This script recomputes every customer's impact
 * against their most recent completed run and durably records +
 * delivers only what is materially new or changed.
 *
 * Usage:
 *   npm run tariff:recalculate
 */
function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

async function main(): Promise<number> {
  log("Starting tariff impact recalculation pass...");
  const summary = await recalculateTariffImpacts();
  log(`Evaluated ${summary.customersEvaluated} customer(s) with monitor candidates.`);

  let failures = 0;
  for (const result of summary.customerResults) {
    if (result.skippedReason === "error") failures += 1;
    log(
      `  ${result.customerId}: ${result.findingsEvaluated} finding(s) evaluated, ` +
        `${result.eventsCreated} new event(s), notified=${result.notified} — ${result.notifyDetail}`,
    );
  }

  const createdTotal = summary.customerResults.reduce((sum, r) => sum + r.eventsCreated, 0);
  log(`Done. ${createdTotal} new tariff impact event(s) across ${summary.customersEvaluated} customer(s), ${failures} failure(s).`);
  return failures > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[${timestamp()}] FATAL: ${error instanceof Error ? error.stack : error}`);
    process.exit(2);
  });
