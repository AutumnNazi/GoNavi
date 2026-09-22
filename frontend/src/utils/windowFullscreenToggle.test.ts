import { describe, expect, it, vi } from 'vitest';

import { toggleWindowFullscreen, type WindowFullscreenRuntime } from './windowFullscreenToggle';

const buildRuntime = (overrides: Partial<WindowFullscreenRuntime> = {}) => {
  const setWindowState = vi.fn();
  const runtime: WindowFullscreenRuntime = {
    isFullscreen: () => false,
    isMaximised: () => false,
    enterFullscreen: vi.fn(),
    exitFullscreen: vi.fn(),
    setWindowState,
    ...overrides,
  };
  return { runtime, setWindowState };
};

describe('toggleWindowFullscreen', () => {
  it('enters fullscreen from a windowed state', async () => {
    const { runtime, setWindowState } = buildRuntime({ isFullscreen: () => false });

    const next = await toggleWindowFullscreen(runtime);

    expect(runtime.enterFullscreen).toHaveBeenCalledTimes(1);
    expect(runtime.exitFullscreen).not.toHaveBeenCalled();
    expect(next).toBe('fullscreen');
    expect(setWindowState).toHaveBeenCalledWith('fullscreen');
  });

  it('exits fullscreen back to maximised when the window was maximised before', async () => {
    const { runtime, setWindowState } = buildRuntime({
      isFullscreen: () => true,
      isMaximised: () => true,
    });

    const next = await toggleWindowFullscreen(runtime);

    expect(runtime.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(runtime.enterFullscreen).not.toHaveBeenCalled();
    expect(next).toBe('maximized');
    expect(setWindowState).toHaveBeenCalledWith('maximized');
  });

  it('exits fullscreen to normal when the window was not maximised', async () => {
    const { runtime, setWindowState } = buildRuntime({
      isFullscreen: () => true,
      isMaximised: () => false,
    });

    const next = await toggleWindowFullscreen(runtime);

    expect(next).toBe('normal');
    expect(setWindowState).toHaveBeenCalledWith('normal');
  });

  it('falls back to entering fullscreen when the runtime cannot report state', async () => {
    const { runtime, setWindowState } = buildRuntime({
      isFullscreen: () => { throw new Error('runtime unavailable'); },
      isMaximised: () => { throw new Error('runtime unavailable'); },
    });

    const next = await toggleWindowFullscreen(runtime);

    expect(next).toBe('fullscreen');
    expect(setWindowState).toHaveBeenCalledWith('fullscreen');
  });

  it('still records the restored state when exiting fullscreen throws', async () => {
    const { runtime, setWindowState } = buildRuntime({
      isFullscreen: () => true,
      exitFullscreen: () => { throw new Error('exit failed'); },
    });

    const next = await toggleWindowFullscreen(runtime);

    expect(next).toBe('normal');
    expect(setWindowState).toHaveBeenCalledWith('normal');
  });

  it('supports async runtime probes', async () => {
    const { runtime } = buildRuntime({
      isFullscreen: async () => true,
      isMaximised: async () => false,
    });

    await expect(toggleWindowFullscreen(runtime)).resolves.toBe('normal');
  });
});
