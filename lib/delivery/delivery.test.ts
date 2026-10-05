import assert from "node:assert/strict";
import test from "node:test";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";
import { chunkMessage, telegramConfig } from "@/lib/delivery/telegram";

async function seedRunWithAlert(
  customerId: string,
  opts: { runId: string; alertId: string; body?: string; sourcesOk?: number; sourcesFailed?: number },
) {
  const client = createServiceClient();
  // source_results.source_id is a real FK to sources(id) in Postgres (the
  // old SQLite schema never enforced it) — ensure the two fixture source
  // ids this file uses actually exist before inserting rows that reference
  // them.
  for (const sourceId of ["src", "src2"]) {
    const { data: existing } = await client.from("sources").select("id").eq("id", sourceId).maybeSingle();
    if (!existing) {
      const { error: sourceError } = await client.from("sources").insert({
        id: sourceId, country: "Indonesia", name: `Test source ${sourceId}`,
        domain: `${sourceId}.example`, url: `https://${sourceId}.example`,
        regulation_type: "trade", reliability_status: "working",
      });
      if (sourceError) throw new Error(sourceError.message);
    }
  }
  const { error: runError } = await client.from("check_runs").insert({
    id: opts.runId, customer_id: customerId, jurisdiction: "Indonesia", status: "complete",
  });
  if (runError) throw new Error(runError.message);
  const { error: alertError } = await client.from("alerts").insert({
    id: opts.alertId, customer_id: customerId, check_run_id: opts.runId,
    body: opts.body ?? "Tidak ada perubahan relevan hari ini.",
    channel: "manual", delivery_status: "pending", delivery_attempts: 0,
  });
  if (alertError) throw new Error(alertError.message);
  const okRows = Array.from({ length: opts.sourcesOk ?? 2 }, (_, i) => ({
    id: `ok-${opts.runId}-${i}`, check_run_id: opts.runId, source_id: "src", success: true, entries_parsed: 5,
  }));
  const failedRows = Array.from({ length: opts.sourcesFailed ?? 0 }, (_, i) => ({
    id: `bad-${opts.runId}-${i}`, check_run_id: opts.runId, source_id: "src2",
    success: false, entries_parsed: 0, error_message: "timeout",
  }));
  if (okRows.length || failedRows.length) {
    const { error: resultsError } = await client.from("source_results").insert([...okRows, ...failedRows]);
    if (resultsError) throw new Error(resultsError.message);
  }
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
  const { customerId } = await operatingDb();
  const { dispatchRun, alertForRun } = await import("@/lib/delivery/dispatch");
  await seedRunWithAlert(customerId, { runId: `r1-${customerId}`, alertId: `a1-${customerId}` });

  const result = await dispatchRun(`r1-${customerId}`, { env: {} });
  assert.equal(result.outcome, "skipped");
  assert.match(result.detail, /waiting in the dashboard/);

  const alert = await alertForRun(`r1-${customerId}`);
  assert.equal(alert?.deliveryStatus, "skipped");
  assert.equal(alert?.deliveredAt, null);
  assert.match(alert?.deliveryError ?? "", /not set/);
});

test("a configured channel that rejects the send is recorded as failed, with the reason", async () => {
  const { customerId } = await operatingDb();
  const { dispatchRun, alertForRun } = await import("@/lib/delivery/dispatch");
  await seedRunWithAlert(customerId, { runId: `r2-${customerId}`, alertId: `a2-${customerId}` });

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

  const alert = await alertForRun(`r2-${customerId}`);
  assert.equal(alert?.deliveryStatus, "failed");
  assert.equal(alert?.deliveredAt, null, "a failed send has no delivery time");
  assert.equal(alert?.deliveryAttempts, 1);
  assert.match(alert?.deliveryError ?? "", /chat not found/);
});

test("a successful send is delivered, timestamped, and carries the run header", async () => {
  const { customerId } = await operatingDb();
  const { dispatchRun, alertForRun } = await import("@/lib/delivery/dispatch");
  await seedRunWithAlert(customerId, {
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

  const alert = await alertForRun(`r3-${customerId}`);
  assert.equal(alert?.deliveryStatus, "delivered");
  assert.equal(alert?.channel, "telegram");
  assert.ok(alert?.deliveredAt);
  assert.equal(alert?.deliveryError, null);
});

test("a run with no alert row is a failure, not a quiet day", async () => {
  const { customerId } = await operatingDb();
  const { dispatchRun } = await import("@/lib/delivery/dispatch");
  const runId = `r4-${customerId}`;
  const { error } = await createServiceClient().from("check_runs").insert({
    id: runId, customer_id: customerId, jurisdiction: "Indonesia", status: "failed",
  });
  if (error) throw new Error(error.message);

  const result = await dispatchRun(runId, { env: {} });
  assert.equal(result.outcome, "failed");
  assert.match(result.detail, /no alert row/);
});

test("delivery health surfaces a channel that has been broken for days", async () => {
  const { customerId } = await operatingDb();
  const { dispatchRun, deliveryHealth } = await import("@/lib/delivery/dispatch");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: "bot blocked" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    for (const n of [1, 2, 3]) {
      await seedRunWithAlert(customerId, {
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

  const health = await deliveryHealth(customerId);
  assert.equal(health.consecutiveFailures, 3);
  assert.equal(health.lastDeliveredAt, null);
});

test("formatTelegramDigest renders short status and scanned sources", async () => {
  const { customerId } = await operatingDb();
  const { formatTelegramDigest } = await import("@/lib/delivery/dispatch");
  const runId = `r6-${customerId}`;
  const alertId = `a6-${customerId}`;
  await seedRunWithAlert(customerId, {
    runId,
    alertId,
    sourcesOk: 3,
    sourcesFailed: 1,
  });

  const digest = await formatTelegramDigest(runId);
  assert.match(digest, /Cante — Indonesia/);
  assert.match(digest, /3\/4 sources OK · 1 FAILED/);
  assert.match(digest, /All clear — nothing new/);
  assert.match(digest, /Sources checked:/);
  assert.match(digest, /✓ Test source src: 5 entries/);
  assert.match(digest, /✗ Test source src2: FAILED/);
});
