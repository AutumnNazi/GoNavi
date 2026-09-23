/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type StartupModule = typeof import('./mainWindowStartup');

const loadModule = async (): Promise<StartupModule> => {
  vi.resetModules();
  return import('./mainWindowStartup');
};

describe('startup window geometry settle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('releases the first-paint handshake once startup geometry settles', async () => {
    const startup = await loadModule();
    const settled = vi.fn();
    const pending = startup.waitForStartupWindowGeometrySettled(10_000).then(settled);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    startup.markStartupWindowGeometrySettled();
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately when geometry settled before anyone waited', async () => {
    const startup = await loadModule();
    startup.markStartupWindowGeometrySettled();

    await expect(startup.waitForStartupWindowGeometrySettled(10_000)).resolves.toBeUndefined();
  });

  it('stops waiting after the timeout so the window cannot stay hidden forever', async () => {
    vi.useFakeTimers();
    try {
      const startup = await loadModule();
      const settled = vi.fn();
      const pending = startup.waitForStartupWindowGeometrySettled(250).then(settled);

      await vi.advanceTimersByTimeAsync(250);
      await pending;
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signals the frontend-ready handshake only after the emitted event and show call', async () => {
    const startup = await loadModule();
    const eventsEmit = vi.fn();
    const windowShow = vi.fn();

    startup.signalMainWindowFrontendReady({ EventsEmit: eventsEmit, WindowShow: windowShow });

    expect(eventsEmit).toHaveBeenCalledWith(startup.MAIN_WINDOW_FRONTEND_READY_EVENT);
    expect(windowShow).toHaveBeenCalledTimes(1);
  });
});
