import { describe, expect, it, vi } from 'vitest';
import { createBoundedAsyncCache } from './boundedAsyncCache';

describe('createBoundedAsyncCache', () => {
  it('evicts the least recently used entry when the capacity is exceeded', async () => {
    const cache = createBoundedAsyncCache<string>(2);
    const loadA = vi.fn(async () => 'a');
    const loadB = vi.fn(async () => 'b');
    const loadC = vi.fn(async () => 'c');

    await cache.getOrLoad('a', loadA);
    await cache.getOrLoad('b', loadB);
    await cache.getOrLoad('a', loadA);
    await cache.getOrLoad('c', loadC);
    await cache.getOrLoad('a', loadA);
    await cache.getOrLoad('b', loadB);

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(2);
    expect(loadC).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent loads for the same key', async () => {
    const cache = createBoundedAsyncCache<string>(2);
    let resolveLoad!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((resolve) => {
      resolveLoad = resolve;
    }));

    const first = cache.getOrLoad('shared', loader);
    const second = cache.getOrLoad('shared', loader);

    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoad('value');
    await expect(first).resolves.toBe('value');
  });

  it('does not cache rejected loads', async () => {
    const cache = createBoundedAsyncCache<string>(2);
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce('recovered');

    await expect(cache.getOrLoad('retryable', loader)).rejects.toThrow('temporary failure');
    await expect(cache.getOrLoad('retryable', loader)).resolves.toBe('recovered');

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('counts pending entries toward the limit without letting an evicted load overwrite a newer generation', async () => {
    const cache = createBoundedAsyncCache<string>(1);
    let resolveStale!: (value: string) => void;
    let resolveFresh!: (value: string) => void;
    const staleLoader = vi.fn(() => new Promise<string>((resolve) => {
      resolveStale = resolve;
    }));
    const freshLoader = vi.fn(() => new Promise<string>((resolve) => {
      resolveFresh = resolve;
    }));

    const stale = cache.getOrLoad('table', staleLoader);
    await cache.getOrLoad('other', async () => 'other');
    const fresh = cache.getOrLoad('table', freshLoader);

    expect(fresh).not.toBe(stale);
    expect(staleLoader).toHaveBeenCalledTimes(1);
    expect(freshLoader).toHaveBeenCalledTimes(1);

    resolveStale('stale');
    await expect(stale).resolves.toBe('stale');
    expect(cache.getOrLoad('table', freshLoader)).toBe(fresh);

    resolveFresh('fresh');
    await expect(fresh).resolves.toBe('fresh');
  });

  it('invalidates only entries whose keys match a prefix', async () => {
    const cache = createBoundedAsyncCache<string>(4);
    const loadTarget = vi.fn(async () => 'target');
    const loadOther = vi.fn(async () => 'other');

    await cache.getOrLoad('connection-a|db|orders', loadTarget);
    await cache.getOrLoad('connection-b|db|orders', loadOther);

    cache.invalidatePrefix('connection-a|db|');

    await cache.getOrLoad('connection-a|db|orders', loadTarget);
    await cache.getOrLoad('connection-b|db|orders', loadOther);

    expect(loadTarget).toHaveBeenCalledTimes(2);
    expect(loadOther).toHaveBeenCalledTimes(1);
  });
});
