import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStatusRequestTracker } from "./status-request";

describe("createStatusRequestTracker", () => {
  it("marks an older request for the same item as stale", () => {
    const tracker = createStatusRequestTracker();
    const first = tracker.begin("permit-1");
    const second = tracker.begin("permit-1");

    assert.equal(tracker.isLatest(first), false);
    assert.equal(tracker.isLatest(second), true);
  });

  it("tracks requests for separate checklist items independently", () => {
    const tracker = createStatusRequestTracker();
    const firstItem = tracker.begin("permit-1");
    const secondItem = tracker.begin("permit-2");

    assert.equal(tracker.isLatest(firstItem), true);
    assert.equal(tracker.isLatest(secondItem), true);
  });

  it("runs status writes for one item in click order", async () => {
    const tracker = createStatusRequestTracker();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = tracker.run("permit-1", async () => {
      events.push("first started");
      await firstGate;
      events.push("first finished");
    });
    const second = tracker.run("permit-1", async () => {
      events.push("second started");
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["first started"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first started", "first finished", "second started"]);
  });

  it("does not block a different checklist item", async () => {
    const tracker = createStatusRequestTracker();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted = false;

    const first = tracker.run("permit-1", () => firstGate);
    const second = tracker.run("permit-2", async () => {
      secondStarted = true;
    });

    await second;
    assert.equal(secondStarted, true);
    releaseFirst();
    await first;
  });
});
