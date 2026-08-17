import assert from "node:assert/strict";
import test, { before } from "node:test";
import { operatingDb, seedFinding } from "@/lib/test-support/operating-db";

before(async () => {
  await operatingDb();
});

test("an untouched finding surfaces as `new` rather than being absent", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { listWorkQueue } = await import("@/lib/workflow/actions");
  seedFinding(dbPath, customerId, { id: `w1-${customerId}`, title: "Permendag 12/2026" });

  const queue = listWorkQueue(customerId);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].state, "new");
  assert.equal(queue[0].action, null);
});

test("dismissal requires a reason, assignment requires an assignee", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { transition, WorkflowError } = await import("@/lib/workflow/actions");
  const id = `w2-${customerId}`;
  seedFinding(dbPath, customerId, { id, title: "Permendag 12/2026" });

  assert.throws(
    () => transition({ findingId: id, customerId, state: "irrelevant" }),
    (e: Error) => e instanceof WorkflowError && /requires a reason/.test(e.message),
    "dismissal is the transition that destroys information, so it costs a sentence",
  );
  assert.throws(
    () => transition({ findingId: id, customerId, state: "assigned" }),
    (e: Error) => e instanceof WorkflowError && /requires an assignee/.test(e.message),
  );
  assert.throws(
    () => transition({ findingId: id, customerId, state: "forwarded_to_broker" }),
    (e: Error) => e instanceof WorkflowError && /requires a recipient/.test(e.message),
  );
});

test("the full broker round trip is recorded, and closing is sticky", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { transition, getAction, listWorkQueue, WorkflowError } = await import(
    "@/lib/workflow/actions"
  );
  const id = `w3-${customerId}`;
  seedFinding(dbPath, customerId, { id, title: "Permendag 12/2026" });

  transition({ findingId: id, customerId, state: "acknowledged" });
  transition({ findingId: id, customerId, state: "assigned", assignee: "Rina", dueAt: "2026-09-01" });
  transition({
    findingId: id,
    customerId,
    state: "forwarded_to_broker",
    forwardedTo: "PT Broker Jaya",
  });
  transition({
    findingId: id,
    customerId,
    state: "closed",
    brokerDecision: "Not applicable to 6306.19.90; no action needed.",
  });

  const action = getAction(id);
  assert.equal(action?.state, "closed");
  assert.equal(action?.assignee, "Rina", "earlier fields survive later transitions");
  assert.equal(action?.forwardedTo, "PT Broker Jaya");
  assert.ok(action?.brokerDecidedAt, "the broker decision is timestamped");
  assert.ok(action?.closedAt);

  // Closed findings leave the open queue but remain in history.
  assert.equal(listWorkQueue(customerId).length, 0);
  assert.equal(listWorkQueue(customerId, { includeResolved: true }).length, 1);

  assert.throws(
    () => transition({ findingId: id, customerId, state: "acknowledged" }),
    (e: Error) => e instanceof WorkflowError && /already closed/.test(e.message),
  );
  transition({ findingId: id, customerId, state: "acknowledged", reopen: true });
  assert.equal(getAction(id)?.state, "acknowledged");
});

test("overdue is computed against the due date", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { transition, listWorkQueue } = await import("@/lib/workflow/actions");
  const id = `w4-${customerId}`;
  seedFinding(dbPath, customerId, { id, title: "Permendag 12/2026" });
  transition({ findingId: id, customerId, state: "assigned", assignee: "Rina", dueAt: "2026-08-01" });

  const queue = listWorkQueue(customerId, { now: new Date("2026-08-16T00:00:00Z") });
  assert.equal(queue[0].overdue, true);
  const early = listWorkQueue(customerId, { now: new Date("2026-07-01T00:00:00Z") });
  assert.equal(early[0].overdue, false);
});

test("a finding belonging to another customer cannot be transitioned", async () => {
  const a = await operatingDb();
  const b = await operatingDb();
  const { transition, WorkflowError } = await import("@/lib/workflow/actions");
  const id = `w5-${a.customerId}`;
  seedFinding(a.dbPath, a.customerId, { id, title: "Permendag 12/2026" });

  assert.throws(
    () => transition({ findingId: id, customerId: b.customerId, state: "acknowledged" }),
    (e: Error) => e instanceof WorkflowError && /different customer/.test(e.message),
  );
});

test("cleared findings never enter the work queue", async () => {
  const { customerId, dbPath } = await operatingDb();
  const { listWorkQueue } = await import("@/lib/workflow/actions");
  seedFinding(dbPath, customerId, { id: `w6a-${customerId}`, title: "HPE decree", relevance: "clear" });
  seedFinding(dbPath, customerId, { id: `w6b-${customerId}`, title: "OSS ping", relevance: "baseline" });
  seedFinding(dbPath, customerId, { id: `w6c-${customerId}`, title: "PMK 58/2026", relevance: "noted" });

  const queue = listWorkQueue(customerId);
  assert.equal(queue.length, 1, "only flagged and noted are work");
  assert.equal(queue[0].finding.title, "PMK 58/2026");
});
