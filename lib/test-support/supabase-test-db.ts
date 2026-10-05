import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { after, afterEach } from "node:test";
import type { Finding } from "@/lib/db/schema";
import { createServiceClient } from "@/lib/supabase/service";

// Match Next's local override precedence without overwriting shell secrets.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// One shared project per file, a fresh tenant per case. Only IDs allocated by
// this process may be deleted; never clean by name, prefix, or an unfiltered query.
const ownedCustomers = new Map<string, string>();
const realFetch = globalThis.fetch.bind(globalThis);

/** Existing upstream fixtures may replace HTTP, but never database traffic. */
export function mockExternalFetch(replacement: typeof fetch): typeof fetch {
  const databaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return new URL(url).origin === databaseOrigin
      ? realFetch(input, init)
      : replacement(input, init);
  };
}

export function testWorkspace(requestedCustomerId?: string | null) {
  const customerId = requestedCustomerId ?? [...ownedCustomers.keys()].at(-1);
  if (!customerId || !ownedCustomers.has(customerId)) return null;
  return { customerId, role: "owner" as const, userId: customerId };
}

export async function cleanupCustomer(customerId: string): Promise<void> {
  const name = ownedCustomers.get(customerId);
  if (!name) throw new Error("Refusing to delete a customer not owned by this test file.");
  const client = createServiceClient();
  const { error } = await client.from("customers").delete().eq("id", customerId).eq("name", name);
  if (error) throw new Error(`Test customer cleanup failed: ${error.message}`);
  const { data, error: readError } = await client.from("customers").select("id").eq("id", customerId);
  if (readError || data?.length) throw new Error(`Test customer cleanup not verified: ${readError?.message ?? customerId}`);
  ownedCustomers.delete(customerId);
}

async function cleanup() {
  globalThis.fetch = realFetch;
  const results = await Promise.allSettled([...ownedCustomers.keys()].map(cleanupCustomer));
  const errors = results.filter((result) => result.status === "rejected");
  if (errors.length) throw new AggregateError(errors.map((result) => result.reason), "Test tenant cleanup failed");
}
afterEach(cleanup);
after(cleanup); // Retry cleanup after a failed hook as well.

export async function operatingDb(): Promise<{ customerId: string }> {
  const customerId = randomUUID();
  const name = `Test Customer ${customerId}`;
  ownedCustomers.set(customerId, name); // Track even if the insert response is lost.
  const { error } = await createServiceClient().from("customers").insert({
    id: customerId, slug: `test-${customerId}`, name, country: "United States", city: "Chicago",
  });
  if (error) throw new Error(`Test customer creation failed: ${error.message}`);
  return { customerId };
}

export async function seedFinding(
  customerId: string,
  finding: { id: string; title: string; relevance?: string; summaryEn?: string | null },
 ): Promise<Finding> {
  if (!ownedCustomers.has(customerId)) throw new Error("Finding fixture requires an owned test customer.");
  const client = createServiceClient();
  const runId = `run-${customerId}`;
  const { error: runError } = await client.from("check_runs").upsert({
    id: runId, customer_id: customerId, jurisdiction: "Indonesia", status: "complete",
  });
  if (runError) throw new Error(runError.message);
  const { data, error } = await client.from("findings").insert({
    id: finding.id, check_run_id: runId, customer_id: customerId,
    title: finding.title, summary_en: finding.summaryEn ?? null,
    relevance: finding.relevance ?? "flagged",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value,
  ])) as Finding;
}
