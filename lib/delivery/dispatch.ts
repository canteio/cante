import type * as Schema from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

import { type Alert } from "@/lib/db/schema";
import {
  sendTelegram,
  telegramConfig,
  TelegramError,
  type EnvLike,
} from "@/lib/delivery/telegram";

/**
 * Turning a completed run into a message somebody actually receives.
 *
 * The design rule here is the one the whole product rests on, applied to
 * delivery: **an operator must never have to guess whether the check ran.**
 * Three states have to be distinguishable at a glance in the phone —
 *
 *   - it ran and found nothing          → a short quiet-day note
 *   - it ran and found something        → the alert
 *   - it did not run, or it broke       → an explicit failure message
 *
 * A monitor that stays silent on failure is worse than no monitor, because the
 * reader concludes "nothing changed" from what is actually "nothing happened".
 * That is why `notifyRunFailure()` exists and why it is called even when there
 * is no alert row to send.
 */

export type DeliveryOutcome = "delivered" | "failed" | "skipped";

export interface DispatchResult {
  outcome: DeliveryOutcome;
  channel: string;
  detail: string;
  alertId: string | null;
}

/** The alert written by a run, if it produced one. */
export async function alertForRun(runId: string): Promise<Alert | undefined> {
  const supabase = await createClient();
  return (cloudResult<typeof Schema.alerts.$inferSelect | null>(
    await supabase
      .from("alerts")
      .select("*")
      .eq("check_run_id", runId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
}

async function recordDelivery(
  alert: Alert,
  outcome: DeliveryOutcome,
  channel: string,
  error: string | null,
): Promise<void> {
  const supabase = await createClient();
  cloudResult(
    await supabase
      .from("alerts")
      .update(snakeRow({
        channel,
        deliveryStatus: outcome,
        deliveredAt: outcome === "delivered" ? new Date().toISOString() : null,
        deliveryError: error,
        deliveryAttempts: alert.deliveryAttempts + 1,
      }))
      .eq("id", alert.id),
  );
}

/**
 * Format a short, concise Telegram digest for the operator.
 *
 * Keeps Telegram brief and high-signal:
 * - Immediate status ("All clear" vs "N flagged")
 * - Bullet list of flagged/noted regulations (title + ref) without dumping full prose
 * - Breakdown of sources checked and entries parsed
 * - Prompts to open the Web GUI for deep dive / chat
 */
/**
 * The "what changed" section of this run's alert, trimmed for a phone.
 *
 * `runCheck()` researches the before/after for flagged and noted findings and
 * writes it into `alert.body`. Reading it back here keeps one source of truth —
 * the digest never re-derives or re-words it, so the operator and the customer
 * cannot end up with two different accounts of the same change.
 */
async function alertBriefingExcerpt(runId: string, limit = 1400): Promise<string> {
  const supabase = await createClient();
  const alert = (cloudResult<typeof Schema.alerts.$inferSelect | null>(
    await supabase
      .from("alerts")
      .select("*")
      .eq("check_run_id", runId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  if (!alert?.body) return "";
  const marker = alert.body.match(/\n---\n(Rincian perubahan|What changed):\n/);
  if (!marker?.index) return "";

  const start = marker.index;
  // Stop at the coverage notes; those are a separate section with their own
  // audience, and the digest deliberately does not carry them.
  const notes = alert.body.indexOf("\n---\n", start + marker[0].length);
  const section = alert.body.slice(start, notes === -1 ? undefined : notes).trimEnd();

  if (section.length <= limit) return `\n${section}`;
  // Cut on a line boundary; a half-sentence about a duty change is worse than
  // an obvious "read the rest on the dashboard".
  const cut = section.lastIndexOf("\n", limit);
  return `\n${section.slice(0, cut > 0 ? cut : limit)}\n… (selengkapnya di dashboard)`;
}

export async function formatTelegramDigest(runId: string): Promise<string> {
  const supabase = await createClient();
  const run = (cloudResult<typeof Schema.checkRuns.$inferSelect | null>(
    await supabase
      .from("check_runs")
      .select("*")
      .eq("id", runId)
      .limit(1)
      .maybeSingle(),
  ) ?? undefined);
  const { data: sourceRows, error: sourceError } = await supabase
    .from("source_results")
    .select("id, source_id, success, error_message, entries_parsed, parse_warning, sources(name)")
    .eq("check_run_id", runId);
  if (sourceError) throw new Error(`Supabase source results read failed: ${sourceError.message}`);
  const results = (sourceRows ?? []).map((row) => ({
    id: row.id, sourceId: row.source_id, success: row.success,
    errorMessage: row.error_message, entriesParsed: row.entries_parsed,
    parseWarning: row.parse_warning,
    sourceName: (Array.isArray(row.sources) ? row.sources[0] : row.sources)?.name ?? null,
  }));
  const found = cloudResult<Array<typeof Schema.findings.$inferSelect>>(
    await supabase
      .from("findings")
      .select("*")
      .eq("check_run_id", runId),
  );

  const failedResults = results.filter((r) => !r.success);
  const okCount = results.length - failedResults.length;
  const flagged = found.filter((f) => f.relevance === "flagged");
  const noted = found.filter((f) => f.relevance === "noted");

  const lines: string[] = [
    `🛡️ Cante — ${run?.jurisdiction ?? "United States"} — ${new Date().toISOString().slice(0, 10)}`,
    `${okCount}/${results.length} sources OK` +
    (failedResults.length > 0 ? ` · ${failedResults.length} FAILED` : ""),
  ];

  if (flagged.length === 0 && noted.length === 0) {
    lines.push("\n✅ Status: All clear — nothing new affecting operations today.");
  } else if (flagged.length === 0 && noted.length > 0) {
    lines.push("\n✅ Status: All clear (No action required today)");
    lines.push(`Zero regulatory risks or restrictions affecting operations. ${noted.length} general law(s) were published and reviewed:`);
    lines.push("\nℹ️ Monitored updates (Informational only — no direct impact):");
    for (const item of noted) {
      const label = item.regulationRef ? `${item.regulationRef} — ` : "";
      lines.push(`• ${label}${item.title}`);
    }
    const briefing = await alertBriefingExcerpt(runId);
    if (briefing) lines.push(briefing);
    lines.push("\n👉 Open Cante Copilot to inspect details or ask questions.");
  } else {
    lines.push(`\n🚨 Status: Action Required (${flagged.length} item${flagged.length === 1 ? "" : "s"} need attention)`);
    lines.push("\n⚠️ Flagged for your company:");
    for (const item of flagged) {
      const label = item.regulationRef ? `${item.regulationRef} — ` : "";
      lines.push(`• ${label}${item.title}`);
    }
    if (noted.length > 0) {
      lines.push("\nℹ️ Also monitored (Informational):");
      for (const item of noted) {
        const label = item.regulationRef ? `${item.regulationRef} — ` : "";
        lines.push(`• ${label}${item.title}`);
      }
    }
    const briefing = await alertBriefingExcerpt(runId);
    if (briefing) lines.push(briefing);
    lines.push("\n👉 Open Cante Copilot to review pre-drafted broker and supplier actions.");
  }

  if (results.length > 0) {
    lines.push("\nSources checked:");
    for (const r of results) {
      const name = r.sourceName || r.sourceId;
      if (r.success) {
        const entries = `${r.entriesParsed} ${r.entriesParsed === 1 ? "entry" : "entries"}`;
        lines.push(`✓ ${name}: ${entries}`);
      } else {
        lines.push(`✗ ${name}: FAILED (${r.errorMessage ?? "error"})`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Send the alert for a run.
 *
 * `skipped` when no channel is configured — nobody tried, and the alert stays
 * pending in the UI for manual copy-out. That is a legitimate state during the
 * pilot and must not be recorded as a failure.
 */
export async function dispatchRun(
  runId: string,
  options: { env?: EnvLike; signal?: AbortSignal; } = {},
): Promise<DispatchResult> {
  const alert = await alertForRun(runId);
  if (!alert) {
    return {
      outcome: "failed",
      channel: "none",
      detail:
        "The run produced no alert row. It either failed before judgment or never completed; check the run in the dashboard.",
      alertId: null,
    };
  }

  const config = telegramConfig(options.env);
  if (!config) {
    await recordDelivery(alert, "skipped", "manual", "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set.");
    return {
      outcome: "skipped",
      channel: "manual",
      detail:
        "Telegram is not configured, so nothing was sent. The alert is waiting in the dashboard to be copied out by hand.",
      alertId: alert.id,
    };
  }

  const body = await formatTelegramDigest(runId);

  try {
    const sent = await sendTelegram(config, body, { signal: options.signal });
    await recordDelivery(alert, "delivered", "telegram", null);
    return {
      outcome: "delivered",
      channel: "telegram",
      detail: `Sent in ${sent.chunks} message(s).`,
      alertId: alert.id,
    };
  } catch (error) {
    const detail =
      error instanceof TelegramError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown delivery error.";
    await recordDelivery(alert, "failed", "telegram", detail);
    return { outcome: "failed", channel: "telegram", detail, alertId: alert.id };
  }
}

/**
 * Tell the operator the check itself broke.
 *
 * Deliberately best-effort and never throwing: this runs in the failure path,
 * and a delivery error inside the error handler must not replace the original
 * problem in the logs.
 */
export async function notifyRunFailure(
  message: string,
  options: { env?: EnvLike; } = {},
): Promise<{ notified: boolean; detail: string; }> {
  const config = telegramConfig(options.env);
  if (!config) {
    return { notified: false, detail: "Telegram not configured; failure was logged only." };
  }
  try {
    await sendTelegram(
      config,
      `Cante — CHECK FAILED — ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n` +
      `${message}\n\n` +
      "No alert was produced. Treat today as UNCHECKED, not as a quiet day.",
    );
    return { notified: true, detail: "Failure notification sent." };
  } catch (error) {
    return {
      notified: false,
      detail: `Could not notify: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export interface DeliveryHealth {
  consecutiveFailures: number;
  lastDeliveredAt: string | null;
  pending: number;
}

/**
 * Delivery health, so a channel that has been quietly broken for a week is
 * visible. A failed send that nobody notices is the same outage as no monitor.
 */
export async function deliveryHealth(customerId: string, jurisdiction?: string): Promise<DeliveryHealth> {
  const supabase = await createClient();
  let query = supabase.from("alerts").select("*").eq("customer_id", customerId);
  if (jurisdiction) query = query.eq("channel", "telegram");
  const rows = cloudResult<Alert[]>(await query.order("created_at", { ascending: false }));

  let consecutiveFailures = 0;
  for (const row of rows) {
    if (row.deliveryStatus === "failed") consecutiveFailures += 1;
    else break;
  }

  return {
    consecutiveFailures,
    lastDeliveredAt: rows.find((r) => r.deliveryStatus === "delivered")?.deliveredAt ?? null,
    pending: rows.filter((r) => r.deliveryStatus === "pending").length,
  };
}

// Convert SQL column names only; JSON evidence keeps its original keys.
function camelRow<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((row) => camelRow(row)) as T;
  if (!value || typeof value !== "object") return value as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item,
  ])) as T;
}
function snakeRow(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}
function cloudResult<T = unknown>(result: { data?: unknown; error: { message: string; } | null; }): T {
  if (result.error) throw new Error(`Supabase operation failed: ${result.error.message}`);
  return camelRow<T>(result.data);
}
