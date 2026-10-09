import "./load-env";
import { createServiceClient } from "../lib/supabase/service";
import { currentHtsRevision } from "../lib/classification/semantic";

/**
 * Manual/local debugging copy of the HTS revision check.
 *
 * The AUTHORITATIVE, always-on schedule now lives server-side, not here:
 * a pg_cron job ("hts-revision-check-every-6h", see
 * supabase/migrations/202610080002_hts_revision_cron.sql) calls the
 * deployed supabase/functions/hts-revision-check Edge Function every 6
 * hours via pg_net, with no human or coding agent needing to remember to
 * run anything. That Edge Function is a Deno port of this script's exact
 * logic (plus ingest-hts-schedule.ts's logic inline, time-boxed per
 * invocation) and is the one that actually keeps hts_schedule_embeddings
 * current in production.
 *
 * This script still exists, and `npm run hts:check-revision` still works,
 * purely for local/manual debugging (e.g. verifying the live USITC
 * revision, or forcing a local re-ingestion run outside the cron cadence).
 * It is not relied on for production correctness, so a developer or coding
 * agent forgetting to run it has no production consequence.
 *
 * If the ingestion logic changes, mirror the change in BOTH
 * scripts/ingest-hts-schedule.ts AND supabase/functions/hts-revision-check
 * (the two cannot share code: one runs on Node, the other on Deno).
 *
 * This script's logic (if revision differs, run the full ingestion
 * automatically, no human approval gate) is deliberate, by the same
 * design the Edge Function now also follows.
 *
 * This is safe to auto-apply where rebuilding tariff RATE logic/data is
 * not, because of what this data actually feeds: embeddings only ever
 * produce AI *candidates* for classification (lib/classification/suggest.ts),
 * and every suggestion stays tier `lead` until a named human adopts it
 * (lib/classification/suggest.ts's adoptSuggestion()). A stale or even a
 * momentarily wrong embedding can at worst show a human reviewer a worse
 * candidate list -- it can never, by itself, change a customs fact or a
 * dollar amount on a shipment. Tariff RATE data (see
 * scripts/ingest-section232-proclamation.ts and its approval-gated
 * `section232_tariff_rows` table) is categorically different and
 * deliberately requires a human approval step before any extracted rate
 * becomes live.
 *
 * Idempotent: ingest-hts-schedule.ts only re-embeds rows whose content hash
 * actually changed, so running this on a no-op day costs one currentRelease
 * check and zero embedding calls.
 */
async function main() {
  const live = await currentHtsRevision();
  const client = createServiceClient();
  const { data, error } = await client.from("hts_chapter_publications").select("chapter,revision");
  if (error) throw new Error(`Failed to read HTS chapter progress: ${error.message}`);
  const completed = new Set((data ?? []).filter(row => row.revision === live).map(row => row.chapter));
  console.log(JSON.stringify({ liveRevision: live, completedChapters: completed.size }));
  if (completed.size === 99) {
    console.log(`All 99 chapters are published for ${live}. No action.`);
    return;
  }
  console.log(`Resuming incomplete revision ${live}.`);

  // Deliberately shells out to the existing, already-reviewed ingestion
  // script rather than reimplementing its logic here, so this auto-trigger
  // can never drift from the manually-run, red-team-reviewed path.
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", new URL("./ingest-hts-schedule.ts", import.meta.url).pathname],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(`HTS ingestion exited with status ${result.status}`);
  }
}

main().catch((error) => {
  console.error("HTS revision check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
