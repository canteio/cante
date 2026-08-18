import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Load `.env` before anything else reads `process.env`.
 *
 * This exists because a LaunchAgent (and cron) inherits none of your shell
 * environment — no profile, no exports, nothing. Without it, a scheduled run
 * silently loses TELEGRAM_BOT_TOKEN and records every alert as `skipped` while
 * working perfectly when you test it by hand. That gap between "works in my
 * terminal" and "works at 07:00" is exactly the kind of failure this project
 * refuses to ship.
 *
 * Imported first, on its own line, because CommonJS executes imports in order
 * and some modules (lib/db/client.ts and CANTE_DB_PATH) read the environment
 * at module load. Keep it above the other imports.
 *
 * Real environment variables always win: `loadEnvFile` does not overwrite a
 * value that is already set, so an export or a plist entry still overrides the
 * file.
 */
const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.warn(`[env] .env exists but could not be read: ${error instanceof Error ? error.message : error}`);
  }
}
