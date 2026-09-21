export type WebRPCDispatchState = 'not_started' | 'possibly_dispatched';

export type WebRPCAbortError = Error & {
  name: 'AbortError';
  code: 'WEB_RPC_ABORTED';
  dispatchState: WebRPCDispatchState;
};

export type WebRPCRequestOptions = {
  signal?: AbortSignal;
};

type GoNaviWebRPCBridge = {
  invokeWithOptions?: <T>(
    namespace: string,
    receiver: string,
    method: string,
    args: unknown[],
    options: WebRPCRequestOptions,
  ) => Promise<T>;
};

const webRPCBridge = (): GoNaviWebRPCBridge | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __GONAVI_WEB_RPC__?: GoNaviWebRPCBridge })
    .__GONAVI_WEB_RPC__;
};

/**
 * 按方法名动态调用 App 绑定（仅 Web 桥存在时可用；桌面端返回 undefined，
 * 调用方回退到 window.go 动态对象或生成的绑定）。用于新增方法尚无生成绑定的场景。
 */
export const invokeAppMethodDynamic = <T>(
  method: string,
  args: unknown[],
): Promise<T> | undefined => {
  const invokeWithOptions = webRPCBridge()?.invokeWithOptions;
  if (typeof invokeWithOptions === 'function') {
    return invokeWithOptions<T>('app', 'App', method, args, {});
  }
  return undefined;
};

/**
 * Uses request cancellation only when the browser Web RPC bridge is present.
 * The Wails fallback always waits for the generated binding's real result;
 * aborting the signal never creates a client-side "fake cancellation" there.
 */
export const invokeAppWithSignal = <T>(
  method: string,
  args: unknown[],
  signal: AbortSignal | undefined,
  wailsFallback: () => Promise<T>,
): Promise<T> => {
  const invokeWithOptions = webRPCBridge()?.invokeWithOptions;
  if (signal && typeof invokeWithOptions === 'function') {
    return invokeWithOptions<T>('app', 'App', method, args, { signal });
  }
  return wailsFallback();
};

export const isWebRPCAbortError = (error: unknown): error is WebRPCAbortError =>
  Boolean(
    error
      && typeof error === 'object'
      && (error as { code?: unknown }).code === 'WEB_RPC_ABORTED',
  );
