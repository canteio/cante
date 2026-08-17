import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { alerts, checkRuns, findings, sourceResults, type Alert } from "@/lib/db/schema";
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
export function alertForRun(runId: string): Alert | undefined {
  return db.select().from(alerts).where(eq(alerts.checkRunId, runId)).get();
}

function recordDelivery(
  alert: Alert,
  outcome: DeliveryOutcome,
  channel: string,
  error: string | null,
): void {
  db.update(alerts)
    .set({
      channel,
      deliveryStatus: outcome,
      deliveredAt: outcome === "delivered" ? new Date().toISOString() : null,
      deliveryError: error,
      deliveryAttempts: alert.deliveryAttempts + 1,
    })
    .where(eq(alerts.id, alert.id))
    .run();
}

/**
 * Header lines that make a message readable on a phone at 7am, and that make
 * partial coverage visible before the body rather than buried under it.
 */
function runHeader(runId: string): string {
  const run = db.select().from(checkRuns).where(eq(checkRuns.id, runId)).get();
  const results = db.select().from(sourceResults).where(eq(sourceResults.checkRunId, runId)).all();
  const found = db.select().from(findings).where(eq(findings.checkRunId, runId)).all();

  const failed = results.filter((r) => !r.success).length;
  const flagged = found.filter((f) => f.relevance === "flagged").length;
  const noted = found.filter((f) => f.relevance === "noted").length;

  const lines = [
    `Cante — ${run?.jurisdiction ?? "check"} — ${new Date().toISOString().slice(0, 10)}`,
    `${results.length - failed}/${results.length} sources OK` +
      (failed > 0 ? ` · ${failed} FAILED (see coverage notes)` : ""),
    `${flagged} flagged · ${noted} to look at`,
  ];
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
  options: { env?: EnvLike; signal?: AbortSignal } = {},
): Promise<DispatchResult> {
  const alert = alertForRun(runId);
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
    recordDelivery(alert, "skipped", "manual", "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set.");
    return {
      outcome: "skipped",
      channel: "manual",
      detail:
        "Telegram is not configured, so nothing was sent. The alert is waiting in the dashboard to be copied out by hand.",
      alertId: alert.id,
    };
  }

  const body = `${runHeader(runId)}\n\n${alert.body}`;

  try {
    const sent = await sendTelegram(config, body, { signal: options.signal });
    recordDelivery(alert, "delivered", "telegram", null);
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
    recordDelivery(alert, "failed", "telegram", detail);
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
  options: { env?: EnvLike } = {},
): Promise<{ notified: boolean; detail: string }> {
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
export function deliveryHealth(customerId: string, jurisdiction?: string): DeliveryHealth {
  const rows = db
    .select()
    .from(alerts)
    .where(
      jurisdiction
        ? and(eq(alerts.customerId, customerId), eq(alerts.channel, "telegram"))
        : eq(alerts.customerId, customerId),
    )
    .orderBy(desc(alerts.createdAt))
    .all();

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
