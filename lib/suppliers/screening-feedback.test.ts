import assert from "node:assert/strict";
import test from "node:test";
import { supplierScreeningFeedback } from "./screening-feedback";

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
