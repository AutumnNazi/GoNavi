/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadMainWindowDisplayLayout,
  normalizeMainWindowDisplayLayout,
  resolveGlobalWindowBounds,
  resolvePlacementDisplay,
  resolveMaximisedWindowRestoreBounds,
  resolveRuntimeWindowPlacement,
  resolveVisibleGlobalWindowBounds,
  resolveWailsWindowPosition,
  type MainWindowDisplayLayout,
} from './mainWindowDisplayPlacement';

const PRIMARY = { x: 0, y: 30, width: 1920, height: 962, primary: true, current: true };
const SECONDARY = { x: 1920, y: 0, width: 1512, height: 950 };

const macDualDisplay: MainWindowDisplayLayout = {
  displays: [PRIMARY, SECONDARY],
  positionIsGlobal: false,
};

describe('normalizeMainWindowDisplayLayout', () => {
  it('keeps usable work areas and drops degenerate ones', () => {
    expect(normalizeMainWindowDisplayLayout({
      displays: [
        { x: 0, y: 30, width: 1920, height: 962, primary: true, current: true },
        { x: 0, y: 0, width: 0, height: 962 },
        { x: 1920, y: 0, width: 1512, height: 950 },
      ],
      positionIsGlobal: false,
    })).toEqual({
      displays: [PRIMARY, SECONDARY],
      positionIsGlobal: false,
    });
  });

  it('rejects payloads without a display array', () => {
    expect(normalizeMainWindowDisplayLayout(null)).toBeNull();
    expect(normalizeMainWindowDisplayLayout({ positionIsGlobal: true })).toBeNull();
  });
});

describe('resolvePlacementDisplay', () => {
  it('returns the display holding the remembered window', () => {
    expect(resolvePlacementDisplay(
      { width: 1200, height: 800, x: 2000, y: 100 },
      macDualDisplay,
    )).toBe(SECONDARY);
  });

  it('falls back to the nearest display when the remembered screen was unplugged', () => {
    expect(resolvePlacementDisplay(
      { width: 1200, height: 800, x: 5000, y: 100 },
      macDualDisplay,
    )).toBe(SECONDARY);
    expect(resolvePlacementDisplay(
      { width: 1200, height: 800, x: -4000, y: 100 },
      macDualDisplay,
    )).toBe(PRIMARY);
  });

  it('returns null when the platform exposes no display list', () => {
    expect(resolvePlacementDisplay(
      { width: 1200, height: 800, x: 0, y: 0 },
      { displays: [], positionIsGlobal: true },
    )).toBeNull();
  });
});

describe('resolveGlobalWindowBounds', () => {
  it('adds the current monitor work-area origin for macOS local positions', () => {
    expect(resolveGlobalWindowBounds(
      { width: 1200, height: 800, x: 80, y: 70 },
      macDualDisplay,
    )).toEqual({ width: 1200, height: 800, x: 80, y: 100 });
  });

  it('keeps already-global positions untouched', () => {
    const bounds = { width: 1200, height: 800, x: 2000, y: 120 };
    expect(resolveGlobalWindowBounds(bounds, {
      displays: [PRIMARY, SECONDARY],
      positionIsGlobal: true,
    })).toEqual(bounds);
  });

  it('returns null without a display list so the caller keeps the legacy path', () => {
    expect(resolveGlobalWindowBounds(
      { width: 1200, height: 800, x: 10, y: 20 },
      null,
    )).toBeNull();
  });
});

describe('resolveWailsWindowPosition', () => {
  it('uses the current Windows monitor work-area origin when moving to another monitor', () => {
    const layout = {
      displays: [PRIMARY, SECONDARY],
      positionIsGlobal: true,
      setPositionIsLocal: true,
    } as MainWindowDisplayLayout;
    expect(resolveWailsWindowPosition(
      { width: 1000, height: 700, x: 2100, y: 100 },
      layout,
    )).toEqual({ x: 2100, y: 70 });
    expect(resolveVisibleGlobalWindowBounds(
      { width: 1000, height: 700, x: 2100, y: 100 },
      layout,
    )).toEqual({ width: 1000, height: 700, x: 2100, y: 100 });
  });
  it('keeps negative secondary-screen coordinates and falls back when it is unplugged', () => {
    const left = { x: -1536, y: 0, width: 1536, height: 816 };
    const currentOnLeft: MainWindowDisplayLayout = {
      displays: [{ ...PRIMARY, current: false }, { ...left, current: true }],
      positionIsGlobal: true,
      setPositionIsLocal: true,
    };
    const saved = { width: 900, height: 700, x: -1400, y: 60 };
    expect(resolveVisibleGlobalWindowBounds(saved, currentOnLeft)).toEqual(saved);
    expect(resolveWailsWindowPosition(saved, currentOnLeft)).toEqual({ x: 136, y: 60 });

    const unplugged: MainWindowDisplayLayout = {
      displays: [PRIMARY], positionIsGlobal: true, setPositionIsLocal: true,
    };
    const fallback = resolveVisibleGlobalWindowBounds(saved, unplugged);
    expect(fallback).toEqual({ width: 900, height: 700, x: 510, y: 161 });
    expect(resolveWailsWindowPosition(fallback!, unplugged)).toEqual({ x: 510, y: 131 });
    const viewport = { availWidth: 1920, availHeight: 962, availLeft: 0, availTop: 30 };
    expect(resolveRuntimeWindowPlacement(saved, currentOnLeft, viewport, true, true)).toEqual({
      bounds: saved,
      position: { x: 136, y: 60 },
      persistedBounds: saved,
    });
    expect(resolveRuntimeWindowPlacement(saved, unplugged, viewport, true, true)?.bounds).toEqual(fallback);
  });
  it('converts a global target back to macOS monitor-local input', () => {
    expect(resolveWailsWindowPosition(
      { width: 1200, height: 800, x: 2000, y: 120 },
      macDualDisplay,
    )).toEqual({ x: 2000, y: 90 });
  });

  it('passes global coordinates straight through on Windows/Linux', () => {
    expect(resolveWailsWindowPosition(
      { width: 1200, height: 800, x: 2000, y: 120 },
      { displays: [PRIMARY, SECONDARY], positionIsGlobal: true },
    )).toEqual({ x: 2000, y: 120 });
  });

  it('returns null when the current display is unknown', () => {
    expect(resolveWailsWindowPosition(
      { width: 1200, height: 800, x: 0, y: 0 },
      { displays: [SECONDARY], positionIsGlobal: false },
    )).toBeNull();
  });
});

describe('resolveVisibleGlobalWindowBounds', () => {
  it('keeps macOS monitor-local runtime coordinates separate from persisted global coordinates', () => {
    const localBounds = { width: 1000, height: 700, x: 80, y: 70 };
    expect(resolveRuntimeWindowPlacement(
      localBounds, macDualDisplay,
      { availWidth: 1920, availHeight: 962, availLeft: 0, availTop: 0 },
      false,
    )).toEqual({
      bounds: { ...localBounds, y: 100 },
      position: { x: 80, y: 70 },
      persistedBounds: { ...localBounds, y: 100 },
    });
  });
  it('moves remembered normal bounds to the monitor of a maximised window without changing its size', () => {
    const layout: MainWindowDisplayLayout = {
      displays: [{ ...PRIMARY, current: false }, { ...SECONDARY, current: true }],
      positionIsGlobal: true,
      setPositionIsLocal: true,
    };
    const saved = { width: 1000, height: 700, x: 80, y: 90 };
    expect(resolveMaximisedWindowRestoreBounds(saved, layout)).toEqual({
      width: 1000, height: 700, x: 2176, y: 125,
    });
    expect(resolveMaximisedWindowRestoreBounds(
      { ...saved, x: 2000, y: 60 }, layout,
    )).toBeNull();
    expect(resolveMaximisedWindowRestoreBounds(
      { ...saved, x: 1300, y: 60 }, layout,
    )).toEqual({ width: 1000, height: 700, x: 2176, y: 125 });
    expect(resolveMaximisedWindowRestoreBounds(saved, null)).toBeNull();
  });
  it('keeps a remembered secondary-display position instead of pulling it back to the primary screen', () => {
    expect(resolveVisibleGlobalWindowBounds(
      { width: 1200, height: 800, x: 2100, y: 90 },
      macDualDisplay,
    )).toEqual({ width: 1200, height: 800, x: 2100, y: 90 });
  });

  it('centres a window whose display disappeared and shrinks oversized windows', () => {
    expect(resolveVisibleGlobalWindowBounds(
      { width: 1200, height: 800, x: 6000, y: 200 },
      { displays: [PRIMARY], positionIsGlobal: false },
    )).toEqual({ width: 1200, height: 800, x: 360, y: 111 });

    expect(resolveVisibleGlobalWindowBounds(
      { width: 2400, height: 1600, x: 0, y: 0 },
      { displays: [PRIMARY], positionIsGlobal: false },
    )).toEqual({ width: 1920, height: 962, x: 0, y: 30 });
  });
});

describe('loadMainWindowDisplayLayout', () => {
  afterEach(() => {
    delete (window as unknown as { go?: unknown }).go;
  });

  it('reads the layout from the Wails binding', async () => {
    const data = { displays: [PRIMARY, SECONDARY], positionIsGlobal: false };
    const getLayout = vi.fn().mockResolvedValue({ success: true, data });
    (window as unknown as { go?: unknown }).go = {
      app: { App: { GetMainWindowDisplayLayout: getLayout } },
    };

    await expect(loadMainWindowDisplayLayout()).resolves.toEqual({
      displays: [PRIMARY, SECONDARY],
      positionIsGlobal: false,
    });
    expect(getLayout).toHaveBeenCalledTimes(1);
  });

  it('preserves Windows current-monitor-relative SetPosition semantics', () => {
    expect(normalizeMainWindowDisplayLayout({
      displays: [PRIMARY, SECONDARY],
      positionIsGlobal: true,
      setPositionIsLocal: true,
    })).toMatchObject({ setPositionIsLocal: true });
  });

  it('returns null when the binding is missing or reports failure', async () => {
    expect(await loadMainWindowDisplayLayout()).toBeNull();

    (window as unknown as { go?: unknown }).go = {
      app: { App: { GetMainWindowDisplayLayout: async () => ({ success: false }) } },
    };
    expect(await loadMainWindowDisplayLayout()).toBeNull();

    (window as unknown as { go?: unknown }).go = {
      app: { App: { GetMainWindowDisplayLayout: async () => { throw new Error('ipc down'); } } },
    };
    expect(await loadMainWindowDisplayLayout()).toBeNull();
  });
});
