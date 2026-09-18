type ChecklistStatusItem = {
  id: string;
  status: string;
};

type StatusFailure = {
  itemId: string;
  attemptedStatus: string;
  previousStatus: string;
  httpStatus?: number;
};

export function recoverChecklistStatusFailure<T extends ChecklistStatusItem>(
  items: T[],
  failure: StatusFailure,
): T[] {
  if (failure.httpStatus === 404) {
    // A 404 means recalculation already deleted the row. Remove the stale card
    // instead of restoring an obligation that the server no longer knows.
    return items.filter((item) => item.id !== failure.itemId);
  }

  return items.map((item) =>
    item.id === failure.itemId && item.status === failure.attemptedStatus
      ? { ...item, status: failure.previousStatus }
      : item,
  );
}
