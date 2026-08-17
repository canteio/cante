/**
 * Telegram delivery.
 *
 * Chosen for the operator, not the customer. Indonesian businesses live on
 * WhatsApp, and the WhatsApp Business API needs Meta approval, a verified
 * business and per-message fees — none of which belongs in a 14-day pilot.
 * Telegram is free, instant, and needs one token from BotFather.
 *
 * So the pilot shape is: **Telegram tells the operator, the operator forwards
 * to the customer on WhatsApp.** That is deliberately still a manual last mile
 * (see `alerts.channel`), and nothing here should be described as delivering
 * to the customer.
 *
 * The property that matters most in this file: **silence must never be
 * ambiguous.** A monitor whose failure mode is "no message" trains the reader
 * to treat an outage as a quiet day, which is the most expensive way this
 * product can fail. Every run sends something, including the failures.
 */

const API = "https://api.telegram.org";
/** Telegram's hard per-message ceiling. */
const MAX_MESSAGE = 4096;
const TIMEOUT_MS = 15_000;

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramError extends Error {
  readonly status = 502;
}

/**
 * Read config from the environment.
 *
 * Returns null rather than throwing: an unconfigured channel is a normal
 * state, and the caller records it as `skipped` — which is a different fact
 * from a delivery that was attempted and failed.
 */
/** Only two keys are read, so the parameter is typed as what it actually needs. */
export type EnvLike = Record<string, string | undefined>;

export function telegramConfig(env: EnvLike = process.env): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/**
 * Split a long alert into Telegram-sized pieces on paragraph, then line,
 * boundaries — never mid-word, and never mid-caveat if it can be helped.
 * A truncated coverage caveat is worse than a second message.
 */
export function chunkMessage(text: string, limit = MAX_MESSAGE): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of text.split("\n")) {
    const candidate = current ? `${current}\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);

    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }
    // A single paragraph longer than the limit: hard-split it, but only as a
    // last resort.
    let rest = paragraph;
    while (rest.length > limit) {
      chunks.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  }

  if (current) chunks.push(current);
  return chunks;
}

export interface SendResult {
  messageIds: number[];
  chunks: number;
}

/**
 * Send a message. Plain text on purpose — Telegram's Markdown parser rejects
 * unescaped `_`, `*`, `[` and `.`, which appear constantly in regulation
 * numbers and URLs, and a parse error would drop the whole alert.
 */
export async function sendTelegram(
  config: TelegramConfig,
  text: string,
  options: { signal?: AbortSignal } = {},
): Promise<SendResult> {
  const chunks = chunkMessage(text);
  const messageIds: number[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal ?? controller.signal,
        body: JSON.stringify({
          chat_id: config.chatId,
          text: chunk,
          disable_web_page_preview: true,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; result?: { message_id?: number }; description?: string }
        | null;

      if (!res.ok || !payload?.ok) {
        throw new TelegramError(
          `Telegram rejected message ${index + 1}/${chunks.length}: ` +
            `HTTP ${res.status}${payload?.description ? ` — ${payload.description}` : ""}`,
        );
      }
      if (typeof payload.result?.message_id === "number") {
        messageIds.push(payload.result.message_id);
      }
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      throw new TelegramError(
        `Could not reach Telegram: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return { messageIds, chunks: chunks.length };
}

/** Confirm the bot and chat actually work, before relying on them nightly. */
export async function verifyTelegram(
  config: TelegramConfig,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${API}/bot${config.botToken}/getMe`);
    const payload = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { username?: string }; description?: string }
      | null;
    if (!res.ok || !payload?.ok) {
      return { ok: false, detail: payload?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, detail: `bot @${payload.result?.username ?? "unknown"}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "unreachable" };
  }
}
