import "./load-env";
import { createServiceClient } from "../lib/supabase/service";
import { currentHtsRevision } from "../lib/classification/semantic";

/**
 * Daily check: is the live USITC HTS revision newer than what Supabase has
 * ingested? If so, run the full ingestion automatically — no human approval
 * gate, by deliberate design (see commit message / cante/company-plan).
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
  const { data, error } = await client
    .from("hts_schedule_embeddings")
    .select("hts_revision")
    .limit(1)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to read ingested HTS revision: ${error.message}`);

  const ingested = data?.[0]?.hts_revision ?? null;
  console.log(JSON.stringify({ liveRevision: live, ingestedRevision: ingested }));

  if (ingested === live) {
    console.log(`Up to date: ingested revision ${ingested} matches live revision ${live}. No action.`);
    return;
  }

  console.log(
    ingested
      ? `Revision changed: ${ingested} -> ${live}. Running full ingestion.`
      : `No revision ingested yet. Running full ingestion for ${live}.`,
  );

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
