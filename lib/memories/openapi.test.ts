import { operatingDb } from "@/lib/test-support/supabase-test-db";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/memories/openapi/route";
import { MEMORY_KINDS } from "./contract";
import { buildMemoriesOpenApiSpec } from "./openapi";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/memories/route");
let customerId: string;

beforeEach(async () => {
  // Bind the real handler to isolated storage before its database imports run.
  route = await import("../../app/api/memories/route");
  ({ customerId } = await operatingDb());
});


const contract: any = buildMemoriesOpenApiSpec().paths["/api/memories"];
function jsonRequest(method: "POST" | "PATCH", body: unknown) {
  return new Request("http://localhost/api/memories", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("memory discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildMemoriesOpenApiSpec());
  assert.deepEqual(Object.keys(contract), ["get", "post", "patch", "delete"]);
  assert.deepEqual(
    contract.post.requestBody.content["application/json"].schema.properties.kind.enum,
    MEMORY_KINDS,
  );
});

test("memory discovery imports without initializing storage", () => {
  const script = [
    "const imported = await import(\'./app/api/memories/openapi/route.ts\');",
    "const GET = imported.GET ?? imported.default?.GET;",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/memories']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("real routes create, list, update, and delete a memory", async () => {
  const createdResponse = await route.POST(jsonRequest("POST", {
    customerId: customerId,
    country: "US",
    kind: "product",
    content: "  Imports wooden toys  ",
    source: "operator interview",
  }));
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()).memory;
  assert.equal(created.content, "Imports wooden toys");
  assert.equal(created.jurisdiction, "United States");
  assert.equal(created.kind, "product");
  assert.equal(created.confirmed, true);

  const listedResponse = await route.GET(new Request(`http://localhost/api/memories?customerId=${customerId}&country=USA`));
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  assert.equal(listed.jurisdiction, "United States");
  assert.deepEqual(listed.memories.map((memory: { id: string }) => memory.id), [created.id]);

  const updated = await route.PATCH(jsonRequest("PATCH", { id: created.id, confirmed: false }));
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { ok: true });

  const duplicate = await route.POST(jsonRequest("POST", {
    customerId: customerId,
    content: "imports wooden toys",
  }));
  assert.equal(duplicate.status, 409);

  const removed = await route.DELETE(new Request(`http://localhost/api/memories?id=${created.id}`, { method: "DELETE" }));
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true });
  const empty = await route.GET(new Request(`http://localhost/api/memories?customerId=${customerId}`));
  assert.deepEqual((await empty.json()).memories, []);
});

test("primitive and incomplete requests return documented corrective JSON", async () => {
  for (const body of [null, [], "memory"]) {
    const response = await route.POST(jsonRequest("POST", body));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON object/);
  }

  const patch = await route.PATCH(jsonRequest("PATCH", { id: "memory-1", confirmed: "yes" }));
  assert.equal(patch.status, 400);
  assert.match((await patch.json()).error, /boolean `confirmed`/);

  const deletion = await route.DELETE(new Request("http://localhost/api/memories", { method: "DELETE" }));
  assert.equal(deletion.status, 400);
  assert.deepEqual(await deletion.json(), { error: "No id." });
});
