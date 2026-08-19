import assert from "node:assert/strict";
import test, { before } from "node:test";
import Database from "better-sqlite3";
import { operatingDb } from "@/lib/test-support/operating-db";
import { chunkMessage, telegramConfig } from "@/lib/delivery/telegram";

before(async () => {
  await operatingDb();
});

function seedRunWithAlert(
  dbPath: string,
  customerId: string,
  opts: { runId: string; alertId: string; body?: string; sourcesOk?: number; sourcesFailed?: number },
) {
  const sqlite = new Database(dbPath);
  sqlite
    .prepare(
      "INSERT INTO check_runs (id, customer_id, jurisdiction, status) VALUES (?, ?, ?, ?)",
    )
    .run(opts.runId, customerId, "Indonesia", "complete");
  sqlite
    .prepare(
      "INSERT INTO alerts (id, customer_id, check_run_id, body, channel, delivery_status, delivery_attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      opts.alertId,
      customerId,
      opts.runId,
      opts.body ?? "Tidak ada perubahan relevan hari ini.",
      "manual",
      "pending",
      0,
      new Date().toISOString(),
    );
  for (let i = 0; i < (opts.sourcesOk ?? 2); i += 1) {
    sqlite
      .prepare(
        "INSERT INTO source_results (id, check_run_id, source_id, success, entries_parsed) VALUES (?, ?, ?, 1, 5)",
      )
      .run(`ok-${opts.runId}-${i}`, opts.runId, "src");
  }
  for (let i = 0; i < (opts.sourcesFailed ?? 0); i += 1) {
    sqlite
      .prepare(
        "INSERT INTO source_results (id, check_run_id, source_id, success, entries_parsed, error_message) VALUES (?, ?, ?, 0, 0, ?)",
      )
      .run(`bad-${opts.runId}-${i}`, opts.runId, "src2", "timeout");
  }
  sqlite.close();
}

test("long alerts split on line boundaries, never mid-caveat where avoidable", () => {
  const body = Array.from({ length: 400 }, (_, i) => `- coverage caveat number ${i}`).join("\n");
  const chunks = chunkMessage(body);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 4096);
  // Nothing lost, nothing duplicated.
  assert.equal(chunks.join("\n"), body);
  // No chunk begins mid-word.
  for (const chunk of chunks.slice(1)) assert.match(chunk, /^- coverage/);
});

test("a single over-long line is hard-split rather than dropped", () => {
  const chunks = chunkMessage("x".repeat(9000));
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join("").length, 9000);
});

test("an unconfigured channel is null, not an error", () => {
  assert.equal(telegramConfig({}), null);
  assert.equal(telegramConfig({ TELEGRAM_BOT_TOKEN: "t" }), null);
  assert.deepEqual(
    telegramConfig({ TELEGRAM_BOT_TOKEN: " t ", TELEGRAM_CHAT_ID: " c " }),
    { botToken: "t", chatId: "c" },
  );
});

test("no configured channel is skipped, not failed — nobody tried", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { dispatchRun, alertForRun } = await import("@/lib/delivery/dispatch");
  seedRunWithAlert(dbPath, customerId, { runId: `r1-${customerId}`, alertId: `a1-${customerId}` });

  const result = await dispatchRun(`r1-${customerId}`, { env: {} });
  assert.equal(result.outcome, "skipped");
  assert.match(result.detail, /waiting in the dashboard/);

  const alert = alertForRun(`r1-${customerId}`);
  assert.equal(alert?.deliveryStatus, "skipped");
  assert.equal(alert?.deliveredAt, null);
  assert.match(alert?.deliveryError ?? "", /not set/);
});

test("a configured channel that rejects the send is recorded as failed, with the reason", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { dispatchRun, alertForRun } = await import("@/lib/delivery/dispatch");
  seedRunWithAlert(dbPath, customerId, { runId: `r2-${customerId}`, alertId: `a2-${customerId}` });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const result = await dispatchRun(`r2-${customerId}`, {
      env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
    });
    assert.equal(result.outcome, "failed");
    assert.match(result.detail, /chat not found/);
  } finally {
    globalThis.fetch = realFetch;
  }

  const alert = alertForRun(`r2-${customerId}`);
  assert.equal(alert?.deliveryStatus, "failed");
  assert.equal(alert?.deliveredAt, null, "a failed send has no delivery time");
  assert.equal(alert?.deliveryAttempts, 1);
  assert.match(alert?.deliveryError ?? "", /chat not found/);
});

test("a successful send is delivered, timestamped, and carries the run header", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { dispatchRun, alertForRun } = await import("@/lib/delivery/dispatch");
  seedRunWithAlert(dbPath, customerId, {
    runId: `r3-${customerId}`,
    alertId: `a3-${customerId}`,
    sourcesOk: 11,
    sourcesFailed: 2,
  });

  let sentText = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sentText = JSON.parse(String(init?.body)).text;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await dispatchRun(`r3-${customerId}`, {
      env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
    });
    assert.equal(result.outcome, "delivered");
  } finally {
    globalThis.fetch = realFetch;
  }

  // Failed sources are visible in the header, before the body.
  assert.match(sentText, /11\/13 sources OK/);
  assert.match(sentText, /2 FAILED/);

  const alert = alertForRun(`r3-${customerId}`);
  assert.equal(alert?.deliveryStatus, "delivered");
  assert.equal(alert?.channel, "telegram");
  assert.ok(alert?.deliveredAt);
  assert.equal(alert?.deliveryError, null);
});

test("a run with no alert row is a failure, not a quiet day", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { dispatchRun } = await import("@/lib/delivery/dispatch");
  const sqlite = new Database(dbPath);
  sqlite
    .prepare("INSERT INTO check_runs (id, customer_id, jurisdiction, status) VALUES (?, ?, ?, ?)")
    .run(`r4-${customerId}`, customerId, "Indonesia", "failed");
  sqlite.close();

  const result = await dispatchRun(`r4-${customerId}`, { env: {} });
  assert.equal(result.outcome, "failed");
  assert.match(result.detail, /no alert row/);
});

test("delivery health surfaces a channel that has been broken for days", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { dispatchRun, deliveryHealth } = await import("@/lib/delivery/dispatch");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: "bot blocked" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    for (const n of [1, 2, 3]) {
      seedRunWithAlert(dbPath, customerId, {
        runId: `r5${n}-${customerId}`,
        alertId: `a5${n}-${customerId}`,
      });
      await dispatchRun(`r5${n}-${customerId}`, {
        env: { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" },
      });
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  const health = deliveryHealth(customerId);
  assert.equal(health.consecutiveFailures, 3);
  assert.equal(health.lastDeliveredAt, null);
});

test("formatTelegramDigest renders short status and scanned sources", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { formatTelegramDigest } = await import("@/lib/delivery/dispatch");
  const runId = `r6-${customerId}`;
  const alertId = `a6-${customerId}`;
  seedRunWithAlert(dbPath, customerId, {
    runId,
    alertId,
    sourcesOk: 3,
    sourcesFailed: 1,
  });

  const digest = formatTelegramDigest(runId);
  assert.match(digest, /Cante — Indonesia/);
  assert.match(digest, /3\/4 sources OK · 1 FAILED/);
  assert.match(digest, /All clear — nothing new/);
  assert.match(digest, /Sources checked:/);
  assert.match(digest, /✓ src: 5 entries/);
  assert.match(digest, /✗ src2: FAILED/);
});

