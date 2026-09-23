import { resolveVisibleStartupWindowBounds, type WindowRestoreBounds } from './windowRestoreBounds';
import { resolveWailsWindowSetPosition, type WailsWindowVisibleViewport } from './wailsWindowViewport';

export type WindowDisplayWorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Windows physical-pixel work areas use this effective monitor DPI. */
  dpi?: number;
  primary?: boolean;
  current?: boolean;
};

export type MainWindowDisplayLayout = {
  displays: WindowDisplayWorkArea[];
  positionIsGlobal: boolean;
  /** Windows GetPosition is global, but Wails SetPosition is current-monitor-local. */
  setPositionIsLocal?: boolean;
};

type DisplayLayoutPayload = {
  displays?: unknown;
  positionIsGlobal?: unknown;
  setPositionIsLocal?: unknown;
};

const toFiniteInteger = (value: unknown, fallback = 0): number => {
  const next = Math.trunc(Number(value));
  return Number.isFinite(next) ? next : fallback;
};

const normalizeDisplay = (value: unknown): WindowDisplayWorkArea | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const area: WindowDisplayWorkArea = {
    x: toFiniteInteger(raw.x),
    y: toFiniteInteger(raw.y),
    width: toFiniteInteger(raw.width),
    height: toFiniteInteger(raw.height),
  };
  if (area.width <= 0 || area.height <= 0) {
    return null;
  }
  if (Number.isFinite(raw.dpi) && Number(raw.dpi) > 0) area.dpi = toFiniteInteger(raw.dpi);
  if (raw.primary === true) area.primary = true;
  if (raw.current === true) area.current = true;
  return area;
};

export const normalizeMainWindowDisplayLayout = (
  payload: unknown,
): MainWindowDisplayLayout | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as DisplayLayoutPayload;
  if (!Array.isArray(raw.displays)) {
    return null;
  }
  const displays = raw.displays
    .map((entry) => normalizeDisplay(entry))
    .filter((entry): entry is WindowDisplayWorkArea => entry !== null);
  return {
    displays,
    positionIsGlobal: raw.positionIsGlobal === true,
    ...(raw.setPositionIsLocal === true ? { setPositionIsLocal: true } : {}),
  };
};

/**
 * 是否具备按显示器恢复的能力。没有显示器列表（浏览器 mock、Web 模式、
 * 不支持枚举的平台）时返回 null，调用方保持原有按当前屏恢复的行为。
 */
export const resolveDisplayAwareLayout = (
  layout: MainWindowDisplayLayout | null | undefined,
): MainWindowDisplayLayout | null => (
  layout && layout.displays.length > 0 ? layout : null
);

export const resolveCurrentWindowDisplay = (
  layout: MainWindowDisplayLayout,
): WindowDisplayWorkArea | null => (
  layout.displays.find((display) => display.current === true) ?? null
);

const intersectArea = (left: WindowRestoreBounds, right: WindowDisplayWorkArea): number => {
  const physical = toPhysicalWindowBounds(left, right);
  const overlapWidth = Math.min(physical.x + physical.width, right.x + right.width) - Math.max(physical.x, right.x);
  const overlapHeight = Math.min(physical.y + physical.height, right.y + right.height) - Math.max(physical.y, right.y);
  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }
  return overlapWidth * overlapHeight;
};

const distanceSquared = (bounds: WindowRestoreBounds, display: WindowDisplayWorkArea): number => {
  const physical = toPhysicalWindowBounds(bounds, display);
  const gapX = physical.x + physical.width < display.x
    ? display.x - (physical.x + physical.width)
    : (display.x + display.width < physical.x ? physical.x - (display.x + display.width) : 0);
  const gapY = physical.y + physical.height < display.y
    ? display.y - (physical.y + physical.height)
    : (display.y + display.height < physical.y ? physical.y - (display.y + display.height) : 0);
  return gapX * gapX + gapY * gapY;
};

const toPhysicalWindowBounds = (bounds: WindowRestoreBounds, display: WindowDisplayWorkArea): WindowRestoreBounds => {
  const scale = (display.dpi || 96) / 96;
  return { ...bounds, width: Math.trunc(bounds.width * scale), height: Math.trunc(bounds.height * scale) };
};

const clampWindowToDisplay = (bounds: WindowRestoreBounds, display: WindowDisplayWorkArea): WindowRestoreBounds => {
  const physical = resolveVisibleStartupWindowBounds(toPhysicalWindowBounds(bounds, display), {
    availWidth: display.width,
    availHeight: display.height,
    availLeft: display.x,
    availTop: display.y,
  });
  const originalPhysical = toPhysicalWindowBounds(bounds, display);
  if (physical.width === originalPhysical.width && physical.height === originalPhysical.height) {
    return { ...bounds, x: physical.x, y: physical.y };
  }
  const dpi = display.dpi || 96;
  return {
    ...physical,
    width: Math.trunc(physical.width * 96 / dpi),
    height: Math.trunc(physical.height * 96 / dpi),
  };
};

/**
 * 选出记忆位置应该落回的显示器：优先重叠面积最大的那块；
 * 完全不在任何显示器内（例如副屏被拔掉）时退回几何距离最近的一块。
 */
export const resolvePlacementDisplay = (
  bounds: WindowRestoreBounds,
  layout: MainWindowDisplayLayout | null | undefined,
): WindowDisplayWorkArea | null => {
  const awareLayout = resolveDisplayAwareLayout(layout);
  if (!awareLayout) {
    return null;
  }

  let target: WindowDisplayWorkArea | null = null;
  let bestArea = 0;
  for (const display of awareLayout.displays) {
    const area = intersectArea(bounds, display);
    if (area > bestArea) {
      bestArea = area;
      target = display;
    }
  }
  if (target) {
    return target;
  }

  let closestDistance = Number.POSITIVE_INFINITY;
  for (const display of awareLayout.displays) {
    const distance = distanceSquared(bounds, display);
    if (distance < closestDistance) {
      closestDistance = distance;
      target = display;
    }
  }
  return target;
};

/**
 * 把记忆的窗口位置裁剪进目标显示器工作区。目标屏已拔掉时按最近屏居中，
 * 尺寸超出目标屏时同步收缩，避免窗口被裁切。
 */
export const resolveVisibleGlobalWindowBounds = (
  bounds: WindowRestoreBounds,
  layout: MainWindowDisplayLayout | null | undefined,
): WindowRestoreBounds | null => {
  const display = resolvePlacementDisplay(bounds, layout);
  if (!display) {
    return null;
  }
  return clampWindowToDisplay(bounds, display);
};

/** Preserve the last normal size while anchoring maximised startup to its current display. */
export const resolveMaximisedWindowRestoreBounds = (
  bounds: WindowRestoreBounds | null,
  layout: MainWindowDisplayLayout | null,
): WindowRestoreBounds | null => {
  const display = layout && resolveCurrentWindowDisplay(layout);
  if (!bounds || !display || bounds.width < 400 || bounds.height < 300
    || resolvePlacementDisplay(bounds, layout) === display) return null;
  const repositioned = {
    ...bounds,
    x: display.x + Math.max(0, Math.trunc((display.width - toPhysicalWindowBounds(bounds, display).width) / 2)),
    y: display.y + Math.max(0, Math.trunc((display.height - toPhysicalWindowBounds(bounds, display).height) / 2)),
  };
  return clampWindowToDisplay(repositioned, display);
};

/**
 * 把平台返回的窗口位置换算成全局左上原点坐标。
 *
 * macOS 的 WindowGetPosition 是“当前显示器可见区”内的局部坐标，不含显示器身份；
 * 必须加上当前屏工作区原点，窗口才能在换屏重启后回到原显示器。
 * Windows/Linux 已经是全局坐标，无需换算。
 */
export const resolveGlobalWindowBounds = (
  bounds: WindowRestoreBounds,
  layout: MainWindowDisplayLayout | null | undefined,
): WindowRestoreBounds | null => {
  const awareLayout = resolveDisplayAwareLayout(layout);
  if (!awareLayout) {
    return null;
  }
  if (awareLayout.positionIsGlobal) {
    return bounds;
  }

  const current = resolveCurrentWindowDisplay(awareLayout);
  if (!current) {
    return null;
  }
  return {
    ...bounds,
    x: bounds.x + current.x,
    y: bounds.y + current.y,
  };
};

/**
 * 把全局坐标换算成 WindowSetPosition 需要的入参。
 * macOS 和 Windows 的 SetPosition 都接收当前工作区内的局部坐标，
 * 但 Windows 的 GetPosition 已经是全局坐标。
 */
export const resolveWailsWindowPosition = (
  bounds: WindowRestoreBounds,
  layout: MainWindowDisplayLayout | null | undefined,
): { x: number; y: number } | null => {
  const awareLayout = resolveDisplayAwareLayout(layout);
  if (!awareLayout) {
    return null;
  }
  if (awareLayout.positionIsGlobal && !awareLayout.setPositionIsLocal) {
    return { x: bounds.x, y: bounds.y };
  }

  const current = resolveCurrentWindowDisplay(awareLayout);
  if (!current) {
    return null;
  }
  return {
    x: bounds.x - current.x,
    y: bounds.y - current.y,
  };
};

/** Resolve the same display-aware bounds for runtime correction and persistence. */
export const resolveRuntimeWindowPlacement = (
  bounds: WindowRestoreBounds,
  layout: MainWindowDisplayLayout | null,
  viewport: WailsWindowVisibleViewport,
  isWindows: boolean,
  inputIsGlobal = false,
): { bounds: WindowRestoreBounds; position: { x: number; y: number }; persistedBounds: WindowRestoreBounds } | null => {
  const aware = resolveDisplayAwareLayout(layout);
  const globalBounds = aware && !aware.positionIsGlobal && !inputIsGlobal
    ? resolveGlobalWindowBounds(bounds, aware) ?? bounds
    : bounds;
  const nextBounds = aware
    ? resolveVisibleGlobalWindowBounds(globalBounds, aware)
    : resolveVisibleStartupWindowBounds(bounds, viewport);
  if (!nextBounds) return null;
  const position = aware
    ? resolveWailsWindowPosition(nextBounds, aware)
    : resolveWailsWindowSetPosition(nextBounds, viewport, { useMonitorLocalOrigin: isWindows });
  if (!position) return null;
  return {
    bounds: nextBounds,
    position,
    persistedBounds: nextBounds,
  };
};

/** On Windows, move first so Wails sizes the window using its destination monitor DPI. */
export const applyRuntimeWindowPlacement = (
  placement: { bounds: WindowRestoreBounds; position: { x: number; y: number } },
  isWindows: boolean,
  setSize: (width: number, height: number) => void,
  setPosition: (x: number, y: number) => void,
): void => {
  const move = () => setPosition(placement.position.x, placement.position.y);
  const resize = () => setSize(placement.bounds.width, placement.bounds.height);
  if (isWindows) {
    move();
    resize();
  } else {
    resize();
    move();
  }
};

type MainWindowPlacementRuntime = {
  go?: {
    app?: {
      App?: {
        GetMainWindowDisplayLayout?: () => Promise<{ success?: boolean; data?: unknown } | null | undefined>;
      };
    };
  };
};

/**
 * 读取主窗口显示器布局。浏览器 mock、Web 模式或不支持的平台返回 null，
 * 调用方回退到按当前屏处理。
 */
export const loadMainWindowDisplayLayout = async (): Promise<MainWindowDisplayLayout | null> => {
  if (typeof window === 'undefined') {
    return null;
  }
  const call = ((window as MainWindowPlacementRuntime).go?.app?.App?.GetMainWindowDisplayLayout);
  if (typeof call !== 'function') {
    return null;
  }
  try {
    const result = await call();
    if (!result?.success) {
      return null;
    }
    return normalizeMainWindowDisplayLayout(result.data);
  } catch {
    return null;
  }
};
