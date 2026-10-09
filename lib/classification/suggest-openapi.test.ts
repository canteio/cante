import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/classifications/suggest/openapi/route";
import { SUGGESTION_CONFIDENCE_LEVELS } from "./suggest-contract";
import { buildClassificationSuggestOpenApiSpec } from "./suggest-openapi";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

process.env.CANTE_AUTH_MODE = "none";
// Disabled by default in production (see route.ts) pending a retrieval-quality
// fix; enabled here so this suite can still exercise the real suggest/adopt flow.
process.env.CANTE_CLASSIFICATION_SUGGEST_ENABLED = "true";
let route: typeof import("../../app/api/classifications/suggest/route");
let customerId: string;

beforeEach(async () => {
  // Keep discovery statically importable while binding the stateful route to
  // throwaway storage before db/client resolves its one-time database path.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/classifications/suggest/route");
});

const contract: any = buildClassificationSuggestOpenApiSpec().paths["/api/classifications/suggest"];
const jsonRequest = (method: string, body: unknown) => new Request(
  "http://localhost/api/classifications/suggest",
  { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
);

test("suggestion discovery declares the real methods, statuses, and confidence values", () => {
  assert.deepEqual(Object.keys(contract), ["get", "post", "patch"]);
  assert.deepEqual(Object.keys(contract.get.responses), ["200"]);
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400", "500"]);
  assert.deepEqual(Object.keys(contract.patch.responses).sort(), ["200", "400", "500"]);

  const confidence = contract.post.responses["200"].content["application/json"]
    .schema.properties.suggestion.properties.confidence.enum;
  assert.deepEqual(confidence, SUGGESTION_CONFIDENCE_LEVELS);
  assert.equal(contract.post.requestBody.content["application/json"].schema.required[0], "sku");
  assert.deepEqual(
    contract.patch.requestBody.content["application/json"].schema.required,
    ["classificationId", "adoptedBy", "reason"],
  );
});

test("discovery serves the exact cacheable OpenAPI 3.1 document", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildClassificationSuggestOpenApiSpec());
});

test("discovery imports and runs without a usable database or model provider", () => {
  const script = [
    "const imported = await import(\'./app/api/classifications/suggest/openapi/route.ts\');",
    "const GET = imported.GET ?? imported.default?.GET;",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/classifications/suggest']?.patch) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the real route lists, adopts, and rejects primitive JSON bodies cleanly", async () => {
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { recordClassification } = await import("@/lib/catalogue/classifications");
  const { product } = (await upsertProduct(customerId, { sku: "API-SUGGEST-1", name: "Steel fastener" }));
  const lead = (await recordClassification({
    productId: product.id,
    system: "hts",
    code: "7318.15.20",
    tier: "lead",
    basis: "Model suggestion (medium confidence) from official USITC candidates.",
    rationale: "Candidate for human review.",
  }));

  const listing = await route.GET(new Request(
    `http://localhost/api/classifications/suggest?customerId=${customerId}`,
  ));
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).pending[0].classificationId, lead.id);

  const adopted = await route.PATCH(jsonRequest("PATCH", {
    classificationId: lead.id,
    adoptedBy: "Import specialist",
    reason: "Confirmed against the product drawing and heading notes.",
  }));
  assert.equal(adopted.status, 200);
  assert.equal((await adopted.json()).classification.tier, "human");

  for (const [method, handler] of [["POST", route.POST], ["PATCH", route.PATCH]] as const) {
    const primitive = await handler(jsonRequest(method, null));
    assert.equal(primitive.status, 400);
    assert.deepEqual(await primitive.json(), { error: "Request body must be a JSON object." });
  }
});

test("POST is disabled by default, independent of module-load-time env capture", async () => {
  const previous = process.env.CANTE_CLASSIFICATION_SUGGEST_ENABLED;
  process.env.CANTE_CLASSIFICATION_SUGGEST_ENABLED = "false";
  try {
    const response = await route.POST(jsonRequest("POST", { customerId, sku: "ANY" }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "Classification suggestion is disabled. Set CANTE_CLASSIFICATION_SUGGEST_ENABLED=true to enable for testing.",
    });
  } finally {
    process.env.CANTE_CLASSIFICATION_SUGGEST_ENABLED = previous;
  }
});
