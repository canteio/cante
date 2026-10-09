import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { operatingDb } from "@/lib/test-support/supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";
import { parseBusinessImpact, evaluateBusinessImpact, summarizeBusinessImpact } from "./business-impact";

// Requires the new migration on the real harness database. Uses a real signed-in
// client because a service-role mock cannot prove RLS or SECURITY INVOKER behavior.
test("real RPC forces tenant ownership, is atomic, and enforces immutable RLS", async () => {
  const { customerId } = await operatingDb();
  const other = await operatingDb();
  const service = createServiceClient();
  const email = `tariff-impact-${randomUUID()}@example.invalid`;
  const password = randomUUID() + randomUUID();
  const user = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(user.error);
  const userId = user.data.user!.id;
  try {
    assert.ifError((await service.from("customer_users").insert({ customer_id: customerId, user_id: userId, role: "owner" })).error);
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    const rows = parseBusinessImpact("sku,quantity,chapter99_codes,exclusion_id,special_program_claim\nA,12,9903.01.01,EX-1,USMCA"); // An honest input-error snapshot, no external lookup.
    const run = { ...summarizeBusinessImpact(rows), id: randomUUID(), filename: "test.csv", input_sha256: "a".repeat(64), customer_id: other.customerId };
    const row = { ...rows[0], id: randomUUID(), customer_id: other.customerId, run_id: "spoofed" };
    const call = (r = run, rs = [row], target = customerId) => client.rpc("create_tariff_impact_run", { target_customer_id: target, run_data: r, row_data: rs });
    assert.ifError((await call()).error);
    const stored = await client.from("tariff_impact_runs").select("*").eq("id", run.id).single();
    assert.ifError(stored.error); assert.equal(stored.data.customer_id, customerId);
    const storedRows = await client.from("tariff_impact_rows").select("*").eq("run_id", run.id);
    assert.ifError(storedRows.error); assert.equal(storedRows.data![0].customer_id, customerId);
    assert.equal(storedRows.data![0].quantity, 12);
    assert.equal(storedRows.data![0].chapter99_codes, "9903.01.01");
    assert.equal(storedRows.data![0].exclusion_id, "EX-1");
    assert.equal(storedRows.data![0].special_program_claim, "USMCA");
    assert.ok((await client.from("tariff_impact_runs").update({ filename: "tampered" }).eq("id", run.id)).error);
    assert.ok((await client.from("tariff_impact_rows").insert({ ...storedRows.data![0], id: randomUUID(), row_number: 2 })).error);
    assert.ok((await call({ ...run, id: randomUUID() }, [{ ...row, id: randomUUID() }], other.customerId)).error);
    const badRun = { ...run, id: randomUUID(), source_count: 2, error_count: 2, accepted_count: 0 };
    assert.ok((await call(badRun, [{ ...row, id: randomUUID() }, { ...row, id: randomUUID() }])).error); // duplicate row number after run insertion
    assert.equal((await client.from("tariff_impact_runs").select("id").eq("id", badRun.id)).data?.length, 0);
    const foreignProduct = randomUUID();
    assert.ifError((await service.from("products").insert({ id: foreignProduct, customer_id: other.customerId, sku: "foreign", name: "Foreign" })).error);
    assert.ok((await call({ ...run, id: randomUUID() }, [{ ...row, id: randomUUID(), product_id: foreignProduct } as typeof row])).error);
    const foreignSupplier = randomUUID();
    assert.ifError((await service.from("suppliers").insert({ id: foreignSupplier, customer_id: other.customerId, name: "Foreign" })).error);
    assert.ok((await call({ ...run, id: randomUUID() }, [{ ...row, id: randomUUID(), supplier_id: foreignSupplier } as typeof row])).error);
    assert.ok((await call({ ...run, id: randomUUID(), accepted_count: 1 }, [{ ...row, id: randomUUID() }])).error);
    assert.ifError((await service.from("customer_users").insert({ customer_id: other.customerId, user_id: userId, role: "owner" })).error);
    const foreignRun = { ...run, id: randomUUID() };
    assert.ifError((await call(foreignRun, [{ ...row, id: randomUUID() }], other.customerId)).error);
    assert.ifError((await service.from("customer_users").delete().eq("customer_id", other.customerId).eq("user_id", userId)).error);
    assert.deepEqual((await client.from("tariff_impact_runs").select("id").eq("id", foreignRun.id)).data, []);
    assert.deepEqual((await client.from("tariff_impact_rows").select("id").eq("run_id", foreignRun.id)).data, []);
    assert.ifError((await service.from("customer_users").update({ role: "viewer" }).eq("customer_id", customerId).eq("user_id", userId)).error);
    assert.ok((await call({ ...run, id: randomUUID() }, [{ ...row, id: randomUUID() }])).error);
  } finally {
    assert.ifError((await service.auth.admin.deleteUser(userId)).error);
  }
});


test("historical ledger persists qualified entry evidence and reuses an immutable snapshot", async () => {
  const { customerId } = await operatingDb();
  const service = createServiceClient();
  const created = await service.auth.admin.createUser({ email: `tariff-history-${randomUUID()}@example.invalid`, password: "Fixture-only-" + randomUUID(), email_confirm: true });
  assert.ifError(created.error);
  const userId = created.data.user!.id;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  try {
    assert.ifError((await service.from("customer_users").insert({ customer_id: customerId, user_id: userId, role: "owner" })).error);
    const productId = randomUUID();
    assert.ifError((await service.from("products").insert({ id: productId, customer_id: customerId, sku: "PILOT", name: "Fixture monofilament" })).error);
    // Use the generated user directly via a magic link; no email is sent.
    const link = await service.auth.admin.generateLink({ type: "magiclink", email: created.data.user!.email! });
    assert.ifError(link.error);
    assert.ifError((await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "magiclink" })).error);
    const rows = await evaluateBusinessImpact(parseBusinessImpact("entry_id,line_number,sku,hts,origin,customs_value,paid_duty,entry_date,qualification_verified,qualification_basis\nE1,1,PILOT,3916.90.30.00,VN,1000,65,2026-09-15,true,Fixture reviewed ordinary use and every pilot exception"));
    assert.equal(rows[0].status, "computed");
    const run = { ...summarizeBusinessImpact(rows), id: randomUUID(), filename: "pilot-fixture.csv", input_sha256: "b".repeat(64), idempotency_key: randomUUID() };
    const row = { ...rows[0], id: randomUUID(), product_id: productId };
    const call = (r = run, x = row) => client.rpc("create_tariff_impact_run", { target_customer_id: customerId, run_data: r, row_data: [x] });
    const first = await call(); assert.ifError(first.error); assert.equal(first.data, run.id);
    const repeat = await call({ ...run, id: randomUUID() }, { ...row, id: randomUUID() });
    assert.ifError(repeat.error); assert.equal(repeat.data, run.id);
    const stored = await client.from("tariff_impact_rows").select("*").eq("run_id", run.id).single();
    assert.ifError(stored.error);
    assert.equal(stored.data.entry_id, "E1"); assert.equal(stored.data.line_number, "1");
    assert.equal(stored.data.analysis_kind, "historical_entries");
    assert.equal(stored.data.customs_value_usd, 1000); assert.equal(stored.data.paid_duty_usd, 65);
    assert.equal(stored.data.annual_delta_usd, 125); assert.equal(stored.data.qualification_verified, true);
    const bad = await call({ ...run, id: randomUUID(), idempotency_key: randomUUID() }, { ...row, id: randomUUID(), paid_duty_usd: 66 });
    assert.ok(bad.error); assert.match(bad.error.message, /evidence or analysis kind mismatch/);
  } finally {
    await client.auth.signOut();
    assert.ifError((await service.auth.admin.deleteUser(userId)).error);
  }
});
