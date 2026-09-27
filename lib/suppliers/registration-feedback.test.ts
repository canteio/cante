import assert from "node:assert/strict";
import test from "node:test";
import { supplierRegistrationFeedback } from "./registration-feedback";

test("supplier registration announces a saved vendor after a successful refresh", () => {
  assert.deepEqual(supplierRegistrationFeedback("Acme Components", null), {
    kind: "success",
    message: 'Vendor "Acme Components" was registered.',
  });
});

test("supplier registration preserves success without hiding a refresh failure", () => {
  assert.deepEqual(supplierRegistrationFeedback("Acme Components", "Supplier service unavailable."), {
    kind: "error",
    message: 'Vendor "Acme Components" was registered. Current suppliers could not be refreshed: Supplier service unavailable. Reload before relying on the displayed list.',
  });
});
