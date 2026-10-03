export const SIDEBAR_TREE_PANEL_FROZEN_ATTRIBUTE = 'data-sidebar-tree-panel-frozen';
export const SIDEBAR_TREE_PANEL_FROZEN_WIDTH_VARIABLE = '--gonavi-sidebar-tree-panel-frozen-width';
export const SIDEBAR_TREE_PANEL_FROZEN_HEIGHT_VARIABLE = '--gonavi-sidebar-tree-panel-frozen-height';

const SIDEBAR_TREE_PANEL_SELECTOR = '[data-sidebar-tree-panel="true"]';

type TreePanelSize = { width: number; height: number };

export type SidebarTreePanelFreeze = {
  observe: (sider: Element | null) => void;
  freeze: () => void;
  release: () => void;
  dispose: () => void;
};

/**
 * Pins the explorer to its last expanded size while the sider collapses,
 * stays collapsed and expands again, so the virtual tree, its resize
 * observers and the explorer container query have nothing to recompute.
 */
export const createSidebarTreePanelFreeze = (): SidebarTreePanelFreeze => {
  let panel: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let expandedSize: TreePanelSize | null = null;

  const isFrozen = () => panel?.getAttribute(SIDEBAR_TREE_PANEL_FROZEN_ATTRIBUTE) === 'true';

  const disconnect = () => {
    observer?.disconnect();
    observer = null;
  };

  const observe = (sider: Element | null) => {
    const nextPanel = (sider?.querySelector?.(SIDEBAR_TREE_PANEL_SELECTOR) as HTMLElement | null) ?? null;
    if (nextPanel === panel) return;
    disconnect();
    panel = nextPanel;
    expandedSize = null;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver((entries) => {
      if (isFrozen()) return;
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      expandedSize = { width: rect.width, height: rect.height };
    });
    observer.observe(panel);
  };

  const freeze = () => {
    if (!panel || !expandedSize || isFrozen()) return;
    panel.style.setProperty(SIDEBAR_TREE_PANEL_FROZEN_WIDTH_VARIABLE, `${expandedSize.width}px`);
    panel.style.setProperty(SIDEBAR_TREE_PANEL_FROZEN_HEIGHT_VARIABLE, `${expandedSize.height}px`);
    panel.setAttribute(SIDEBAR_TREE_PANEL_FROZEN_ATTRIBUTE, 'true');
  };

  const release = () => {
    if (!panel) return;
    panel.removeAttribute(SIDEBAR_TREE_PANEL_FROZEN_ATTRIBUTE);
    panel.style.removeProperty(SIDEBAR_TREE_PANEL_FROZEN_WIDTH_VARIABLE);
    panel.style.removeProperty(SIDEBAR_TREE_PANEL_FROZEN_HEIGHT_VARIABLE);
  };

  const dispose = () => {
    release();
    disconnect();
    panel = null;
    expandedSize = null;
  };

  return { observe, freeze, release, dispose };
};
