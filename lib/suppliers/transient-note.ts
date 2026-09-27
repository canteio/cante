export type SupplierNoteTimer = ReturnType<typeof setTimeout>;

export type SupplierNoteClock = {
  schedule: (callback: () => void, delayMs: number) => SupplierNoteTimer;
  cancel: (timer: SupplierNoteTimer) => void;
};

const browserClock: SupplierNoteClock = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (timer) => clearTimeout(timer),
};

export function scheduleSupplierNoteClear(
  previousTimer: SupplierNoteTimer | null,
  clearNote: () => void,
  delayMs: number,
  clock: SupplierNoteClock = browserClock,
): SupplierNoteTimer {
  // Cancel before scheduling so an older success cannot clear the newer note.
  if (previousTimer !== null) clock.cancel(previousTimer);
  return clock.schedule(clearNote, delayMs);
}
