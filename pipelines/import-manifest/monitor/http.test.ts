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
test("HTTP surfaces a human-fixable message for an invalid country filter, not just 'Invalid'", async () => {
  // Regression check for the query.ts custom regex message: an agent (or a
  // human copy-pasting from a shipper address) that sends a lowercase or
  // 3-letter country code should be told the exact fix ("two-letter
  // uppercase ISO-3166-1 alpha-2") in the 400 body itself, not a bare
  // zod "Invalid" that forces a second lookup against the params doc.
  const response = await respondToMonitorQuery(new Request("https://cante.test/api/import-monitor?country=china"), "tenant", async () => { throw new Error("must not read"); });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.issues.fieldErrors.country[0], /two-letter uppercase ISO-3166-1/);
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
  const failedBody = await failed.json();
  assert.equal(failedBody.error, "Import monitoring storage is unavailable.");
  // 503 is a transient storage outage, not a bad request: an agent should be
  // able to tell from the body alone that retrying the same params is right,
  // and still get the param contract without a second round trip.
  assert.equal(failedBody.retryable, true);
  assert.ok(failedBody.params.limit.max === 100, "params doc should also be present on the 503 path");
});
