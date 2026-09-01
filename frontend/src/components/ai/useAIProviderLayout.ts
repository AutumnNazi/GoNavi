import React from 'react';

const STORAGE_KEY = 'gonavi.ai.providers.layout.v1';
const DEFAULT_WIDTH = 336;
// Two-column geometry. Compact catalog rows (icon + label + CLI check) no longer
// need a 216px floor; the catalog may never squeeze the editor below MIN_EDITOR_WIDTH,
// and the drawer breakpoint is derived from that same budget instead of a standalone
// guess, so a workspace that can still seat both columns never falls into drawer mode.
export const MIN_CATALOG_WIDTH = 168;
export const MAX_CATALOG_WIDTH = 520;
export const MIN_EDITOR_WIDTH = 200;
// Keep in sync with `.gonavi-ai-provider-resizer { flex: 0 0 17px }`.
export const RESIZER_WIDTH = 17;
export const NARROW_BREAKPOINT = MIN_CATALOG_WIDTH + RESIZER_WIDTH + MIN_EDITOR_WIDTH;
export const isNarrowWorkspace = (width: number) => width > 0 && width < NARROW_BREAKPOINT;
export const maxCatalogWidth = (width: number) => Math.max(MIN_CATALOG_WIDTH,
  Math.min(MAX_CATALOG_WIDTH, width ? width - MIN_EDITOR_WIDTH - RESIZER_WIDTH : MAX_CATALOG_WIDTH));
export const workspaceClassName = (narrow: boolean, catalogVisible: boolean, dragging: boolean) =>
  `gonavi-ai-provider-workspace${narrow ? ' is-narrow' : ''}${narrow && catalogVisible ? ' is-drawer-open' : ''}${dragging ? ' is-resizing' : ''}`;
interface LayoutPreferences {
  catalogCollapsed: boolean;
  catalogWidth: number;
  savedCollapsed: boolean;
  density: 'compact' | 'normal';
  hiddenPresetKeys: string[];
}
const defaults: LayoutPreferences = { catalogCollapsed: false, catalogWidth: DEFAULT_WIDTH, savedCollapsed: false, density: 'compact', hiddenPresetKeys: [] };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readPreferences(): LayoutPreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return { catalogCollapsed: value.catalogCollapsed === true, savedCollapsed: value.savedCollapsed === true,
      density: value.density === 'normal' ? 'normal' : 'compact',
      hiddenPresetKeys: Array.isArray(value.hiddenPresetKeys)
        ? [...new Set<string>(value.hiddenPresetKeys.filter((key: unknown): key is string => typeof key === 'string' && Boolean(key.trim())).map((key: string) => key.trim()))] : [],
      catalogWidth: Number.isFinite(value.catalogWidth) ? clamp(value.catalogWidth, MIN_CATALOG_WIDTH, MAX_CATALOG_WIDTH) : DEFAULT_WIDTH };
  } catch { return { ...defaults }; }
}

// Persist layout preferences only. Provider drafts, credentials and model state
// continue through the existing application configuration service.
export function useAIProviderLayout() {
  const [preferences, setPreferences] = React.useState(readPreferences);
  const [width, setWidth] = React.useState(0);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ x: number; width: number; preference: number } | null>(null);
  const narrow = isNarrowWorkspace(width);
  const maximum = maxCatalogWidth(width);
  const catalogWidth = clamp(preferences.catalogWidth, MIN_CATALOG_WIDTH, maximum);
  React.useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Private storage may be unavailable. */ }
  }, [preferences]);
  React.useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(workspace.getBoundingClientRect().width));
    setWidth(workspace.getBoundingClientRect().width);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => { setDrawerOpen(false); drag.current = null; setDragging(false); }, [narrow]);
  const setPreference = <K extends keyof LayoutPreferences>(key: K, value: LayoutPreferences[K]) =>
    setPreferences((previous) => ({ ...previous, [key]: value }));
  const setPresetHidden = (key: string, hidden: boolean) => setPreferences((previous) => ({
    ...previous,
    hiddenPresetKeys: hidden ? [...new Set([...previous.hiddenPresetKeys, key])]
      : previous.hiddenPresetKeys.filter((presetKey) => presetKey !== key),
  }));
  const finishDrag = (cancel: boolean) => {
    if (cancel && drag.current) setPreference('catalogWidth', drag.current.preference);
    drag.current = null; setDragging(false);
  };
  const resizerProps = {
    role: 'separator', tabIndex: 0, 'aria-orientation': 'vertical' as const,
    'aria-valuemin': MIN_CATALOG_WIDTH, 'aria-valuemax': maximum, 'aria-valuenow': Math.round(catalogWidth),
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || narrow) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width: catalogWidth, preference: preferences.catalogWidth }; setDragging(true);
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (drag.current) setPreference('catalogWidth', clamp(drag.current.width + event.clientX - drag.current.x, MIN_CATALOG_WIDTH, maximum));
    },
    onPointerUp: () => finishDrag(false),
    onPointerCancel: () => finishDrag(true),
    onLostPointerCapture: () => finishDrag(false),
    onDoubleClick: () => setPreference('catalogWidth', DEFAULT_WIDTH),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finishDrag(true); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? MIN_CATALOG_WIDTH : event.key === 'End' ? maximum : event.key === 'Enter' ? DEFAULT_WIDTH
        : catalogWidth + (event.key === 'ArrowRight' ? 16 : -16);
      setPreference('catalogWidth', clamp(next, MIN_CATALOG_WIDTH, maximum));
    },
  };
  return { preferences, setPreference, setPresetHidden, workspaceRef, catalogWidth, narrow, dragging, resizerProps,
    catalogVisible: narrow ? drawerOpen : !preferences.catalogCollapsed,
    toggleCatalog: () => narrow ? setDrawerOpen((open) => !open) : setPreference('catalogCollapsed', !preferences.catalogCollapsed),
    closeDrawer: () => setDrawerOpen(false) };
}
