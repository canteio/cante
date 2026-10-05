import { operatingDb } from "@/lib/test-support/supabase-test-db";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { beforeEach, test } from "node:test";
import { GET as discover } from "../../app/api/onboarding/website/openapi/route";
import { WEBSITE_URL_MAX_LENGTH, WebsiteProfileSchema } from "./onboarding";
import { buildOnboardingWebsiteOpenApiSpec } from "./onboarding-website-openapi";

process.env.CANTE_AUTH_MODE = "none";
let route: typeof import("../../app/api/onboarding/website/route");
let customerId: string;

beforeEach(async () => {
  // Import the stateful route only after its isolated database settings exist.
  route = await import("../../app/api/onboarding/website/route");
  ({ customerId } = await operatingDb());
});


const contract: any = buildOnboardingWebsiteOpenApiSpec().paths["/api/onboarding/website"].post;
const request = (body: BodyInit) => new Request("http://localhost/api/onboarding/website", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

test("website onboarding discovery serves the exact cacheable OpenAPI contract", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildOnboardingWebsiteOpenApiSpec());
  assert.deepEqual(Object.keys(contract.responses).sort(), ["200", "400", "403", "500"]);
  assert.equal(
    contract.requestBody.content["application/json"].schema.properties.url.maxLength,
    WEBSITE_URL_MAX_LENGTH,
  );
  const documentedProfile = contract.responses["200"].content["application/json"].schema
    .oneOf[0].properties.profile.properties;
  assert.deepEqual(Object.keys(documentedProfile).sort(), WebsiteProfileSchema.keyof().options.sort());
});

test("website onboarding discovery imports without storage, networking, or model executables", () => {
  const script = [
    "const { GET } = await import('./app/api/onboarding/website/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/onboarding/website']?.post) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", PATH: "/definitely/missing" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("real website onboarding route returns corrective request errors", async () => {
  const malformed = await route.POST(request("{"));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Request body must be valid JSON." });

  for (const body of [null, [], {}, { url: "ftp://example.com" }, { url: "https://user:secret@example.com" }]) {
    const response = await route.POST(request(JSON.stringify(body)));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON object|url must/);
  }

  const oversized = await route.POST(request(JSON.stringify({ url: `https://example.com/${"a".repeat(WEBSITE_URL_MAX_LENGTH)}` })));
  assert.equal(oversized.status, 400);
  assert.match((await oversized.json()).error, /at most 2048 characters/);
});
