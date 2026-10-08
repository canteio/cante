import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { operatingDb, seedFinding } from "@/lib/test-support/supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";
import { resetTariffCacheForTests } from "@/lib/tariff/rates";
import { computeStackedDuty, type StackDutyInput, type StackedDutyResult } from "@/lib/tariff/stack";
import type { Section232LiveMatch } from "@/lib/tariff/section232-live";
import {
  impactResultHash,
  recalculateForCustomer,
  recalculateTariffImpacts,
  RECALC_CUSTOMER_CONCURRENCY,
} from "@/lib/tariff/recalculate-customer-impacts";

const documentNumber = "2026-06087";
const effectiveDate = "2026-04-06";
const liveMatch: Section232LiveMatch = {
  annex: "Annex II",
  ratePercent: 0.6,
  ukRatePercent: 0.25,
  usContentRatePercent: null,
  effectiveDate,
  sourceDocumentNumber: documentNumber,
  sourceTitle: "Section 232 proclamation",
  sourcePdfUrl: `https://www.govinfo.gov/content/pkg/FR-2026-04-03/pdf/${documentNumber}.pdf`,
};
const realVersionedComputer = (input: StackDutyInput) => computeStackedDuty(input, async () => liveMatch);

function stubUsitc() {
  resetTariffCacheForTests();
  const original = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    // Only the USITC HTS lookup is faked; every other request (Supabase
    // auth, database traffic) must reach the real network, exactly like
    // mockExternalFetch in supabase-test-db.ts.
    if (!url.includes("hts.usitc.gov")) return original(input as RequestInfo, init);
    return {
      ok: true,
      status: 200,
      json: async () => [{ htsno: "7208.10.0000", general: "2%" }],
    } as Response;
  }) as unknown as typeof global.fetch;
  return () => { global.fetch = original; };
}

/** Creates one tenant with: a product, a tariff_impact_run+row linked to
 * that product, a flagged finding, and a tariff_monitor_candidates row
 * linking that finding to that product -- the exact shape the recalc job
 * reads. `hts` lets a test produce an unresolvable (NEEDS REVIEW) pair by
 * using a code with no live Section 232 match.
 *
 * The run+row snapshot must go through the real `create_tariff_impact_run`
 * RPC as a real authenticated tenant member (same pattern as
 * business-impact-rpc.test.ts): the deferred consistency trigger on
 * tariff_impact_runs only validates correctly within the RPC's single
 * transaction, and the RPC itself requires an authenticated session --
 * the service-role client correctly cannot write this table directly,
 * matching how every other persisted snapshot in this product is created. */
async function seedMonitoredCustomer(hts = "7208.10.0000") {
  const client = createServiceClient();
  const { customerId } = await operatingDb();
  const productId = randomUUID();
  const { error: productError } = await client.from("products").insert({
    id: productId, customer_id: customerId, sku: "STEEL-1", name: "Steel sheet",
  });
  if (productError) throw new Error(productError.message);

  const finding = await seedFinding(customerId, {
    id: randomUUID(),
    title: "Section 232 steel duty change",
    relevance: "flagged",
  });
  const { error: findingUpdateError } = await client.from("findings")
    .update({ regulation_ref: `FR Doc. ${documentNumber}` })
    .eq("id", finding.id);
  if (findingUpdateError) throw new Error(findingUpdateError.message);

  const email = `recalc-test-${randomUUID()}@example.invalid`;
  const password = randomUUID() + randomUUID();
  const user = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw new Error(user.error.message);
  const userId = user.data.user!.id;
  const { error: membershipError } = await client.from("customer_users").insert({
    customer_id: customerId, user_id: userId, role: "owner",
  });
  if (membershipError) throw new Error(membershipError.message);

  const authed = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const signIn = await authed.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(signIn.error.message);

  const runId = randomUUID();
  const { data: createdRunId, error: rpcError } = await authed.rpc("create_tariff_impact_run", {
    target_customer_id: customerId,
    run_data: {
      id: runId, filename: "test.csv", input_sha256: "a".repeat(64),
      source_count: 1, accepted_count: 1, computed_count: 0, unresolved_count: 1, error_count: 0,
      affected_sku_count: 0, unique_supplier_count: 1,
      resolved_annual_delta_subtotal_usd: 0, estimated_annual_duty_delta_usd: null,
      effective_date: null, effective_date_status: "not_provided", currency: "USD",
    },
    row_data: [{
      id: randomUUID(), row_number: 1, product_id: productId, supplier_id: null,
      input_valid: true, sku: "STEEL-1", hts, origin: "JP", supplier: "Foundry Co",
      annual_import_value_usd: 100_000, current_duty_rate: 0.52, evaluation_date: null,
      status: "unresolved", direction: "unknown",
      current_annual_duty_usd: null, computed_annual_duty_usd: null, computed_total_rate: null, annual_delta_usd: null,
      stack_result: null, raw_input: { sku: "STEEL-1" }, error: null,
    }],
  });
  if (rpcError) throw new Error(rpcError.message);
  assert.equal(createdRunId, runId);

  const candidateId = randomUUID();
  const { error: candidateError } = await client.from("tariff_monitor_candidates").insert({
    id: candidateId, customer_id: customerId, finding_id: finding.id, product_id: productId,
    match_kind: "exact_code", match_reason: "Exact catalogue match.",
  });
  if (candidateError) throw new Error(candidateError.message);

  // Membership and the auth user are cleaned up once the test has finished
  // exercising the worker; `cleanupCustomer` (afterEach) cascades the
  // customer itself. The test user is not needed after seeding.
  const deleteUser = await client.auth.admin.deleteUser(userId);
  if (deleteUser.error) throw new Error(deleteUser.error.message);
  const { error: membershipCleanupError } = await client.from("customer_users").delete().eq("customer_id", customerId).eq("user_id", userId);
  if (membershipCleanupError) throw new Error(membershipCleanupError.message);

  return { customerId, productId, findingId: finding.id, runId, client };
}

async function cleanupEvents(client: ReturnType<typeof createServiceClient>, customerId: string) {
  await client.from("tariff_impact_events").delete().eq("customer_id", customerId);
}

test("a brand-new resolvable candidate produces exactly one computed event with the correct delta", async () => {
  const restore = stubUsitc();
  try {
    const { customerId, client, runId, findingId } = await seedMonitoredCustomer();
    const result = await recalculateForCustomer(client, customerId, { computer: realVersionedComputer, env: {} });
    assert.equal(result.eventsCreated, 1);
    assert.equal(result.skippedReason, undefined);

    const { data: events, error } = await client.from("tariff_impact_events").select("*").eq("customer_id", customerId);
    assert.ifError(error);
    assert.equal(events!.length, 1);
    const event = events![0];
    assert.equal(event.status, "computed");
    assert.equal(event.run_id, runId);
    assert.equal(event.finding_id, findingId);
    assert.equal(Number(event.estimated_duty_delta_usd), 10_000);
    assert.equal(event.review_reason, null);
    assert.ok(Array.isArray(event.rows) && event.rows.length === 1);
    assert.equal(event.rows[0].impactUsd, 10_000);
    await cleanupEvents(client, customerId);
  } finally {
    restore();
  }
});

test("an unresolvable candidate produces a NEEDS REVIEW event with null dollars and a specific reason, never zeroed or skipped", async () => {
  const restore = stubUsitc();
  try {
    // Citation mismatch forces NEEDS REVIEW deterministically, same as the
    // already-reviewed monitor-company-impact.ts test for this exact path.
    const { customerId, client } = await seedMonitoredCustomer();
    const { error: updateError } = await client.from("findings").update({ regulation_ref: "FR Doc. 2026-99999" }).eq("customer_id", customerId);
    assert.ifError(updateError);

    const result = await recalculateForCustomer(client, customerId, { computer: realVersionedComputer, env: {} });
    assert.equal(result.eventsCreated, 1);

    const { data: events } = await client.from("tariff_impact_events").select("*").eq("customer_id", customerId);
    assert.equal(events!.length, 1);
    const event = events![0];
    assert.equal(event.status, "needs_review");
    assert.equal(event.estimated_duty_delta_usd, null);
    assert.ok(event.review_reason && event.review_reason.length > 0, "review_reason must be populated, never silent");
    assert.match(event.review_reason, /source document does not match/);
    assert.ok(event.rows.every((row: Record<string, unknown>) => row.impactUsd === null), "NEEDS REVIEW rows never carry a zeroed dollar amount");
    await cleanupEvents(client, customerId);
  } finally {
    restore();
  }
});

test("an unchanged candidate on a second pass does not create a duplicate event", async () => {
  const restore = stubUsitc();
  try {
    const { customerId, client } = await seedMonitoredCustomer();
    const first = await recalculateForCustomer(client, customerId, { computer: realVersionedComputer, env: {} });
    assert.equal(first.eventsCreated, 1);

    const second = await recalculateForCustomer(client, customerId, { computer: realVersionedComputer, env: {} });
    assert.equal(second.eventsCreated, 0);
    assert.equal(second.notified, false);
    assert.equal(second.deliveryStatus, "pending");
    assert.equal(second.pendingDeliveryCount, 1);

    const { data: events } = await client.from("tariff_impact_events").select("id").eq("customer_id", customerId);
    assert.equal(events!.length, 1);
    await cleanupEvents(client, customerId);
  } finally {
    restore();
  }
});

test("a changed candidate on a later pass DOES create a new event (not permanently suppressed)", async () => {
  const restore = stubUsitc();
  try {
    const { customerId, client } = await seedMonitoredCustomer();
    const first = await recalculateForCustomer(client, customerId, { computer: realVersionedComputer, env: {} });
    assert.equal(first.eventsCreated, 1);

    // Simulate the rule's citation changing (a materially different result)
    // between passes by flipping to an unmatched document.
    await client.from("findings").update({ regulation_ref: "FR Doc. 2026-99999" }).eq("customer_id", customerId);
    const second = await recalculateForCustomer(client, customerId, { computer: realVersionedComputer, env: {} });
    assert.equal(second.eventsCreated, 1);

    const { data: events } = await client.from("tariff_impact_events").select("status").eq("customer_id", customerId);
    assert.equal(events!.length, 2);
    assert.deepEqual(new Set(events!.map((e) => e.status)), new Set(["computed", "needs_review"]));
    await cleanupEvents(client, customerId);
  } finally {
    restore();
  }
});

test("cross-tenant isolation: one customer's recalculation never reads or writes another customer's events", async () => {
  const restore = stubUsitc();
  try {
    const a = await seedMonitoredCustomer();
    const b = await seedMonitoredCustomer();
    await recalculateForCustomer(a.client, a.customerId, { computer: realVersionedComputer, env: {} });
    await recalculateForCustomer(a.client, b.customerId, { computer: realVersionedComputer, env: {} });

    const { data: aEvents } = await a.client.from("tariff_impact_events").select("customer_id,finding_id").eq("customer_id", a.customerId);
    const { data: bEvents } = await a.client.from("tariff_impact_events").select("customer_id,finding_id").eq("customer_id", b.customerId);
    assert.equal(aEvents!.length, 1);
    assert.equal(bEvents!.length, 1);
    assert.ok(aEvents!.every((e) => e.customer_id === a.customerId));
    assert.ok(bEvents!.every((e) => e.customer_id === b.customerId));
    assert.notEqual(aEvents![0].finding_id, bEvents![0].finding_id);

    // A whole-pass run restricted to these two tenants must keep them apart too.
    const summary = await recalculateTariffImpacts({
      computer: realVersionedComputer,
      client: a.client,
      customerIds: [a.customerId, b.customerId],
      env: {},
    });
    assert.equal(summary.customersEvaluated, 2);
    for (const result of summary.customerResults) assert.equal(result.eventsCreated, 0); // already recorded above
    await cleanupEvents(a.client, a.customerId);
    await cleanupEvents(a.client, b.customerId);
  } finally {
    restore();
  }
});

test("impactResultHash is stable for identical content and changes when content changes", () => {
  const impact = {
    findingId: "f1",
    action: { name: "Rule", effectiveDate: "2026-04-06", citations: ["FR Doc. 2026-06087"] },
    affectedProductCount: 1,
    estimatedDutyDeltaUsd: 10_000,
    status: "computed" as const,
    reviewReason: null,
    suppliers: ["Foundry Co"],
    products: ["STEEL-1"],
    rows: [],
  };
  const a = impactResultHash(impact);
  const b = impactResultHash(structuredClone(impact));
  assert.equal(a, b);
  const changed = impactResultHash({ ...impact, estimatedDutyDeltaUsd: 20_000 });
  assert.notEqual(a, changed);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("many customers/candidates at once stay bounded by the shared customer concurrency cap", async () => {
  const restore = stubUsitc();
  try {
    let active = 0;
    let maximum = 0;
    const computer = async (input: StackDutyInput): Promise<StackedDutyResult | null> => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return realVersionedComputer(input);
    };
    const seeded = await Promise.all(Array.from({ length: 12 }, () => seedMonitoredCustomer()));
    const client = seeded[0].client;
    const summary = await recalculateTariffImpacts({
      computer,
      client,
      customerIds: seeded.map((s) => s.customerId),
      customerConcurrency: RECALC_CUSTOMER_CONCURRENCY,
      env: {},
    });
    assert.equal(summary.customersEvaluated, 12);
    assert.ok(summary.customerResults.every((r) => r.eventsCreated === 1));
    // Duty calls are concurrency-bounded by MONITOR_IMPACT_DUTY_CONCURRENCY (5)
    // regardless of how many customers are recalculated at once -- that cap
    // is the already-reviewed one in monitor-company-impact.ts, reused here
    // rather than reimplemented.
    assert.ok(maximum <= 5, `expected bounded duty concurrency, saw ${maximum}`);
    await Promise.all(seeded.map((s) => cleanupEvents(client, s.customerId)));
  } finally {
    restore();
  }
});

test("rejects an out-of-range customer concurrency rather than silently running unbounded", async () => {
  await assert.rejects(
    recalculateTariffImpacts({ customerConcurrency: RECALC_CUSTOMER_CONCURRENCY + 1, customerIds: [] }),
    RangeError,
  );
});

test("uses the real cookie-fallback Supabase client path, not just an explicitly injected one", async () => {
  // Regression: getImpactRun() previously went through the raw cookie-bound
  // createRequestClient (aliased as createClient) with no service-role
  // fallback. Every other test in this file passes `client` explicitly into
  // recalculateForCustomer, so none of them ever exercised the internal
  // getImpactRun() call the real scheduled script (scripts/recalculate-
  // tariff-impacts.ts) actually makes without an HTTP request in scope --
  // that call used to throw "cookies was called outside a request scope"
  // on every customer, 100% silently (the script still exited 0 with
  // "0 customers evaluated" style output upstream of this call failing).
  // This test calls through recalculateTariffImpacts() with NO injected
  // `client`, exactly like the production entrypoint.
  //
  // IMPORTANT LIMITATION: lib/test-support/supabase-test-server.ts (the
  // stub this whole suite runs against via supabase-test-loader.mjs)
  // exports `createRequestClient = createClient` as the SAME function --
  // it does not replicate the real module's split between a safe,
  // fallback-wrapped createClient() and a raw, cookie-bound
  // createRequestClient() that throws outside a request scope. That means
  // this test, like every other test in the suite, CANNOT by itself catch
  // a future regression where application code imports the wrong one of
  // the two. The actual fix for this bug was verified by running
  // `npx tsx scripts/recalculate-tariff-impacts.ts` directly against the
  // real, unstubbed lib/supabase/server.ts and confirming exit 0 with no
  // "outside a request scope" error. This test exists to document the
  // intended call shape and catch a narrower class of regression (e.g. a
  // required customerId/client plumbing change), not to be the sole proof
  // the real client wiring is correct -- re-run the real script by hand
  // after any future change to lib/supabase/server.ts or business-impact-
  // store.ts's import of it.
  const restore = stubUsitc();
  try {
    const seeded = await seedMonitoredCustomer();
    const summary = await recalculateTariffImpacts({
      computer: realVersionedComputer,
      customerIds: [seeded.customerId],
      env: {},
    });
    assert.equal(summary.customersEvaluated, 1);
    const [result] = summary.customerResults;
    assert.equal(result.skippedReason, undefined, result.notifyDetail);
    assert.equal(result.eventsCreated, 1);
    await cleanupEvents(seeded.client, seeded.customerId);
  } finally {
    restore();
  }
});

test("failed delivery is retried without a new event and successful deliveries are not repeated", async () => {
  const restore = stubUsitc();
  const network = global.fetch;
  let attempts = 0;
  let fail = true;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).hostname !== "api.telegram.org") return network(input, init);
    attempts++;
    return Response.json(fail ? { ok: false, description: "controlled delivery failure" }
      : { ok: true, result: { message_id: attempts } }, { status: fail ? 503 : 200 });
  }) as typeof fetch;
  try {
    const { customerId, client } = await seedMonitoredCustomer();
    const options = { computer: realVersionedComputer, env: { TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_CHAT_ID: "fixture-chat" } };
    const first = await recalculateForCustomer(client, customerId, options);
    assert.equal(first.eventsCreated, 1);
    assert.equal(first.deliveryStatus, "failed");
    assert.equal(first.pendingDeliveryCount, 1);
    fail = false;
    const retry = await recalculateForCustomer(client, customerId, options);
    assert.equal(retry.eventsCreated, 0);
    assert.equal(retry.deliveryStatus, "sent");
    assert.equal(retry.pendingDeliveryCount, 0);
    assert.equal(attempts, 2);
    const quiet = await recalculateForCustomer(client, customerId, options);
    assert.equal(quiet.deliveryStatus, "none");
    assert.equal(attempts, 2);
    const persisted = await client.from("tariff_impact_events").select("notified,notified_at").eq("customer_id", customerId);
    assert.equal(persisted.data?.length, 1);
    assert.equal(persisted.data?.[0].notified, true);
    assert.ok(persisted.data?.[0].notified_at);
  } finally { restore(); }
});
