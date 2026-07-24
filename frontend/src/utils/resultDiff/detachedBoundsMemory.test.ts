import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadResultDiffDetachedBoundsMemory,
  resolveResultDiffDetachedBounds,
  saveResultDiffDetachedBoundsMemory,
} from './detachedBoundsMemory';
import { APP_DETACHED_WINDOW_Z_INDEX_BASE } from '../overlayZIndex';

describe('resultDiff detachedBoundsMemory', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    vi.stubGlobal('window', {
      innerWidth: 1600,
      innerHeight: 1000,
    });
  });

  it('saves and loads bounds', () => {
    saveResultDiffDetachedBoundsMemory({ x: 40, y: 60, width: 1100, height: 700 });
    const mem = loadResultDiffDetachedBoundsMemory();
    expect(mem).toEqual({ x: 40, y: 60, width: 1100, height: 700 });
  });

  it('clamps oversized memory to viewport', () => {
    const resolved = resolveResultDiffDetachedBounds({
      x: -100,
      y: 9999,
      width: 5000,
      height: 4000,
    });
    expect(resolved.width).toBeLessThanOrEqual(1600 - 32);
    expect(resolved.height).toBeLessThanOrEqual(1000 - 32);
    expect(resolved.x).toBeGreaterThanOrEqual(16);
    expect(resolved.y).toBeGreaterThanOrEqual(16);
  });

  it('uses defaults when memory missing', () => {
    const resolved = resolveResultDiffDetachedBounds(null);
    expect(resolved.width).toBeGreaterThan(0);
    expect(resolved.height).toBeGreaterThan(0);
    expect(resolved.zIndex).toBe(APP_DETACHED_WINDOW_Z_INDEX_BASE + 1);
  });
});
