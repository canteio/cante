// Must be first: loads .env before any module reads process.env.
import "./load-env";
import { runCheck } from "../lib/checks/run";
import { getDefaultCustomerId, getRunHistory } from "../lib/db/queries";
import { normalizeJurisdiction } from "../lib/countries";
import { dispatchRun, notifyRunFailure } from "../lib/delivery/dispatch";
import { telegramConfig, verifyTelegram } from "../lib/delivery/telegram";
import { spawn } from "node:child_process";

/**
 * The cron entrypoint: run the check, send the result, exit with a code cron
 * can act on.
 *
 * `npm run check` is for a human at a terminal. This is for 07:00 with nobody
 * watching, and the difference is entirely in the failure handling:
 *
 *   - a crash is caught and *announced*, not just logged to a file no one reads
 *   - a non-zero exit lets cron's own MAILTO or a wrapper notice
 *   - every outcome, including "nothing changed", produces a message
 *
 * A monitor that goes quiet when it breaks teaches its reader that silence
 * means "all clear". That is the most expensive failure this product has, and
 * it is a delivery bug, not a judgment bug.
 *
 * Usage:
 *   npm run check:scheduled
 *   CANTE_COUNTRY="United States" npm run check:scheduled
 *   npm run check:scheduled -- --verify   # check Telegram config and exit
 */

/**
 * Dead-man's switch.
 *
 * `notifyRunFailure()` covers a check that ran and broke. It cannot cover the
 * machine being off — a power cut, a macOS update reboot, an unplugged laptop
 * — and that produces exactly the silence the delivery layer exists to
 * prevent: no message, indistinguishable from a quiet day.
 *
 * So the run pings an external watcher on success. If the ping stops arriving,
 * the watcher tells you, from infrastructure your Mac cannot take down with it.
 * Any URL works (Healthchecks.io, Better Stack, Cronitor); set
 * CANTE_HEARTBEAT_URL or leave it unset and skip the whole mechanism.
 *
 * Failure is deliberately swallowed: a heartbeat that cannot be sent must not
 * turn a healthy run into a failed one.
 */
async function heartbeat(outcome: "success" | "fail", detail: string): Promise<void> {
  const base = process.env.CANTE_HEARTBEAT_URL?.trim();
  if (!base) return;
  const url = outcome === "success" ? base : `${base.replace(/\/$/, "")}/fail`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    await fetch(url, { method: "POST", body: detail.slice(0, 2000), signal: controller.signal });
    clearTimeout(timer);
    log(`Heartbeat ${outcome} sent.`);
  } catch (error) {
    log(`Heartbeat could not be sent: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

async function runCloudDataCommand(script: "db:cloud:pull" | "db:cloud:sync"): Promise<void> {
  if (process.env.CANTE_SYNC_SUPABASE !== "true") return;
  log(script === "db:cloud:pull" ? "Pulling production customer inputs..." : "Syncing the completed local run to Supabase...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(output.trim().slice(-2_000) || `cloud sync exited ${code}`));
    });
  });
  log(script === "db:cloud:pull" ? "Production inputs updated locally." : "Supabase sync verified.");
}

async function main(): Promise<number> {
  if (process.argv.includes("--verify")) {
    const config = telegramConfig();
    if (!config) {
      log("Telegram NOT configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
      log("Without them the check still runs; the alert waits in the dashboard.");
      return 1;
    }
    const health = await verifyTelegram(config);
    log(health.ok ? `Telegram OK — ${health.detail}` : `Telegram FAILED — ${health.detail}`);
    return health.ok ? 0 : 1;
  }

  const jurisdiction = normalizeJurisdiction(process.env.CANTE_COUNTRY);
  try {
    await runCloudDataCommand("db:cloud:pull");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`SUPABASE INPUT PULL FAILED: ${detail}`);
    const notice = await notifyRunFailure(
      `${jurisdiction} check did not start because production customer inputs could not be pulled:\n${detail}`,
    );
    log(notice.detail);
    await heartbeat("fail", `Supabase input pull failed: ${detail}`);
    return 2;
  }

  const customerId = process.env.CANTE_CUSTOMER_ID ?? (await getDefaultCustomerId());
  if (!customerId) {
    log("No customer in the database. Run `npm run db:seed` first.");
    return 1;
  }

  log(`Starting ${jurisdiction} check for ${customerId}`);

  let runId: string;
  try {
    ({ runId } = await runCheck(customerId, undefined, jurisdiction));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error.";
    log(`CHECK FAILED: ${detail}`);
    // The whole point of this script. A crash must reach a human today, not
    // whenever someone next opens the dashboard.
    const notice = await notifyRunFailure(`${jurisdiction} check crashed:\n${detail}`);
    log(notice.detail);
    await heartbeat("fail", `check crashed: ${detail}`);
    return 2;
  }

  const [entry] = await getRunHistory(customerId, 1, jurisdiction);
  const failedSources = entry.sourceResults.filter((r) => !r.success);
  const flagged = entry.findings.filter((f) => f.relevance === "flagged").length;
  const noted = entry.findings.filter((f) => f.relevance === "noted").length;

  log(
    `Run ${runId} — ${entry.run.status} · ` +
      `${entry.sourceResults.length - failedSources.length}/${entry.sourceResults.length} sources OK · ` +
      `${flagged} flagged, ${noted} noted`,
  );
  for (const source of failedSources) {
    log(`  FAILED ${source.sourceName}: ${source.errorMessage ?? "no detail"}`);
  }

  // A run that finished but failed judgment is not a quiet day either.
  if (entry.run.status !== "complete") {
    const notice = await notifyRunFailure(
      `${jurisdiction} run ${runId} ended with status "${entry.run.status}".\n` +
        (entry.run.errorMessage ?? "No error message was recorded."),
    );
    log(notice.detail);
    await heartbeat("fail", `run ${runId} status ${entry.run.status}`);
    return 2;
  }

  try {
    await runCloudDataCommand("db:cloud:sync");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`SUPABASE SYNC FAILED: ${detail}`);
    const notice = await notifyRunFailure(
      `${jurisdiction} run ${runId} completed locally, but the production Supabase sync failed:\n${detail}`,
    );
    log(notice.detail);
    await heartbeat("fail", `Supabase sync failed after run ${runId}: ${detail}`);
    return 2;
  }

  const delivery = await dispatchRun(runId);
  log(`Delivery: ${delivery.outcome} via ${delivery.channel} — ${delivery.detail}`);

  // Configured-but-broken is a real failure. Unconfigured is not — the pilot
  // runs with manual copy-out on purpose.
  if (delivery.outcome === "failed") {
    await heartbeat("fail", `delivery failed: ${delivery.detail}`);
    return 3;
  }

  await heartbeat(
    "success",
    `${flagged} flagged, ${noted} noted, ${failedSources.length} sources failed`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[${timestamp()}] FATAL: ${error instanceof Error ? error.stack : error}`);
    process.exit(2);
  });
