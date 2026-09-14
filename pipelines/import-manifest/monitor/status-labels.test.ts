import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSourceStatus } from "./status-labels";

test("describeSourceStatus maps every SourceStatus value to plain-English copy", () => {
  assert.equal(describeSourceStatus("ok"), "Live");
  assert.equal(
    describeSourceStatus("sample"),
    "Sample data only (not a real discovery)",
  );
  assert.equal(
    describeSourceStatus("blocked"),
    "Not configured — no data source is connected yet",
  );
  assert.equal(
    describeSourceStatus("error"),
    "Fetch failed — showing last known good data",
  );
});

test("describeSourceStatus never returns the raw machine status token", () => {
  for (const status of ["ok", "sample", "blocked", "error"] as const) {
    assert.notEqual(describeSourceStatus(status), status);
  }
});
