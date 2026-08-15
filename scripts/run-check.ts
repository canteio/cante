import { runCheck } from "../lib/checks/run";
import { getDefaultCustomerId, getRunHistory } from "../lib/db/queries";

/**
 * Same code path as POST /api/checks, minus the browser. Useful for testing
 * the fetch + judgment stages without keeping a dev server open, and for a
 * cron entry later: `npm run check`.
 */
async function main() {
  const customerId = process.argv[2] ?? (await getDefaultCustomerId());
  if (!customerId) throw new Error("No customers. Run `npm run db:seed` first.");

  console.log(`Running check for ${customerId}…`);
  const { runId } = await runCheck(customerId);

  const [entry] = await getRunHistory(customerId, 1);
  console.log(`\nRun ${runId} — ${entry.run.status}`);
  for (const r of entry.sourceResults) {
    const state = !r.success
      ? `FAILED (${r.errorMessage})`
      : r.entriesParsed === 0
        ? "PARSED 0 — unchecked"
        : `ok, ${r.entriesParsed} entries`;
    console.log(`  ${r.sourceName}: ${state}`);
  }
  console.log(`\nFindings: ${entry.findings.length}`);
  for (const f of entry.findings) {
    console.log(`  [${f.relevance}] ${f.regulationRef ?? "?"} — ${f.title}`);
  }
  if (entry.alert) console.log(`\n--- Ready to send ---\n${entry.alert.body}`);
}

main().catch((err) => {
  console.error(`\nCheck failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
