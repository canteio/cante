import assert from "node:assert/strict";
import test from "node:test";
import {
  scheduleSupplierNoteClear,
  type SupplierNoteClock,
  type SupplierNoteTimer,
} from "./transient-note";

function createFakeClock() {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  const clock: SupplierNoteClock = {
    schedule(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id as unknown as SupplierNoteTimer;
    },
    cancel(timer) {
      const id = timer as unknown as number;
      cancelled.push(id);
      callbacks.delete(id);
    },
  };

  return { clock, callbacks, cancelled };
}

test("a newer supplier note cancels the older clear timer", () => {
  const fake = createFakeClock();
  let note = "First supplier was registered.";
  const firstTimer = scheduleSupplierNoteClear(
    null,
    () => { note = ""; },
    3000,
    fake.clock,
  );

  note = "Second supplier was registered.";
  const secondTimer = scheduleSupplierNoteClear(
    firstTimer,
    () => { note = ""; },
    3000,
    fake.clock,
  );

  assert.deepEqual(fake.cancelled, [1]);
  assert.equal(fake.callbacks.has(1), false);
  assert.equal(note, "Second supplier was registered.");

  fake.callbacks.get(secondTimer as unknown as number)?.();
  assert.equal(note, "");
});
