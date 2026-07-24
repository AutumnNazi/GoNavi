import {
  clamp,
  DEFAULT_DETACHED_WINDOW_HEIGHT,
  DEFAULT_DETACHED_WINDOW_MIN_HEIGHT,
  DEFAULT_DETACHED_WINDOW_MIN_WIDTH,
  DEFAULT_DETACHED_WINDOW_WIDTH,
  DETACHED_WINDOW_VIEWPORT_PADDING,
} from '../detachedWindow';
import { APP_DETACHED_WINDOW_Z_INDEX_BASE } from '../overlayZIndex';

const STORAGE_KEY = 'gonavi.resultDiff.detachedBounds.v1';

export type ResultDiffDetachedBoundsMemory = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

export const loadResultDiffDetachedBoundsMemory = (): ResultDiffDetachedBoundsMemory | null => {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResultDiffDetachedBoundsMemory>;
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return {
      width,
      height,
      x: Number.isFinite(x) ? x : DETACHED_WINDOW_VIEWPORT_PADDING,
      y: Number.isFinite(y) ? y : DETACHED_WINDOW_VIEWPORT_PADDING,
    };
  } catch {
    return null;
  }
};

export const saveResultDiffDetachedBoundsMemory = (
  bounds: Pick<ResultDiffDetachedBoundsMemory, 'x' | 'y' | 'width' | 'height'>,
): void => {
  if (!isBrowser()) return;
  try {
    const payload: ResultDiffDetachedBoundsMemory = {
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width: Number(bounds.width) || DEFAULT_DETACHED_WINDOW_WIDTH,
      height: Number(bounds.height) || DEFAULT_DETACHED_WINDOW_HEIGHT,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
};

/** 按当前视口校正记忆的位置与尺寸，避免移出屏幕 */
export const resolveResultDiffDetachedBounds = (
  memory?: ResultDiffDetachedBoundsMemory | null,
  zIndex = APP_DETACHED_WINDOW_Z_INDEX_BASE + 1,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
} => {
  const viewportW = isBrowser() ? window.innerWidth : 1280;
  const viewportH = isBrowser() ? window.innerHeight : 800;
  const maxW = Math.max(
    DEFAULT_DETACHED_WINDOW_MIN_WIDTH,
    viewportW - DETACHED_WINDOW_VIEWPORT_PADDING * 2,
  );
  const maxH = Math.max(
    DEFAULT_DETACHED_WINDOW_MIN_HEIGHT,
    viewportH - DETACHED_WINDOW_VIEWPORT_PADDING * 2,
  );

  const preferredW = memory?.width && memory.width > 0
    ? memory.width
    : Math.max(DEFAULT_DETACHED_WINDOW_WIDTH, 960);
  const preferredH = memory?.height && memory.height > 0
    ? memory.height
    : Math.max(DEFAULT_DETACHED_WINDOW_HEIGHT, 680);

  const width = clamp(preferredW, DEFAULT_DETACHED_WINDOW_MIN_WIDTH, maxW);
  const height = clamp(preferredH, DEFAULT_DETACHED_WINDOW_MIN_HEIGHT, maxH);

  const defaultX = Math.max(
    DETACHED_WINDOW_VIEWPORT_PADDING,
    Math.round((viewportW - width) / 2),
  );
  const defaultY = Math.max(
    DETACHED_WINDOW_VIEWPORT_PADDING,
    Math.round((viewportH - height) / 6),
  );

  const maxX = Math.max(DETACHED_WINDOW_VIEWPORT_PADDING, viewportW - width - DETACHED_WINDOW_VIEWPORT_PADDING);
  const maxY = Math.max(DETACHED_WINDOW_VIEWPORT_PADDING, viewportH - height - DETACHED_WINDOW_VIEWPORT_PADDING);

  const x = clamp(
    Number.isFinite(memory?.x) ? Number(memory?.x) : defaultX,
    DETACHED_WINDOW_VIEWPORT_PADDING,
    maxX,
  );
  const y = clamp(
    Number.isFinite(memory?.y) ? Number(memory?.y) : defaultY,
    DETACHED_WINDOW_VIEWPORT_PADDING,
    maxY,
  );

  return { x, y, width, height, zIndex };
};
