export type NativeDetachedLocationLike = Pick<Location, 'pathname' | 'search'>;

export type NativeDetachedWindowLike = {
  __GONAVI_NATIVE_DETACHED__?: unknown;
  __GONAVI_DETACHED__?: unknown;
};

export const NATIVE_DETACHED_WINDOW_QUERY_PARAM = '__gonavi_detached';

export const isNativeDetachedWindowRoute = (
  windowLike?: NativeDetachedWindowLike,
  locationLike?: NativeDetachedLocationLike,
): boolean => {
  const runtimeWindow = windowLike
    ?? (typeof window !== 'undefined' ? window as typeof window & NativeDetachedWindowLike : undefined);
  if (runtimeWindow?.__GONAVI_NATIVE_DETACHED__ || runtimeWindow?.__GONAVI_DETACHED__) {
    return true;
  }

  const locationValue = locationLike
    ?? (typeof window !== 'undefined' ? window.location : undefined);
  if (!locationValue) return false;
  if (locationValue.pathname.startsWith('/__gonavi/detached/window')) return true;

  const params = new URLSearchParams(locationValue.search);
  const value = params.get(NATIVE_DETACHED_WINDOW_QUERY_PARAM);
  return value !== null && value !== '' && value !== '0' && value !== 'false';
};
