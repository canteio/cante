import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/classifications/openapi/route";
import {
  CLASSIFICATION_PATCH_ACTIONS,
  CLASSIFICATION_STATUSES,
  CLASSIFICATION_TIERS,
  DIRECT_CLASSIFICATION_TIERS,
} from "./classifications-contract";
import { buildClassificationsOpenApiSpec } from "./classifications-openapi";
import { operatingDb } from "@/lib/test-support/supabase-test-db";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/classifications/route");
let customerId: string;

beforeEach(async () => {
  // Import the stateful handler only after throwaway storage exists. Discovery
  // stays statically imported above to prove it has no database dependency.
  ({ customerId } = await operatingDb());
  route = await import("../../app/api/classifications/route");
});

const contract: any = buildClassificationsOpenApiSpec().paths["/api/classifications"];
const jsonRequest = (method: string, body: unknown) => new Request("http://localhost/api/classifications", {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("classification discovery declares the real methods, statuses, and shared enums", () => {
  assert.deepEqual(Object.keys(contract), ["get", "post", "patch"]);
  assert.deepEqual(Object.keys(contract.get.responses).sort(), ["200", "400"]);
  assert.deepEqual(Object.keys(contract.post.responses).sort(), ["200", "400"]);
  assert.deepEqual(Object.keys(contract.patch.responses).sort(), ["200", "400", "500"]);

  const proposalTier = contract.post.requestBody.content["application/json"].schema.properties.tier.enum;
  assert.deepEqual(proposalTier, DIRECT_CLASSIFICATION_TIERS);
  const decisions = contract.patch.requestBody.content["application/json"].schema.oneOf;
  assert.deepEqual(decisions.map((shape: any) => shape.properties.action.enum[0]), CLASSIFICATION_PATCH_ACTIONS);

  const responseTier = contract.get.responses["200"].content["application/json"].schema.properties.history.items.properties.tier.enum;
  const responseStatus = contract.get.responses["200"].content["application/json"].schema.properties.history.items.properties.status.enum;
  assert.deepEqual(responseTier, CLASSIFICATION_TIERS);
  assert.deepEqual(responseStatus, CLASSIFICATION_STATUSES);
});

test("discovery serves the exact cacheable OpenAPI 3.1 document", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildClassificationsOpenApiSpec());
});

test("discovery imports and runs when the configured database path is unusable", () => {
  const script = [
    "const imported = await import(\'./app/api/classifications/openapi/route.ts\');",
    "const GET = imported.GET ?? imported.default?.GET;",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/classifications']?.patch) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the documented proposal, resolve, approval, rejection, and error paths use the real route", async () => {
  const { upsertProduct } = await import("@/lib/catalogue/products");
  const { product } = (await upsertProduct(customerId, { sku: "API-CLASS-1", name: "Steel fastener" }));

  const missingProduct = await route.GET(new Request("http://localhost/api/classifications"));
  assert.equal(missingProduct.status, 400);
  assert.match((await missingProduct.json()).error, /productId/);

  const proposalResponse = await route.POST(jsonRequest("POST", {
    productId: product.id,
    system: "HTS",
    code: "7318.15.20",
    tier: "human",
    basis: "classification review by import specialist",
    jurisdiction: "US",
  }));
  assert.equal(proposalResponse.status, 200);
  const { classification } = await proposalResponse.json();
  assert.equal(classification.status, "proposed");

  const getResponse = await route.GET(new Request(
    `http://localhost/api/classifications?productId=${product.id}&system=HTS&jurisdiction=US`,
  ));
  assert.equal(getResponse.status, 200);
  const listing = await getResponse.json();
  assert.equal(listing.history[0].id, classification.id);
  assert.equal(listing.resolved.current.id, classification.id);

  const approvalResponse = await route.PATCH(jsonRequest("PATCH", {
    action: "approve",
    classificationId: classification.id,
    approvedBy: "Import specialist",
    rationale: "Matches the technical drawing and HTS heading notes.",
  }));
  assert.equal(approvalResponse.status, 200);
  assert.equal((await approvalResponse.json()).classification.status, "approved");

  const rejectedProposal = await route.POST(jsonRequest("POST", {
    productId: product.id,
    system: "Schedule B",
    code: "7318.15.0000",
    tier: "human",
    basis: "manual review",
  }));
  const rejectedId = (await rejectedProposal.json()).classification.id;
  const rejectionResponse = await route.PATCH(jsonRequest("PATCH", {
    action: "reject",
    classificationId: rejectedId,
    reason: "Wrong classification system for this import record.",
  }));
  assert.equal(rejectionResponse.status, 200);
  assert.deepEqual(await rejectionResponse.json(), { ok: true });

  const forbiddenDocument = await route.POST(jsonRequest("POST", {
    productId: product.id,
    system: "HTS",
    code: "7318.15.20",
    tier: "document",
    basis: "uncited assertion",
  }));
  assert.equal(forbiddenDocument.status, 400);
  assert.match((await forbiddenDocument.json()).error, /cannot be asserted directly/);
});
