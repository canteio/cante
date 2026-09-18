import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/screening/route";
import { GET as discover } from "@/app/api/screening/openapi/route";
import { buildScreeningOpenApiSpec } from "@/lib/screening/openapi";
import {
  CSL_DATASET_URL,
  SCREENING_LIMITS,
  resetCslCacheForTests,
  screenExactNames,
} from "@/lib/screening/csl";

function record(overrides: Record<string, unknown> = {}) {
  return {
    name: "PRIMARY COMPANY LIMITED",
    alt_names: ["Acme Société, LLC."],
    source: "Entity List (EL) - Bureau of Industry and Security",
    source_list_url: "https://www.bis.gov/entity-list",
    source_information_url: "https://www.bis.gov/",
    addresses: [
      {
        address: "1 Example Road",
        city: "Paris",
        state: null,
        postal_code: "75001",
        country: "FR",
      },
    ],
    ...overrides,
  };
}

function mockDataset(records: unknown[]) {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_input, init) => {
    calls += 1;
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ results: records, total: records.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls: () => calls,
    restore: () => {
      global.fetch = originalFetch;
      resetCslCacheForTests();
    },
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/screening", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const contract = buildScreeningOpenApiSpec().paths["/api/screening"].post;

test("screening discovery serves cacheable OpenAPI 3.1 without operating storage", async () => {
  const response = await discover();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), buildScreeningOpenApiSpec());
  assert.deepEqual(Object.keys(contract.responses).sort(), ["200", "400", "500", "502"]);

  const names = contract.requestBody.content["application/json"].schema.properties.names;
  assert.equal(names.maxItems, SCREENING_LIMITS.maxNames);
  assert.equal(names.items.maxLength, SCREENING_LIMITS.maxNameLength);
});

test("the documented success contract matches a real API response", async () => {
  resetCslCacheForTests();
  const mock = mockDataset([record()]);
  try {
    const response = await post({ names: ["Acme Société, LLC.", "Different Company"] });
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
    assert.deepEqual(
      Object.keys(body).sort(),
      [...contract.responses["200"].content["application/json"].schema.required].sort(),
    );
    assert.equal((body.matches as unknown[]).length, 1);
    assert.deepEqual(body.unmatchedNames, ["Different Company"]);
  } finally {
    mock.restore();
  }
});

test("matches an exact normalized alias and returns source context", async () => {
  resetCslCacheForTests();
  const mock = mockDataset([record()]);
  try {
    const result = await screenExactNames({ names: ["ACME SOCIETE LLC"] });
    assert.equal(result.sourceUrl, CSL_DATASET_URL);
    assert.equal(result.matchMethod, "exact-normalized-name");
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].matchField, "alias");
    assert.equal(result.matches[0].matchedName, "Acme Société, LLC.");
    assert.equal(result.matches[0].primaryName, "PRIMARY COMPANY LIMITED");
    assert.equal(
      result.matches[0].sourceList,
      "Entity List (EL) - Bureau of Industry and Security",
    );
    assert.deepEqual(result.matches[0].countries, ["FR"]);
    assert.equal(result.matches[0].addresses[0].city, "Paris");
    assert.equal(result.matches[0].sourceUrl, "https://www.bis.gov/entity-list");

    await screenExactNames({ names: ["PRIMARY COMPANY LIMITED"] });
    assert.equal(mock.calls(), 1, "the in-memory snapshot should be reused");
  } finally {
    mock.restore();
  }
});

test("a no-hit response carries explicit non-clearance caveats", async () => {
  resetCslCacheForTests();
  const mock = mockDataset([record()]);
  try {
    const result = await screenExactNames({ names: ["Different Company"] });
    assert.deepEqual(result.matches, []);
    assert.deepEqual(result.unmatchedNames, ["Different Company"]);
    assert.match(result.caveats.join(" "), /No hit does not clear.*ownership.*end-use.*license/i);
    assert.match(result.caveats.join(" "), /exact normalized-name matching only/i);
  } finally {
    mock.restore();
  }
});

test("the API fails closed when the upstream record structure is malformed", async () => {
  resetCslCacheForTests();
  const mock = mockDataset([record({ alt_names: [42] })]);
  try {
    const response = await post({ names: ["Example"] });
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 502);
    assert.match(body.error, /alt_names/i);
  } finally {
    mock.restore();
  }
});

test("the API rejects request limits before fetching Trade.gov", async () => {
  resetCslCacheForTests();
  const originalFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    throw new Error("should not fetch");
  };
  try {
    const response = await post({
      names: Array.from({ length: SCREENING_LIMITS.maxNames + 1 }, (_, index) => `Name ${index}`),
    });
    const body = (await response.json()) as { error: string };
    assert.equal(response.status, 400);
    assert.match(body.error, /At most 25 names/i);
    assert.equal(fetched, false);
  } finally {
    global.fetch = originalFetch;
    resetCslCacheForTests();
  }
});

test("the response match count is bounded and reports truncation", async () => {
  resetCslCacheForTests();
  const records = Array.from({ length: SCREENING_LIMITS.maxMatches + 1 }, (_, index) =>
    record({
      name: `Primary ${index}`,
      alt_names: ["Shared Alias"],
      source: `Source ${index}`,
      addresses: null,
    }),
  );
  const mock = mockDataset(records);
  try {
    const result = await screenExactNames({ names: ["Shared Alias"] });
    assert.equal(result.matches.length, SCREENING_LIMITS.maxMatches);
    assert.equal(result.matchesTruncated, true);
    assert.deepEqual(result.unmatchedNames, []);
  } finally {
    mock.restore();
  }
});
