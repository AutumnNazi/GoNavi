export type WindowRestoreBounds = {
  width: number;
  height: number;
  x: number;
  y: number;
  /** DPI used by Wails when the logical window size was captured. */
  dpi?: number;
};

type VisibleViewport = {
  availWidth: number;
  availHeight: number;
  availLeft?: number;
  availTop?: number;
};

const MIN_VISIBLE_WIDTH = 160;
const MIN_VISIBLE_HEIGHT = 120;
const MIN_RESTORED_WIDTH = 400;
const MIN_RESTORED_HEIGHT = 300;

const resolveVisibleDimension = (
  rawDimension: number,
  visibleDimension: number,
  minimumDimension: number,
): number => {
  const dimension = Math.trunc(Number(rawDimension) || 0);
  if (visibleDimension <= 0 || dimension <= 0) {
    return dimension;
  }
  const minimum = Math.min(minimumDimension, visibleDimension);
  return Math.min(Math.max(dimension, minimum), visibleDimension);
};

const clampPosition = (
  position: number,
  dimension: number,
  visibleStart: number,
  visibleDimension: number,
): number => {
  const maxPosition = visibleStart + Math.max(0, visibleDimension - dimension);
  return Math.min(Math.max(position, visibleStart), maxPosition);
};

export const resolveVisibleStartupWindowBounds = (
  bounds: WindowRestoreBounds,
  viewport: VisibleViewport,
): WindowRestoreBounds => {
  const visibleWidth = Math.trunc(Number(viewport.availWidth) || 0);
  const visibleHeight = Math.trunc(Number(viewport.availHeight) || 0);
  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return bounds;
  }

  const visibleLeft = Math.trunc(Number(viewport.availLeft) || 0);
  const visibleTop = Math.trunc(Number(viewport.availTop) || 0);
  const visibleRight = visibleLeft + visibleWidth;
  const visibleBottom = visibleTop + visibleHeight;
  const nextWidth = resolveVisibleDimension(bounds.width, visibleWidth, MIN_RESTORED_WIDTH);
  const nextHeight = resolveVisibleDimension(bounds.height, visibleHeight, MIN_RESTORED_HEIGHT);
  const resizedBounds: WindowRestoreBounds = {
    ...bounds,
    width: nextWidth,
    height: nextHeight,
  };

  const overlapWidth = Math.min(resizedBounds.x + resizedBounds.width, visibleRight) - Math.max(resizedBounds.x, visibleLeft);
  const overlapHeight = Math.min(resizedBounds.y + resizedBounds.height, visibleBottom) - Math.max(resizedBounds.y, visibleTop);
  const sizeChanged = resizedBounds.width !== bounds.width || resizedBounds.height !== bounds.height;
  if (
    !sizeChanged &&
    overlapWidth >= Math.min(MIN_VISIBLE_WIDTH, bounds.width) &&
    overlapHeight >= Math.min(MIN_VISIBLE_HEIGHT, bounds.height)
  ) {
    return bounds;
  }

  if (sizeChanged && overlapWidth > 0 && overlapHeight > 0) {
    return {
      ...resizedBounds,
      x: clampPosition(resizedBounds.x, resizedBounds.width, visibleLeft, visibleWidth),
      y: clampPosition(resizedBounds.y, resizedBounds.height, visibleTop, visibleHeight),
    };
  }

  return {
    ...resizedBounds,
    x: visibleLeft + Math.max(0, Math.trunc((visibleWidth - resizedBounds.width) / 2)),
    y: visibleTop + Math.max(0, Math.trunc((visibleHeight - resizedBounds.height) / 2)),
  };
};
