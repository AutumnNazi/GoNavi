export const DEFAULT_SIDEBAR_WIDTH = 330;
export const SIDEBAR_RESIZE_MIN_WIDTH = 200;
export const SIDEBAR_SIDER_MIN_WIDTH = 232;
export const SIDEBAR_RESIZE_MAX_WIDTH = 960;
export const SIDEBAR_MIN_WORKBENCH_WIDTH = 360;
export const SIDEBAR_RESIZE_INNER_HIT_CSS_VARIABLE = '--gonavi-sidebar-resize-inner-hit-width';

export const resolveSidebarResizeHitGeometry = (handleWidth: number) => {
  const innerHitWidth = handleWidth / 2;
  return {
    cssVariable: SIDEBAR_RESIZE_INNER_HIT_CSS_VARIABLE,
    innerHitWidth,
    handleOffset: -innerHitWidth,
    handleWidth,
  };
};

export const resolveSidebarResizeMaxWidth = (
  viewportWidth: unknown,
  minWidth = SIDEBAR_RESIZE_MIN_WIDTH,
): number => {
  const parsedViewportWidth = Number(viewportWidth);
  if (!Number.isFinite(parsedViewportWidth) || parsedViewportWidth <= 0) {
    return SIDEBAR_RESIZE_MAX_WIDTH;
  }

  const viewportLimitedWidth = Math.trunc(parsedViewportWidth) - SIDEBAR_MIN_WORKBENCH_WIDTH;
  return Math.max(minWidth, Math.min(SIDEBAR_RESIZE_MAX_WIDTH, viewportLimitedWidth));
};

export const sanitizeSidebarWidth = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(
    SIDEBAR_RESIZE_MIN_WIDTH,
    Math.min(SIDEBAR_RESIZE_MAX_WIDTH, Math.trunc(parsed)),
  );
};
