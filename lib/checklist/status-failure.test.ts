import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recoverChecklistStatusFailure } from "./status-failure";

const items = [
  { id: "permit-1", status: "completed", title: "Permit one" },
  { id: "permit-2", status: "required", title: "Permit two" },
];

describe("recoverChecklistStatusFailure", () => {
  it("removes a checklist row the server no longer has", () => {
    const recovered = recoverChecklistStatusFailure(items, {
      itemId: "permit-1",
      attemptedStatus: "completed",
      previousStatus: "required",
      httpStatus: 404,
    });

    assert.deepEqual(recovered, [items[1]]);
  });

  it("rolls back an optimistic status after other failures", () => {
    const recovered = recoverChecklistStatusFailure(items, {
      itemId: "permit-1",
      attemptedStatus: "completed",
      previousStatus: "required",
      httpStatus: 500,
    });

    assert.equal(recovered[0]?.status, "required");
    assert.equal(recovered[0]?.title, "Permit one");
  });

  it("does not overwrite a newer status choice", () => {
    const newerItems = [{ ...items[0], status: "needs_review" }, items[1]];
    const recovered = recoverChecklistStatusFailure(newerItems, {
      itemId: "permit-1",
      attemptedStatus: "completed",
      previousStatus: "required",
      httpStatus: 500,
    });

    assert.equal(recovered[0]?.status, "needs_review");
  });
});
