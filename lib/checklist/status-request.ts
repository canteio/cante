export type StatusRequestToken = {
  itemId: string;
  version: number;
};

export function createStatusRequestTracker() {
  const versions = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();

  return {
    begin(itemId: string): StatusRequestToken {
      const token = { itemId, version: (versions.get(itemId) ?? 0) + 1 };
      versions.set(itemId, token.version);
      return token;
    },

    isLatest(token: StatusRequestToken): boolean {
      return versions.get(token.itemId) === token.version;
    },

    run<T>(itemId: string, task: () => Promise<T>): Promise<T> {
      // Preserve click order at the server; parallel PATCHes could otherwise
      // finish backwards and persist a status the user already replaced.
      const previous = queues.get(itemId) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(task);
      queues.set(itemId, current);
      return current;
    },
  };
}
