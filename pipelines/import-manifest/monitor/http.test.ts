import assert from "node:assert/strict";
import test from "node:test";
import { respondToMonitorQuery } from "./http";

test("HTTP rejects unauthenticated requests before reading tenant data", async () => {
  let called = false;
  const response = await respondToMonitorQuery(new Request("https://cante.test/api/import-monitor"), null, async () => { called = true; return null; });
  assert.equal(response.status, 401); assert.equal(called, false);
  // An agent hitting the endpoint cold (no session yet) should still get the
  // parameter contract back so it can prep a valid request once authenticated.
  const body = await response.json();
  assert.ok(body.params.country.pattern, "params doc should describe the country field");
});
test("HTTP includes machine-readable param docs on invalid filters", async () => {
  const response = await respondToMonitorQuery(new Request("https://cante.test/api/import-monitor?limit=-1"), "tenant", async () => { throw new Error("must not read"); });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.params.limit.max === 100, "params doc should describe the limit field");
});
test("HTTP ignores injected tenant IDs and returns private no-store coverage even when never run", async () => {
  let tenant = "";
  const response = await respondToMonitorQuery(new Request("https://cante.test/api/import-monitor?customerId=other-tenant"), "session-tenant", async id => { tenant = id; return null; });
  assert.equal(tenant, "session-tenant"); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).status, "never_run");
});
test("HTTP distinguishes invalid filters from unavailable storage", async () => {
  const invalid = await respondToMonitorQuery(new Request("https://cante.test/api/import-monitor?limit=-1"), "tenant", async () => { throw new Error("must not read"); });
  assert.equal(invalid.status, 400);
  const failed = await respondToMonitorQuery(new Request("https://cante.test/api/import-monitor"), "tenant", async () => { throw new Error("test database offline"); });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Import monitoring storage is unavailable." });
});
