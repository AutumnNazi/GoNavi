export const MAIN_WINDOW_FRONTEND_READY_EVENT = 'gonavi:frontend-ready';
export const MAIN_WINDOW_PAINT_FALLBACK_MS = 250;

type MainWindowRuntime = {
  EventsEmit?: (eventName: string, ...args: unknown[]) => void;
  WindowShow?: () => void;
};

const readRuntime = (): MainWindowRuntime | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as typeof window & { runtime?: MainWindowRuntime }).runtime;
};

export const waitForMainWindowContentPaint = (
  requestFrame: ((callback: FrameRequestCallback) => number) | undefined = typeof window === 'undefined' ? undefined : window.requestAnimationFrame?.bind(window),
  delay: (callback: () => void, ms: number) => unknown = (callback, ms) => {
    if (typeof window === 'undefined') {
      callback();
      return;
    }
    window.setTimeout(callback, ms);
  },
  fallbackMs = MAIN_WINDOW_PAINT_FALLBACK_MS,
): Promise<void> => {
  if (typeof requestFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    delay(finish, fallbackMs);
    requestFrame(() => {
      requestFrame(finish);
    });
  });
};

export const signalMainWindowFrontendReady = (runtime: MainWindowRuntime | undefined = readRuntime()): void => {
  try {
    runtime?.EventsEmit?.(MAIN_WINDOW_FRONTEND_READY_EVENT);
  } catch {
    // Browser mocks and web-server mode omit the Wails event bus.
  }
  try {
    runtime?.WindowShow?.();
  } catch {
    // Showing twice is idempotent; missing runtime is expected in tests.
  }
};
