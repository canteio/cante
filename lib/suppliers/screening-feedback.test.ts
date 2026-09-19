import assert from "node:assert/strict";
import test from "node:test";
import { supplierBatchRefreshError, supplierBatchScreenCompleted, supplierScreeningFeedback } from "./screening-feedback";

test("supplier screening feedback reads the route's nested row contract", () => {
  assert.deepEqual(
    supplierScreeningFeedback({ row: { outcome: "clear", matchCount: 0 } }),
    {
      kind: "success",
      message: "Screening completed with no exact watchlist match. This is not a clearance decision.",
    },
  );

  assert.deepEqual(
    supplierScreeningFeedback({ row: { outcome: "match", matchCount: 1 } }),
    {
      kind: "attention",
      message: "Screening found 1 potential watchlist match. Review before proceeding.",
    },
  );

  assert.deepEqual(
    supplierScreeningFeedback({ row: { outcome: "error", errorMessage: "Trade.gov timed out" } }),
    {
      kind: "error",
      message: "Screening could not be completed: Trade.gov timed out",
    },
  );
});

test("supplier screening feedback rejects the obsolete response shape", () => {
  assert.equal(supplierScreeningFeedback({ screening: { outcome: "clear" } }), null);
});

test("batch screening only counts persisted clear or match outcomes as completed", () => {
  assert.equal(supplierBatchScreenCompleted({ row: { outcome: "clear" } }), true);
  assert.equal(supplierBatchScreenCompleted({ row: { outcome: "match" } }), true);
  assert.equal(supplierBatchScreenCompleted({ row: { outcome: "error" } }), false);
  assert.equal(supplierBatchScreenCompleted({ row: null }), false);
  assert.equal(supplierBatchScreenCompleted({ clear: true }), false);
});

test("batch refresh feedback reports screening outcomes without hiding the refresh failure", () => {
  assert.equal(supplierBatchRefreshError(3, 1, null), null);
  assert.equal(
    supplierBatchRefreshError(3, 1, "Supplier service unavailable."),
    "Screening requests finished (2 completed, 1 failed), but current results could not be refreshed: Supplier service unavailable. Reload before relying on the displayed results.",
  );
});
