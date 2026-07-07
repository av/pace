/**
 * Async mutex keyed by string. `withLock(keys, fn)` runs `fn` only once every
 * pending holder of any of `keys` has finished, and blocks later acquirers of
 * those keys until `fn` settles.
 *
 * Used by the scheduler to serialize read -> await transform -> replace
 * sections per panel, so concurrent refreshes of sources sharing a panel
 * cannot clobber each other's writes with a stale snapshot.
 *
 * Deadlock-free: all keys are claimed synchronously (single JS turn) before
 * any await, so two overlapping calls always observe the same ordering on
 * every shared key.
 */
export interface KeyedMutex {
  withLock<T>(keys: readonly string[], fn: () => Promise<T> | T): Promise<T>;
}

export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<void>>();

  return {
    async withLock<T>(keys: readonly string[], fn: () => Promise<T> | T): Promise<T> {
      const unique = [...new Set(keys)];
      let release!: () => void;
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });

      // Claim every key synchronously before awaiting anything.
      const predecessors = unique.map((key) => {
        const prev = tails.get(key) ?? Promise.resolve();
        tails.set(key, done);
        return prev;
      });

      await Promise.all(predecessors);
      try {
        return await fn();
      } finally {
        release();
        for (const key of unique) {
          if (tails.get(key) === done) tails.delete(key);
        }
      }
    },
  };
}
