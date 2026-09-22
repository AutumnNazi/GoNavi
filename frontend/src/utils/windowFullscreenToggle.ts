import { safeWindowRuntimeCall } from './wailsRuntime';
import type { WindowVisualState } from './windowStateUi';

export interface WindowFullscreenRuntime {
  isFullscreen: () => boolean | Promise<boolean>;
  isMaximised: () => boolean | Promise<boolean>;
  enterFullscreen: () => void | Promise<void>;
  exitFullscreen: () => void | Promise<void>;
  setWindowState: (state: WindowVisualState) => void;
}

/**
 * 真正的「全屏」切换，与标题栏双击行为区分开。
 *
 * 不要复用 App 的 handleTitleBarWindowToggle：它在非全屏态走的是
 * 「最大化/还原」而非全屏（见 App.tsx 的 allowMacNativeFullscreen 分支），
 * 语义与「视图 > 全屏」不符。
 *
 * 退出全屏后窗口可能回到最大化而非普通态，因此按运行时实际上报
 * 回读一次状态（与 App 内 syncWindowStateFromRuntime 同口径）。
 *
 * @returns 切换后的窗口状态，供调用方复用。
 */
export const toggleWindowFullscreen = async (
  runtime: WindowFullscreenRuntime,
): Promise<WindowVisualState> => {
  const isFullscreen = await safeWindowRuntimeCall(runtime.isFullscreen, false);

  if (isFullscreen) {
    await safeWindowRuntimeCall(runtime.exitFullscreen, undefined);
    const isMaximised = await safeWindowRuntimeCall(runtime.isMaximised, false);
    const restored: WindowVisualState = isMaximised ? 'maximized' : 'normal';
    runtime.setWindowState(restored);
    return restored;
  }

  await safeWindowRuntimeCall(runtime.enterFullscreen, undefined);
  runtime.setWindowState('fullscreen');
  return 'fullscreen';
};
