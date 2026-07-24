export type WindowVisualState = 'normal' | 'maximized' | 'fullscreen';
export type WindowScaleFixReason = 'activation' | 'ratio-change' | 'restore' | 'startup';
export type WindowsScaleCheckTrigger = 'focus' | 'pageshow' | 'poll' | 'resize' | 'visibilitychange';
export type TitleBarToggleIconKey = 'maximize' | 'restore';

// resize/focus/pageshow/visibility 生命周期事件承担实时同步；轮询只作为 Wails
// 未上报“仅移动窗口”等边缘场景的低频容错，避免空闲窗口持续跨 JS/Go 边界。
export const WINDOW_STATE_FALLBACK_INTERVAL_MS = 15_000;
export const WINDOWS_SCALE_FALLBACK_INTERVAL_MS = 10_000;

type NativeWindowActivityEventHandler = () => void;

export interface NativeWindowActivitySchedulerHandlers {
  resize?: NativeWindowActivityEventHandler;
  focus?: NativeWindowActivityEventHandler;
  blur?: NativeWindowActivityEventHandler;
  pageshow?: NativeWindowActivityEventHandler;
  pagehide?: NativeWindowActivityEventHandler;
  beforeunload?: NativeWindowActivityEventHandler;
  visibilitychange?: NativeWindowActivityEventHandler;
}

export interface NativeWindowActivitySchedulerOptions {
  windowTarget: Window;
  documentTarget: Document;
  fallbackIntervalMs: number;
  onFallback: NativeWindowActivityEventHandler;
  handlers: NativeWindowActivitySchedulerHandlers;
}

export const installNativeWindowActivityScheduler = ({
  windowTarget,
  documentTarget,
  fallbackIntervalMs,
  onFallback,
  handlers,
}: NativeWindowActivitySchedulerOptions): (() => void) => {
  const windowListeners: Array<{
    type: keyof Pick<WindowEventMap, 'resize' | 'focus' | 'blur' | 'pageshow' | 'pagehide' | 'beforeunload'>;
    listener: EventListener;
    capture: boolean;
  }> = [];

  const addWindowListener = (
    type: keyof Pick<WindowEventMap, 'resize' | 'focus' | 'blur' | 'pageshow' | 'pagehide' | 'beforeunload'>,
    handler: NativeWindowActivityEventHandler | undefined,
    capture = false,
  ) => {
    if (!handler) return;
    const listener: EventListener = () => handler();
    windowTarget.addEventListener(type, listener, capture);
    windowListeners.push({ type, listener, capture });
  };

  addWindowListener('resize', handlers.resize);
  addWindowListener('focus', handlers.focus);
  addWindowListener('blur', handlers.blur);
  addWindowListener('pageshow', handlers.pageshow);
  addWindowListener('pagehide', handlers.pagehide, true);
  addWindowListener('beforeunload', handlers.beforeunload, true);

  let fallbackTimer: number | null = null;
  const stopFallback = () => {
    if (fallbackTimer === null) return;
    windowTarget.clearInterval(fallbackTimer);
    fallbackTimer = null;
  };
  const startFallback = () => {
    if (fallbackTimer !== null || documentTarget.visibilityState !== 'visible') return;
    fallbackTimer = windowTarget.setInterval(() => {
      if (documentTarget.visibilityState === 'visible') {
        onFallback();
      }
    }, fallbackIntervalMs);
  };
  const visibilityListener: EventListener = () => {
    if (documentTarget.visibilityState === 'visible') {
      startFallback();
    } else {
      stopFallback();
    }
    handlers.visibilitychange?.();
  };
  documentTarget.addEventListener('visibilitychange', visibilityListener);
  startFallback();

  return () => {
    stopFallback();
    for (const { type, listener, capture } of windowListeners) {
      windowTarget.removeEventListener(type, listener, capture);
    }
    documentTarget.removeEventListener('visibilitychange', visibilityListener);
  };
};

export const shouldApplyWindowsScaleFix = (
  reason: WindowScaleFixReason,
  hasViewportScaleDrift: boolean,
): boolean => (
  reason === 'restore'
  || reason === 'startup'
  || (reason === 'ratio-change' && hasViewportScaleDrift)
);

// 关于 restore/startup 场景为何刻意不走 toggle（见 9848b8b2）：
// maximised 窗口在 Windows 上无法通过 SetSize nudge 修复 viewport drift（OS 拒绝 resize），
// 唯一能让 WebView2 重新计算缩放的办法是 Unmaximise → Maximise，但在任务栏图标点击恢复的
// 真实场景下，用户会肉眼看到窗口"被弹两次"的重复最大化动画——比偶发字体变大更糟。
// 取舍：restore/startup 时普通窗口走 1px SetSize nudge 迫使 WebView2/DWM 重新分配 backing surface；
// maximised 窗口只做 WebView2 zoom reset + resize，避免可见的重复最大化抖动。
// ratio-change（DPR 变化，例如把窗口拖到另一块显示器）则允许 toggle，因为那种场景下用户预期会有视觉过渡。
//
// startup 与 restore 同等对待：Windows 冷启动时 WebView2 首次布局经常只渲染左上角一部分，
// 过去只能靠用户双击任务栏触发 restore 路径才恢复正常；冷启动应主动走同一套轻量重绘。
export const shouldToggleMaximisedWindowForScaleFix = (
  reason: WindowScaleFixReason,
  hasViewportScaleDrift: boolean,
): boolean => reason === 'ratio-change' && hasViewportScaleDrift;

export const shouldResetWebViewZoomForScaleFix = (
  reason: WindowScaleFixReason,
  _hasViewportScaleDrift: boolean,
): boolean => reason === 'restore' || reason === 'startup';

export const resolveWindowsScaleCheckDelayMs = (trigger: WindowsScaleCheckTrigger): number =>
  trigger === 'resize' ? 240 : 0;

export const resolveTitleBarToggleIconKey = (windowState: WindowVisualState): TitleBarToggleIconKey =>
  windowState === 'maximized' ? 'restore' : 'maximize';
