import { describe, expect, it } from 'vitest';

import {
  BoundedQueryEditorMetadataCache,
  estimateQueryEditorMetadataBytes,
} from './queryEditorMetadataCache';

describe('BoundedQueryEditorMetadataCache', () => {
  it('applies TTL and connection-scoped LRU limits', () => {
    let now = 1_000;
    const cache = new BoundedQueryEditorMetadataCache<string>({
      maxEntries: 4,
      maxEntriesPerConnection: 2,
      maxBytes: 1_000,
      ttlMs: 100,
      now: () => now,
      estimateBytes: (value) => value.length,
    });

    cache.set('a', { connectionId: 'conn-a', databaseKey: 'db-a' }, 'one');
    cache.set('b', { connectionId: 'conn-a', databaseKey: 'db-b' }, 'two');
    expect(cache.get('a')).toBe('one');

    cache.set('c', { connectionId: 'conn-a', databaseKey: 'db-c' }, 'three');
    expect(cache.get('a')).toBe('one');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('three');

    now += 101;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('evicts by total bytes and invalidates only the requested scope', () => {
    const cache = new BoundedQueryEditorMetadataCache<{ bytes: number }>({
      maxEntries: 8,
      maxEntriesPerConnection: 8,
      maxBytes: 10,
      ttlMs: 1_000,
      estimateBytes: (value) => value.bytes,
    });

    cache.set('a-main', { connectionId: 'conn-a', databaseKey: 'main' }, { bytes: 4 });
    cache.set('a-audit', { connectionId: 'conn-a', databaseKey: 'audit' }, { bytes: 4 });
    cache.set('b-main', { connectionId: 'conn-b', databaseKey: 'main' }, { bytes: 4 });

    expect(cache.get('a-main')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 2, bytes: 8 });

    cache.invalidate('conn-a', 'audit');
    expect(cache.get('a-audit')).toBeUndefined();
    expect(cache.get('b-main')).toEqual({ bytes: 4 });

    cache.invalidate('conn-b');
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('does not retain one entry larger than the entire byte budget', () => {
    const cache = new BoundedQueryEditorMetadataCache<string>({
      maxEntries: 4,
      maxEntriesPerConnection: 4,
      maxBytes: 4,
      ttlMs: 1_000,
      estimateBytes: (value) => value.length,
    });

    cache.set('wide', { connectionId: 'conn-a', databaseKey: 'main' }, 'oversized');

    expect(cache.get('wide')).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('estimates very large metadata arrays without spreading them as call arguments', () => {
    expect(estimateQueryEditorMetadataBytes(Array.from({ length: 100_000 }, (_, index) => index)))
      .toBeGreaterThan(100_000);
  });
});
