import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { GET as discover } from "../../app/api/tariff/openapi/route";
import { GET as tariff } from "../../app/api/tariff/route";
import { buildTariffOpenApiSpec } from "./openapi";
import { resetTariffCacheForTests } from "./rates";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetTariffCacheForTests();
});

const contract: any = buildTariffOpenApiSpec().paths["/api/tariff"].get;
const request = (query: string) => new Request(`http://localhost/api/tariff?${query}`);
const usitcRow = (code: string, general: string) => ({
  htsno: code,
  description: `Test row ${code}`,
  units: ["kg"],
  general,
  special: "Free (S)",
  other: "35%",
  additionalDuties: null,
});

function mockUsitc(rowsForCode: (code: string) => unknown[]) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    return Response.json(rowsForCode(url.searchParams.get("keyword") ?? ""));
  }) as typeof fetch;
}

test("tariff discovery declares every query and status emitted by the route", () => {
  assert.deepEqual(contract.parameters.map((parameter: any) => parameter.name), [
    "code", "declared", "expected", "value", "quantity", "unit", "programme",
  ]);
  assert.deepEqual(Object.keys(contract.responses).sort(), ["200", "400", "404", "500", "502"]);
  assert.equal(contract.responses["200"].content["application/json"].schema.oneOf.length, 3);
});

test("discovery serves the exact cacheable OpenAPI 3.1 document", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildTariffOpenApiSpec());
});

test("discovery imports without customer storage or the live tariff service", () => {
  const script = [
    "globalThis.fetch = () => { throw new Error('discovery called the network'); };",
    "const { GET } = await import('./app/api/tariff/openapi/route.ts');",
    "const response = await GET();",
    "if (response.status !== 200) process.exit(2);",
    "const spec = await response.json();",
    "if (!spec.paths?.['/api/tariff']?.get) process.exit(3);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, CANTE_DATA_BACKEND: "sqlite", CANTE_DB_PATH: "/dev/null/cante.db" },
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test("the three documented success shapes match real route responses", async () => {
  mockUsitc((code) => code.startsWith("6306") ? [usitcRow("6306.12.0000", "8.8%")] : [usitcRow("3921.90.0000", "4%")]);

  const lookupResponse = await tariff(request("code=6306.12"));
  assert.equal(lookupResponse.status, 200);
  assert.equal((await lookupResponse.json()).row.htsCode, "6306.12.0000");

  resetTariffCacheForTests();
  const quoteResponse = await tariff(request("code=6306.12&value=1000"));
  assert.equal(quoteResponse.status, 200);
  const quotePayload = await quoteResponse.json();
  assert.equal(quotePayload.quote.computation.amount, 88);
  assert.equal(quotePayload.quote.computation.currency, "USD");

  resetTariffCacheForTests();
  const comparisonResponse = await tariff(request("declared=3921.90&expected=6306.12&value=1000"));
  assert.equal(comparisonResponse.status, 200);
  const comparison = await comparisonResponse.json();
  assert.equal(comparison.difference, 48);
  assert.equal(comparison.currency, "USD");
});

test("documented correction and upstream failures return agent-readable JSON", async () => {
  const missingOperation = await tariff(request(""));
  assert.equal(missingOperation.status, 400);
  assert.match((await missingOperation.json()).error, /Provide code/);

  const badValue = await tariff(request("code=6306.12&value=lots"));
  assert.equal(badValue.status, 400);
  assert.match((await badValue.json()).error, /number/);

  mockUsitc(() => []);
  const missingRow = await tariff(request("code=0000"));
  assert.equal(missingRow.status, 404);
  assert.match((await missingRow.json()).error, /No published HTS row/);

  resetTariffCacheForTests();
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const upstreamFailure = await tariff(request("code=6306.12"));
  assert.equal(upstreamFailure.status, 502);
  assert.match((await upstreamFailure.json()).error, /USITC HTS returned HTTP 503/);
});
