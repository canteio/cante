import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { cleanupCustomer, operatingDb, seedFinding } from "./supabase-test-db";
import { createServiceClient } from "@/lib/supabase/service";

test("real Supabase fixture inserts a tenant and cascades its evidence on cleanup", async () => {
  const { customerId } = await operatingDb();
  const client = createServiceClient();
  const findingId = randomUUID();
  try {
    const { data, error } = await client.from("customers").select("name").eq("id", customerId).single();
    assert.ifError(error);
    assert.equal(data?.name, `Test Customer ${customerId}`);
    await seedFinding(customerId, { id: findingId, title: "Test finding" });
    const finding = await client.from("findings").select("id").eq("id", findingId).single();
    assert.ifError(finding.error);
    assert.equal(finding.data?.id, findingId);
  } finally {
    await cleanupCustomer(customerId);
  }
  for (const table of ["check_runs", "findings"]) {
    const { data, error } = await client.from(table).select("id").eq("customer_id", customerId);
    assert.ifError(error);
    assert.deepEqual(data, []);
  }
});
