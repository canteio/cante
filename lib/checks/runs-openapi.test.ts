import { operatingDb } from "@/lib/test-support/supabase-test-db";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/checks/openapi/route";
import { buildChecksOpenApiSpec } from "./runs-openapi";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/checks/route");
let customerId: string;

beforeEach(async () => {
  route = await import("../../app/api/checks/route");
  ({ customerId } = await operatingDb());
});

const contract: any = buildChecksOpenApiSpec().paths["/api/checks"];

test("checks discovery serves the exact cacheable GET and POST contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildChecksOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post"]);
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "404", "409", "500"]);
});

test("checks discovery imports without opening customer storage or invoking a provider", () => {
  const script = [
    "globalThis.fetch = () => { throw new Error('discovery called the network'); };",
    "const { GET } = await import('./app/api/checks/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/checks']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the documented history envelope matches a real empty-history response", async () => {
  const response = await route.GET(new Request(`http://localhost/api/checks?customerId=${customerId}&country=US`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { customerId: customerId, jurisdiction: "United States", runs: [] });
  assert.deepEqual(contract.get.responses["200"].content["application/json"].schema.required, Object.keys(payload));
});

test("direct Supabase checks return the documented scheduler-only conflict", async () => {
  try {
    const response = await route.POST();
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload), contract.post.responses["409"].content["application/json"].schema.required);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /trusted worker/);
  } finally {
  }
});
