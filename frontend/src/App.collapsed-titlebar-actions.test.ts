import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const v2ThemeCss = readFileSync(new URL('./v2-theme.css', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('./components/Sidebar.tsx', import.meta.url), 'utf8');

const readRule = (css: string, selector: string): string => {
  const start = css.indexOf(selector);
  const openingBrace = css.indexOf('{', start + selector.length);
  const closingBrace = css.indexOf('}', openingBrace + 1);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(openingBrace).toBeGreaterThan(start);
  expect(closingBrace).toBeGreaterThan(openingBrace);
  return css.slice(start, closingBrace + 1);
};

describe('collapsed V2 sidebar actions in the native mac titlebar', () => {
  it('reuses the complete six-action explorer toolbar in the unused lower titlebar band', () => {
    const start = appSource.indexOf('data-collapsed-sidebar-actions="true"');
    const end = appSource.indexOf('{/* Collapsed sidebar titlebar actions end */}', start);
    const actionsSource = appSource.slice(start, end);
    const sharedActionsStart = sidebarSource.indexOf('export const V2ExplorerToolbarActions');
    const sharedActionsEnd = sidebarSource.indexOf('\nconst Sidebar:', sharedActionsStart);
    const sharedActionsSource = sidebarSource.slice(sharedActionsStart, sharedActionsEnd);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(sharedActionsStart).toBeGreaterThanOrEqual(0);
    expect(sharedActionsEnd).toBeGreaterThan(sharedActionsStart);
    expect(appSource).toContain('isSidebarCollapsed && shouldDockCollapsedSidebarActionsInTitlebar');
    expect(appSource).toMatch(
      /const shouldDockCollapsedSidebarActionsInTitlebar = isV2Ui && \(\s*runtimePlatform === 'darwin'\s*\|\| \(runtimePlatform === '' && \/mac\/i\.test\(detectNavigatorPlatform\(\)\)\)\s*\);/s,
    );
    expect(appSource).toMatch(
      /resolveTitleBarLayout\(\s*effectiveUiScale,\s*isV2Ui,\s*isSidebarCollapsed && shouldDockCollapsedSidebarActionsInTitlebar,\s*\)/s,
    );
    expect(appSource).toContain("isSidebarCollapsed && shouldDockCollapsedSidebarActionsInTitlebar ? 'gn-v2-titlebar-collapsed-docked' : ''");
    expect(actionsSource).toContain('role="toolbar"');
    expect(actionsSource).toContain('data-no-titlebar-toggle="true"');
    expect(appSource).toContain('ref={setCollapsedSidebarActionsTarget}');
    expect(appSource).toContain('collapsedSidebarActionsTarget={collapsedSidebarActionsTarget}');
    expect(appSource).toContain('onExpandSidebar={isV2Ui ? handleExpandSidebarPanel : undefined}');
    expect(sidebarSource).toContain('collapsedSidebarActionsTarget && createPortal(');
    expect(sidebarSource).toContain("placement: 'collapsed-titlebar'");

    const actionMarkers = [
      'data-sidebar-locate-current-tab-action="true"',
      'data-sidebar-scroll-to-top-action="true"',
      'data-sidebar-active-connection-actions="true"',
      'data-gonavi-ai-entry-action="true"',
      'data-sidebar-settings-action="true"',
      'data-sidebar-toggle-placement={toggleAction.placement}',
    ];
    const markerIndexes = actionMarkers.map((marker) => sharedActionsSource.indexOf(marker));
    expect(markerIndexes.every((index) => index >= 0)).toBe(true);
    expect(markerIndexes).toEqual([...markerIndexes].sort((a, b) => a - b));
    expect(sharedActionsSource).toContain('disabled={!canLocateActiveTab}');
    expect(sharedActionsSource).toContain('disabled={!hasActiveConnection}');
    expect(sharedActionsSource).toContain('aria-haspopup="menu"');
  });

  it('removes the empty fixed rail only when its actions are hosted by the titlebar', () => {
    expect(appSource).toContain("data-sidebar-actions-placement={shouldDockCollapsedSidebarActionsInTitlebar ? 'titlebar' : 'fixed-rail'}");
    expect(appSource).toContain('isV2Ui && !shouldDockCollapsedSidebarActionsInTitlebar');
    expect(appSource).toContain('onExpandSidebar={isV2Ui ? handleExpandSidebarPanel : undefined}');
    expect(v2ThemeCss).toMatch(
      /\.ant-layout-sider\[data-sidebar-actions-placement='titlebar'\]\s+\.gn-v2-connection-rail\s*\{[^}]*display:\s*none;/s,
    );
  });

  it('waits for the portal-hosted expand action before restoring keyboard focus', () => {
    expect(appSource).toMatch(
      /target === 'collapsed'\s*&& isSidebarCollapsed\s*&& shouldDockCollapsedSidebarActionsInTitlebar\s*&& !collapsedSidebarActionsTarget/s,
    );
    expect(appSource).toContain('[collapsedSidebarActionsTarget, isSidebarCollapsed, shouldDockCollapsedSidebarActionsInTitlebar]');
  });

  it('uses the same theme-scaled button and icon geometry as the expanded explorer toolbar', () => {
    const toolbarRule = readRule(
      v2ThemeCss,
      'body[data-ui-version="v2"] .gn-v2-titlebar-native-mac .gn-v2-collapsed-sidebar-actions',
    );
    const toolRule = readRule(
      v2ThemeCss,
      'body[data-ui-version="v2"] .gn-v2-explorer-tool.ant-btn',
    );

    expect(toolbarRule).toContain('position: absolute;');
    expect(toolbarRule).toContain('bottom:');
    expect(toolbarRule).toContain('display: flex;');
    expect(toolbarRule).toContain('flex-wrap: nowrap;');
    expect(toolbarRule).toContain('-webkit-app-region: no-drag;');
    expect(toolbarRule).toContain('overflow-x: auto;');
    expect(toolbarRule).toContain('height: calc(26px * var(--gn-v2-explorer-scale));');
    expect(toolbarRule).toContain('--gn-v2-explorer-scale: var(--gn-ui-scale, 1);');
    expect(toolRule).toContain('flex: 0 0 calc(26px * var(--gn-v2-explorer-scale));');
    expect(toolRule).toContain('height: calc(26px * var(--gn-v2-explorer-scale)) !important;');
    expect(v2ThemeCss).toMatch(
      /\.gn-v2-explorer-tool\.ant-btn \.anticon\s*\{[^}]*font-size:\s*calc\(14px \* var\(--gn-v2-explorer-scale\)\);/s,
    );
    expect(v2ThemeCss).toMatch(
      /\.gn-v2-collapsed-sidebar-actions \.gn-v2-explorer-tool\.ant-btn:focus-visible,[^{]+\{[^}]*outline-offset:\s*-3px;/s,
    );
    expect(v2ThemeCss).not.toContain('.gn-v2-collapsed-titlebar-tool');
  });
});
