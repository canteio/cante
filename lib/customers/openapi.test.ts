import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { GET as discover } from "../../app/api/customers/openapi/route";
import { PROVIDER_OPTIONS } from "../llm/provider-choice";
import { buildCustomersOpenApiSpec } from "./openapi";
import { createServiceClient } from "@/lib/supabase/service";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

process.env.CANTE_AUTH_MODE = "none";
process.env.CANTE_LLM_LOCKED = "true";
process.env.CANTE_LLM = "api";
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const contract: any = buildCustomersOpenApiSpec().paths["/api/customers"].get;

test("customer discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildCustomersOpenApiSpec());
  assert.deepEqual(Object.keys(contract.responses).sort(), ["200", "500"]);
  const providerSchema = contract.responses["200"].content["application/json"].schema
    .properties.llm.properties.provider;
  assert.deepEqual(providerSchema.enum, PROVIDER_OPTIONS.map(({ id }) => id));
});

test("customer discovery imports without initializing storage or probing a model", () => {
  const script = [
    "const { GET } = await import('./app/api/customers/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/customers']?.get) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: "/definitely/missing" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

// Setup/teardown live inside this one test — the harness's afterEach
// deletes every owned customer after EACH test, so a shared before()/after()
// across multiple tests would leave later tests with already-deleted rows.
test("real customer route returns ordered rows and provider health", async () => {
  const route = await import("../../app/api/customers/route");
  const { customerId: zuluId } = await operatingDb();
  const { customerId: acmeId } = await operatingDb();
  const client = createServiceClient();
  const { data: zulu, error: zuluErr } = await client.from("customers")
    .select("name").eq("id", zuluId).single();
  if (zuluErr) throw new Error(zuluErr.message);
  const { data: acme, error: acmeErr } = await client.from("customers")
    .select("name").eq("id", acmeId).single();
  if (acmeErr) throw new Error(acmeErr.message);
  const { error: updateError } = await client.from("customers").update({ city: null }).eq("id", zuluId);
  if (updateError) throw new Error(updateError.message);
  const { error: updateError2 } = await client.from("customers").update({ city: "Chicago" }).eq("id", acmeId);
  if (updateError2) throw new Error(updateError2.message);
  const customerNames = { a: acme!.name as string, z: zulu!.name as string };

  const zuluSourceId = randomUUID();
  const acmeSourceId = randomUUID();
  const { error: sourceError } = await client.from("sources").insert([
    { id: zuluSourceId, country: "United States", name: "Zulu Register", domain: "zulu.example", url: "https://zulu.example", regulation_type: "trade", reliability_status: "working" },
    { id: acmeSourceId, country: "United States", name: "Agency Notices", domain: "agency.example", url: "https://agency.example", regulation_type: "national", reliability_status: "working", view: "notices", notes: "Official notices", last_success_at: "2026-09-20T01:00:00Z" },
  ]);
  if (sourceError) throw new Error(sourceError.message);

  try {
    const response = await route.GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    const customerByName = new Map<string, { name: string; city: string | null }>(
      payload.customers.map((c: { name: string; city: string | null }) => [c.name, c]),
    );
    const ourNames = [customerNames.a, customerNames.z].sort();
    const positions = payload.customers
      .map((c: { name: string }, i: number) => ({ name: c.name, i }))
      .filter((c: { name: string }) => ourNames.includes(c.name))
      .sort((x: { i: number }, y: { i: number }) => x.i - y.i)
      .map((c: { name: string }) => c.name);
    assert.deepEqual(positions, ourNames);
    assert.equal(customerByName.get(customerNames.a)?.city, "Chicago");
    assert.equal(customerByName.get(customerNames.z)?.city, null);
    const sourceNames = payload.sources.map(({ name }: { name: string }) => name);
    assert.ok(sourceNames.includes("Agency Notices"));
    assert.ok(sourceNames.includes("Zulu Register"));
    assert.ok(sourceNames.indexOf("Agency Notices") < sourceNames.indexOf("Zulu Register"));
    assert.deepEqual(payload.llm, {
      provider: "api",
      ok: false,
      detail: "CANTE_HOSTED_PROVIDER=openai, but its API key is missing.",
    });
  } finally {
    await client.from("sources").delete().in("id", [acmeSourceId, zuluSourceId]);
  }
});
