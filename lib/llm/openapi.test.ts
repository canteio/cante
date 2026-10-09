import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { GET as discover } from "../../app/api/llm/openapi/route";
import { POST } from "../../app/api/llm/route";
import { PROVIDER_OPTIONS } from "./provider-choice";
import { buildLlmOpenApiSpec } from "./openapi";

const contract: any = buildLlmOpenApiSpec().paths["/api/llm"];

test("LLM discovery serves the exact cacheable OpenAPI 3.1 contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildLlmOpenApiSpec());
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400", "409", "500"]);
  assert.deepEqual(
    contract.get.responses["200"].content["application/json"].schema.properties.selected.enum,
    PROVIDER_OPTIONS.map(({ id }) => id),
  );
});

test("LLM discovery imports without storage or model executables", () => {
  const script = [
    "const imported = await import(\'./app/api/llm/openapi/route.ts\');",
    "const GET = imported.GET ?? imported.default?.GET;",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/llm']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: "/definitely/missing" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("real LLM handler returns the documented locked-selection conflict", async () => {
  const previous = process.env.CANTE_LLM_LOCKED;
  process.env.CANTE_LLM_LOCKED = "true";
  try {
    const response = await POST(new Request("http://localhost/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "api" }),
    }));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "The production AI provider is fixed by server configuration.",
    });
  } finally {
    if (previous === undefined) delete process.env.CANTE_LLM_LOCKED;
    else process.env.CANTE_LLM_LOCKED = previous;
  }
});
