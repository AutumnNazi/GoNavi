import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const appCssSource = readFileSync(new URL('./App.css', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('./components/Sidebar.tsx', import.meta.url), 'utf8');
const connectionRailSource = readFileSync(new URL('./components/sidebar/SidebarConnectionRail.tsx', import.meta.url), 'utf8');

describe('app sidebar tree panel collapse', () => {
  it('collapses v2 to the scaled fixed rail while preserving the saved expanded width', () => {
    expect(appSource).toContain('const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);');
    expect(appSource).toContain('const sidebarCollapsedWidth = isV2Ui ? 38 * effectiveUiScale * effectiveSidebarRailScale : 0;');
    expect(appSource).toContain('const renderedSidebarWidth = isSidebarCollapsed ? sidebarCollapsedWidth : sidebarWidth;');
    expect(appSource).toContain('width={sidebarWidth}');
    expect(appSource).toContain('collapsed={isSidebarCollapsed}');
    expect(appSource).toContain('collapsedWidth={sidebarCollapsedWidth}');
    expect(appSource).toContain("['--gonavi-sidebar-collapsed-width' as any]: `${sidebarCollapsedWidth}px`");
    expect(appSource).toContain('trigger={null}');
    expect(appSource).not.toContain('setSidebarWidth(0)');
  });

  it('keeps the fixed rail visible and hides only the v2 explorer tree panel', () => {
    expect(sidebarSource).toContain("id={isV2Ui ? 'gonavi-sidebar-tree-panel' : undefined}");
    expect(sidebarSource).toContain("data-sidebar-tree-panel={isV2Ui ? 'true' : undefined}");
    expect(sidebarSource).toContain('aria-hidden={isV2Ui ? isTreePanelCollapsed : undefined}');
    expect(sidebarSource).toContain("display: isV2Ui && isTreePanelCollapsed ? 'none' : 'flex'");
    expect(connectionRailSource).toContain('data-sidebar-fixed-rail="true"');
    expect(appSource).toContain('isTreePanelCollapsed={isV2Ui && isSidebarCollapsed}');
    expect(appSource).toContain("visibility: !isV2Ui && isSidebarCollapsed ? 'hidden' : 'visible'");
    expect(appSource).toContain('data-sidebar-collapse-trigger="true"');
    expect(appSource).toContain('data-titlebar-brand-region="true"');
    expect(appSource).toContain('data-sidebar-toggle-placement="titlebar"');
    expect(appSource).toContain('data-no-titlebar-toggle="true"');
    expect(appSource).toContain('aria-controls="gonavi-sidebar-tree-panel"');
    expect(appSource).toContain('aria-expanded={!isSidebarCollapsed}');
    expect(appSource).toContain('<MenuFoldOutlined />');
    expect(appSource).toContain('<MenuUnfoldOutlined />');
    expect(appSource).toContain("'app.sidebar.collapse'");
    expect(appSource).toContain("'app.sidebar.expand'");
    expect(appSource).toContain("case 'focusSidebarSearch':");
    expect(appSource).toContain('handleFocusSidebarSearch();');
    expect(appSource).toContain('<TabManager onFocusSidebarSearch={handleFocusSidebarSearch} />');
    expect(appSource).toContain('{(!isV2Ui || isSidebarCollapsed) && (');
    expect(appSource).toContain('onCollapseSidebar={isV2Ui && !isSidebarCollapsed ? handleCollapseSidebarPanel : undefined}');
    expect(appSource).toContain('collapseSidebarButtonRef={sidebarExplorerToggleRef}');
    expect(appSource).toContain('ref={sidebarTitlebarToggleRef}');
    expect(appSource).toContain("pendingSidebarToggleFocusRef.current = 'titlebar'");
    expect(appSource).toContain("pendingSidebarToggleFocusRef.current = 'explorer'");
    expect(appSource).toContain("(target === 'titlebar' ? sidebarTitlebarToggleRef : sidebarExplorerToggleRef).current?.focus()");
    expect(sidebarSource).toContain('data-sidebar-toggle-placement="explorer-header"');

    const titlebarToggleIndex = appSource.indexOf('data-sidebar-collapse-trigger="true"');
    const siderIndex = appSource.indexOf('<Sider');
    const siderEndIndex = appSource.indexOf('</Sider>', siderIndex);
    const triggerStartIndex = appSource.lastIndexOf('<Button', titlebarToggleIndex);
    const triggerEndIndex = appSource.indexOf('</Tooltip>', titlebarToggleIndex);
    const triggerSource = appSource.slice(triggerStartIndex, triggerEndIndex);
    const siderSource = appSource.slice(siderIndex, siderEndIndex);
    const explorerActionsIndex = sidebarSource.indexOf('<div className="gn-v2-active-connection-actions">');
    const fixedRailIndex = sidebarSource.indexOf('<SidebarConnectionRail');
    const explorerPanelIndex = sidebarSource.indexOf("id={isV2Ui ? 'gonavi-sidebar-tree-panel' : undefined}");
    const connectionMenuIndex = sidebarSource.indexOf('<Tooltip title={v2ConnectionActionsLabel}>', explorerActionsIndex);
    const explorerToggleIndex = sidebarSource.indexOf('data-sidebar-toggle-placement="explorer-header"', explorerActionsIndex);
    const explorerToggleEndIndex = sidebarSource.indexOf('</Tooltip>', explorerToggleIndex);
    const explorerToggleStartIndex = sidebarSource.lastIndexOf('<Button', explorerToggleIndex);
    const explorerToggleSource = sidebarSource.slice(explorerToggleStartIndex, explorerToggleEndIndex);
    expect(titlebarToggleIndex).toBeGreaterThan(appSource.indexOf('data-titlebar-brand-region="true"'));
    expect(titlebarToggleIndex).toBeLessThan(siderIndex);
    expect(triggerSource).toContain('type="text"');
    expect(triggerSource).toContain("WebkitAppRegion: 'no-drag'");
    expect(triggerSource).toContain("'--wails-draggable': 'no-drag'");
    expect(siderSource).toContain('onCollapseSidebar={isV2Ui && !isSidebarCollapsed ? handleCollapseSidebarPanel : undefined}');
    expect(fixedRailIndex).toBeGreaterThan(-1);
    expect(explorerPanelIndex).toBeGreaterThan(fixedRailIndex);
    expect(explorerToggleIndex).toBeGreaterThan(connectionMenuIndex);
    expect(explorerToggleSource).toContain('ref={collapseSidebarButtonRef}');
    expect(explorerToggleSource).not.toContain('disabled=');
  });

  it('overrides normal resize bounds with the retained rail width and removes the collapsed resize target', () => {
    expect(appCssSource).toMatch(
      /body\[data-ui-version\]\s+\.ant-layout-sider\[data-sidebar-collapsed='true'\]\s*\{[^}]*min-width:\s*var\(--gonavi-sidebar-collapsed-width, 0px\)\s*!important;[^}]*max-width:\s*var\(--gonavi-sidebar-collapsed-width, 0px\)\s*!important;[^}]*width:\s*var\(--gonavi-sidebar-collapsed-width, 0px\)\s*!important;[^}]*flex:\s*0 0 var\(--gonavi-sidebar-collapsed-width, 0px\)\s*!important;/s,
    );
    expect(appSource).toContain('paddingRight: isSidebarCollapsed ? 0 : sidebarResizeHandleWidth');
    expect(appSource).toContain('{!isSidebarCollapsed && <div');
    expect(appCssSource).toMatch(
      /body\[data-ui-version\]\s+\.gonavi-sidebar-collapse-trigger\.ant-btn\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px(?:\s*!important)?;[^}]*border:\s*0\s*!important;/s,
    );
    expect(appCssSource).toMatch(
      /body\[data-ui-version='v2'\]\s+\.gonavi-sidebar-collapse-trigger\.ant-btn\[data-sidebar-toggle-placement='explorer-header'\]\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px(?:\s*!important)?;[^}]*border:\s*1px solid var\(--gn-br-2\)\s*!important;[^}]*border-radius:\s*7px\s*!important;/s,
    );
    expect(appCssSource).not.toContain(".ant-layout-sider[data-sidebar-panel='true']");
    expect(appCssSource).not.toMatch(/\.gonavi-sidebar-collapse-trigger[^}]*position:\s*absolute/s);
    expect(appCssSource).not.toMatch(/\.gonavi-sidebar-collapse-trigger[^}]*right:\s*-\d+px/s);
    expect(appCssSource).not.toMatch(/\.gonavi-sidebar-collapse-trigger[^}]*translateY/s);
  });
});
