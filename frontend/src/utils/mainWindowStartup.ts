export const MAIN_WINDOW_FRONTEND_READY_EVENT = 'gonavi:frontend-ready';
export const MAIN_WINDOW_PAINT_FALLBACK_MS = 250;
/**
 * 窗口隐藏期间的首屏握手还要等启动窗口几何 settle。超时后照常显示，
 * 避免恢复流程异常时窗口一直不可见（原生侧另有 4s 兜底）。
 */
export const MAIN_WINDOW_GEOMETRY_SETTLE_TIMEOUT_MS = 3000;

let startupWindowGeometrySettled = false;
const startupWindowGeometryWaiters = new Set<() => void>();

/**
 * 标记启动窗口几何（普通 bounds 或最大化）已经落到最终状态。主窗口在隐藏期间
 * 完成几何切换后调用，避免用户看到“小窗 → 全屏”的两段式动画。
 */
export const markStartupWindowGeometrySettled = (): void => {
  if (startupWindowGeometrySettled) {
    return;
  }
  startupWindowGeometrySettled = true;
  const waiters = Array.from(startupWindowGeometryWaiters);
  startupWindowGeometryWaiters.clear();
  waiters.forEach((resolve) => resolve());
};

export const waitForStartupWindowGeometrySettled = (
  timeoutMs = MAIN_WINDOW_GEOMETRY_SETTLE_TIMEOUT_MS,
): Promise<void> => {
  if (startupWindowGeometrySettled) {
    return Promise.resolve();
  }
  // 非浏览器环境（单测、SSR）没有可靠的 window.setTimeout，直接放行。
  if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      startupWindowGeometryWaiters.delete(finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, Math.max(0, Math.trunc(Number(timeoutMs) || 0)));
    startupWindowGeometryWaiters.add(finish);
  });
};

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
