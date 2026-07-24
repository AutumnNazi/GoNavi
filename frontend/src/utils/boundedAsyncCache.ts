export type BoundedAsyncCache<T> = {
  getOrLoad: (key: string, loader: () => Promise<T>) => Promise<T>;
  invalidatePrefix: (prefix: string) => void;
};

export const createBoundedAsyncCache = <T>(maxEntries: number): BoundedAsyncCache<T> => {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive integer');
  }

  type CacheEntry = { promise: Promise<T> };
  const entries = new Map<string, CacheEntry>();

  return {
    getOrLoad(key, loader) {
      const cached = entries.get(key);
      if (cached) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.promise;
      }

      let loaded: Promise<T>;
      try {
        loaded = Promise.resolve(loader());
      } catch (error) {
        loaded = Promise.reject(error);
      }
      const entry: CacheEntry = { promise: loaded };
      entry.promise = loaded.catch((error) => {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
        throw error;
      });
      entries.set(key, entry);
      if (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) {
          entries.delete(oldestKey);
        }
      }
      return entry.promise;
    },
    invalidatePrefix(prefix) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
        }
      }
    },
  };
};
