import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.tsx', import.meta.url)),
  'utf8',
);
const appCss = readFileSync(
  fileURLToPath(new globalThis.URL('./App.css', import.meta.url)),
  'utf8',
);
const v2ThemeCss = readFileSync(
  fileURLToPath(new globalThis.URL('./v2-theme.css', import.meta.url)),
  'utf8',
);
const linuxCJKFontBannerSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/LinuxCJKFontBanner.tsx', import.meta.url)),
  'utf8',
);
const appUtilityStylesSource = readFileSync(
  fileURLToPath(new globalThis.URL('./hooks/useAppUtilityStyles.tsx', import.meta.url)),
  'utf8',
);
const appSidebarResizeSource = readFileSync(
  fileURLToPath(new globalThis.URL('./hooks/useAppSidebarResize.ts', import.meta.url)),
  'utf8',
);
const sidebarLayoutSource = readFileSync(
  fileURLToPath(new globalThis.URL('./utils/sidebarLayout.ts', import.meta.url)),
  'utf8',
);

const getGlobalShortcutCaseBlock = (action: string) => {
  const caseToken = `case '${action}':`;
  const start = appSource.indexOf(caseToken);
  expect(start).toBeGreaterThan(-1);

  const afterCase = appSource.slice(start + caseToken.length);
  const nextCaseIndex = afterCase.search(/\n\s+case '[^']+':/);
  const switchEndIndex = afterCase.indexOf("window.addEventListener('keydown', handleGlobalShortcut, true);");
  const endIndex = nextCaseIndex >= 0 ? nextCaseIndex : switchEndIndex;

  expect(endIndex).toBeGreaterThan(-1);
  return afterCase.slice(0, endIndex);
};

describe('settings center tool entries', () => {
  it('opens data workflows as stable workspace tabs instead of settings-center modals', () => {
    expect(appSource).toContain("import { buildDataSyncWorkbenchTab } from './utils/dataSyncTab';");
    expect(appSource).toContain('const handleOpenDataSyncWorkbench = useCallback((entryMode: DataSyncEntryMode) => {');
    expect(appSource).toContain('addTab(buildDataSyncWorkbenchTab({ entryMode }));');
    expect(appSource).toContain("handleOpenDataSyncWorkbench('schemaCompare');");
    expect(appSource).toContain("handleOpenDataSyncWorkbench('dataCompare');");
    expect(appSource).toContain("handleOpenDataSyncWorkbench('sync');");
    expect(appSource).not.toContain("import DataSyncModal from './components/DataSyncModal';");
    expect(appSource).not.toContain('isSyncModalOpen');
    expect(appSource).not.toContain('syncModalEntryMode');
  });

  it('exposes snippet management next to shortcut management', () => {
    expect(appSource).toContain("key: 'snippet-settings'");
    expect(appSource).toContain("title: t('app.tools.entry.snippets.title')");
    expect(appSource).toContain("description: t('app.tools.entry.snippets.description')");
    expect(appSource).toContain("handleOpenToolCenterPane('workspace', 'snippet-settings')");
    expect(appSource).toContain('gonavi:open-snippet-settings');
    expect(appSource).not.toContain('isSnippetModalOpen');

    const snippetIndex = appSource.indexOf("key: 'snippet-settings'");
    const shortcutIndex = appSource.indexOf("key: 'shortcut-settings'", snippetIndex);
    expect(snippetIndex).toBeGreaterThan(-1);
    expect(shortcutIndex).toBeGreaterThan(snippetIndex);
  });

  it('uses the settings center side navigation for every tool group', () => {
    expect(appSource).toContain("type ToolCenterGroupKey = 'config' | 'workflow' | 'workspace';");
    expect(appSource).toContain("type SettingsCenterGroupKey = 'preferences' | 'services' | ToolCenterGroupKey | 'about';");
    expect(appSource).toContain("const [toolCenterBackGroupKey, setToolCenterBackGroupKey] = useState<ToolCenterGroupKey | null>(null);");
    expect(appSource).toContain("title: t('app.tools.group.config.title')");
    expect(appSource).toContain("title: t('app.tools.group.workflow.title')");
    expect(appSource).toContain("title: t('app.tools.group.workspace.title')");
    expect(appSource).toContain('const combinedSettingsCenterGroups = [');
    expect(appSource).toContain('(group) => group.key === activeSettingsCenterGroupKey');
    expect(appUtilityStylesSource).toContain("const toolCenterModalSplitStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("gridTemplateColumns: '204px minmax(0, 1fr)'");
    expect(appUtilityStylesSource).toContain("const toolCenterNavPanelStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("const toolCenterNavScrollStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("const toolCenterContentPanelStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("const toolCenterDetailPanelStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("const toolCenterDetailBodyStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appSource).toContain('role="tablist" aria-orientation="vertical"');
    expect(appSource).toContain('role="tab"');
    expect(appSource).toContain('aria-selected={active}');
    expect(appSource).toContain('title={`${group.title} - ${group.description}`}');
    expect(appUtilityStylesSource).toContain("borderRight: `1px solid ${overlayTheme.divider}`");
    expect(appSource).toContain('setActiveSettingsCenterPane(null);');
    expect(appSource).not.toContain('{group.items.length}');
    expect(appSource).toContain("const handleOpenToolCenterPane = useCallback((group: ToolCenterGroupKey, key: ToolCenterPaneKey) => {");
    expect(appSource).toContain("const [activeSettingsCenterPane, setActiveSettingsCenterPane] = useState<SettingsCenterPaneState | null>(null);");
    expect(appSource).toContain("const handleReturnToToolCenter = useCallback((closeChild?: () => void) => {");
    expect(appSource).toContain("t('common.back_to_settings')");
    expect(appSource).toContain("width={1080}");
    expect(appSource).toContain('centered');
    expect(appSource).not.toContain('const [isToolsModalOpen');
  });

  it('keeps the unified settings modal height fixed across group switches and scrolls the list area internally', () => {
    expect(appUtilityStylesSource).toContain('const toolCenterModalContentStyle = useMemo<React.CSSProperties>(() => ({');
    expect(appUtilityStylesSource).toContain("height: 'min(820px, calc(100vh - 64px))'");
    expect(appUtilityStylesSource).toContain("const toolCenterModalWorkspaceStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("const toolCenterModalSplitStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appUtilityStylesSource).toContain("const toolCenterScrollableListStyle = useMemo<React.CSSProperties>(() => ({");
    expect(appSource).toContain("body: { paddingTop: 8, paddingBottom: 8, overflow: 'hidden', flex: 1, minHeight: 0 }");
    expect(appSource).toContain('style={toolCenterModalWorkspaceStyle}');
    expect(appSource).toContain('style={toolCenterModalSplitStyle}');
    expect(appSource).toContain('style={toolCenterNavPanelStyle}');
    expect(appSource).toContain('style={toolCenterNavScrollStyle}');
    expect(appSource).toContain('style={toolCenterContentPanelStyle}');
    expect(appSource).toContain('style={activeSettingsCenterDetailPanelStyle}');
    expect(appSource).toContain('style={isActiveToolCenterPane ? toolCenterDetailBodyStyle : settingsCenterDetailBodyStyle}');
    expect(appSource).toContain('style={toolCenterScrollableListStyle}');
    expect(appUtilityStylesSource).toContain("overflowY: 'auto'");
    expect(appSource).toContain("borderTop: index === 0 ? `1px solid ${overlayTheme.divider}` : 'none'");
    expect(appSource).toContain("borderBottom: `1px solid ${overlayTheme.divider}`");
  });

  it('keeps browser-compatible connection transfer and mounted data-root entries available in the web runtime', () => {
    const toolGroupsStart = appSource.indexOf('const toolCenterGroups: SettingsCenterNavigationGroup[] = [');
    const configGroupStart = appSource.indexOf("key: 'config',", toolGroupsStart);
    const configGroupSource = appSource.slice(
      configGroupStart,
      appSource.indexOf("key: 'workflow',", configGroupStart),
    );

    expect(toolGroupsStart).toBeGreaterThan(-1);
    expect(configGroupStart).toBeGreaterThan(toolGroupsStart);
    expect(appSource).toContain("accept=\".gonavi-conn,.json,.xml,.ncx\"");
    expect(appSource).toContain('ExportConnectionsPayload');
    expect(appSource).toContain('downloadBrowserTextFile');
    expect(appSource).toContain("__GONAVI_WEB_RUNTIME__?.buildType === 'web'");
    expect(appSource).toMatch(/if \(isWebRuntime\) \{\r?\n\s+return \(/);
    expect(configGroupSource).toContain("key: 'data-root'");
    expect(configGroupSource).toContain("handleOpenToolCenterPane('config', 'data-root')");
    expect(appSource).toContain('...toolCenterGroups,');
  });

  it('lets the tool center detail header own embedded tool titles', () => {
    const renderPaneStart = appSource.indexOf('const renderToolCenterPane = () => {');
    const renderPaneSource = appSource.slice(
      renderPaneStart,
      appSource.indexOf('};\n\n            return (', renderPaneStart),
    );
    const connectionPackageSource = renderPaneSource.slice(
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'connection-package')"),
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'data-root')"),
    );
    const dataRootSource = renderPaneSource.slice(
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'data-root')"),
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'security-update')"),
    );
    const securityUpdateSource = renderPaneSource.slice(
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'security-update')"),
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'drivers')"),
    );
    const driverSource = renderPaneSource.slice(
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'drivers')"),
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'snippet-settings')"),
    );
    const snippetSource = renderPaneSource.slice(
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'snippet-settings')"),
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'shortcut-settings')"),
    );
    const shortcutSource = renderPaneSource.slice(
      renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'shortcut-settings')"),
      renderPaneSource.indexOf('return null;', renderPaneSource.indexOf("if (activeSettingsCenterPane.key === 'shortcut-settings')")),
    );

    expect(appSource).toContain('activeSettingsCenterPaneItem?.title ?? activeSettingsCenterGroup.title');
    expect(connectionPackageSource).toContain('<ConnectionPackagePasswordModal');
    expect(connectionPackageSource).not.toContain('renderUtilityModalTitle');
    expect(dataRootSource).toContain('title={null}');
    expect(dataRootSource).toContain('closable={false}');
    expect(dataRootSource).not.toContain('renderUtilityModalTitle');
    expect(securityUpdateSource).toContain('<SecurityUpdateSettingsModal');
    expect(securityUpdateSource).not.toContain('renderUtilityModalTitle');
    expect(renderPaneSource).not.toContain('<DataSyncModal');
    expect(driverSource).toContain('<DriverManagerModal');
    expect(driverSource).not.toContain('renderUtilityModalTitle');
    expect(snippetSource).toContain('<SnippetSettingsModal');
    expect(snippetSource).not.toContain('renderUtilityModalTitle');
    expect(shortcutSource).toContain('title={null}');
    expect(shortcutSource).toContain('closable={false}');
    expect(shortcutSource).not.toContain('renderUtilityModalTitle');
  });

  it('does not render an extra top back button in tool detail headers', () => {
    const combinedGroupsIndex = appSource.indexOf('combinedSettingsCenterGroups.map');
    const detailHeaderSource = appSource.slice(
      appSource.indexOf('{activeSettingsCenterPane ? (', combinedGroupsIndex),
      appSource.indexOf('key={activeSettingsCenterPane.key}', combinedGroupsIndex),
    );

    expect(detailHeaderSource).toContain('activeSettingsCenterPaneItem?.title ?? activeSettingsCenterGroup.title');
    expect(detailHeaderSource).toContain('activeSettingsCenterPaneItem?.description ?? activeSettingsCenterGroup.description');
    expect(detailHeaderSource).not.toContain('<Button onClick={closeToolCenterPane}>');
    expect(detailHeaderSource).not.toContain("{t('common.back_to_settings')}");
  });

  it('keeps the v2 AI entry in the sidebar and the legacy AI entry on the content edge', () => {
    expect(appSource).toContain('onToggleAI={toggleAIPanel}');
    expect(appSource).toContain('renderLegacyAIEdgeHandle');
    expect(appSource).toContain('resolveLegacyAIEdgeHandleDockStyle');
    expect(appSource).toContain('data-gonavi-legacy-ai-edge-action="true"');
    expect(appSource).toContain('{!isV2Ui && !aiPanelVisible && (');
    expect(appSource).toContain('{!isV2Ui && (');
    expect(appSource).not.toContain('data-gonavi-ai-entry-action="true"');
  });

  it('keeps sidebar utility handlers stable so v2 button clicks do not repaint the workspace', () => {
    expect(appSource).toContain('const handleOpenToolsModal = useCallback(');
    expect(appSource).toContain('const handleOpenSettingsModal = useCallback(');
    expect(appSource).toContain('const handleToggleLogPanel = useCallback(');
    expect(appSource).toContain('new CustomEvent');
    expect(appSource).toContain("'gonavi:show-sql-execution-log'");
    expect(appSource).toContain("detail: { mode: 'open' }");
    expect(appSource).toContain('toggleAppLogPanel();');
    expect(appSource).toContain('const handleFocusSidebarSearch = useCallback(');
    expect(appSource).toContain('const antdTheme = useMemo(() => ({');
    expect(appSource).toContain('theme={antdTheme}');
    expect(appSource).toContain('onOpenSettings={handleOpenSettingsModal}');
    expect(appSource).toContain('onToggleLogPanel={handleToggleLogPanel}');
    expect(appSource).toContain('onFocusCommandSearch={handleFocusSidebarSearch}');
    expect(appSource).toContain('onOpenAISettings={handleOpenAISettings}');
    expect(appSource).not.toContain('onOpenTools=');
    expect(appSource).not.toContain('onOpenSettings={() => setIsSettingsModalOpen(true)}');
    expect(appSource).not.toContain('onToggleLogPanel={() => setIsLogPanelOpen((prev) => !prev)}');
    expect(appSource).not.toContain('sqlLogCount={sqlLogCount}');
    expect(appSource).not.toContain('theme={{');
    expect(appSource).not.toContain('const sqlLogs = useStore(state => state.sqlLogs);');
  });

  it('renders the shared SQL log panel only for legacy layouts', () => {
    const logPanelIndex = appSource.indexOf('<LogPanel', appSource.indexOf('<Content'));
    const logPanelGuardIndex = appSource.lastIndexOf('{isLogPanelOpen && (', logPanelIndex);
    const legacyOnlyGuardIndex = appSource.lastIndexOf('{!isV2Ui && isLogPanelOpen && (', logPanelIndex);

    expect(logPanelIndex).toBeGreaterThan(-1);
    expect(logPanelGuardIndex).toBe(-1);
    expect(legacyOnlyGuardIndex).toBeGreaterThan(-1);
    expect(appSource).toContain('onClose={handleCloseLogPanel}');
    expect(appSource).toContain('onResizeStart={handleLogResizeStart}');
  });

  it('lets the v2 Sidebar own the entire left layout instead of stacking legacy controls above it', () => {
    const siderIndex = appSource.indexOf("className={isV2Ui ? 'gn-v2-app-sider' : undefined}");
    const legacyGuardIndex = appSource.indexOf('{!isV2Ui && (', siderIndex);
    const legacyCreateIndex = appSource.indexOf('<Button icon={<PlusOutlined />} onClick={handleCreateConnection}', legacyGuardIndex);
    const legacyCreateTitleIndex = appSource.indexOf("title={t('connection.new')}", legacyCreateIndex);
    const legacyQueryIndex = appSource.indexOf('<Button icon={<ConsoleSqlOutlined />} onClick={handleNewQuery}', legacyGuardIndex);
    const legacyQueryTitleIndex = appSource.indexOf("title={t('query.new')}", legacyQueryIndex);
    const sidebarIndex = appSource.indexOf('<Sidebar', legacyGuardIndex);
    const floatingLogIndex = appSource.indexOf('Floating SQL Log Toggle', sidebarIndex);
    const floatingLogGuardIndex = appSource.indexOf('{!isV2Ui && (', floatingLogIndex);

    expect(siderIndex).toBeGreaterThan(-1);
    expect(legacyGuardIndex).toBeGreaterThan(siderIndex);
    expect(legacyCreateIndex).toBeGreaterThan(legacyGuardIndex);
    expect(legacyCreateIndex).toBeLessThan(sidebarIndex);
    expect(legacyCreateTitleIndex).toBeGreaterThan(legacyCreateIndex);
    expect(legacyQueryIndex).toBeGreaterThan(legacyCreateIndex);
    expect(legacyQueryIndex).toBeLessThan(sidebarIndex);
    expect(legacyQueryTitleIndex).toBeGreaterThan(legacyQueryIndex);
    expect(appSource).toContain('paddingBottom: isV2Ui ? 0 : 58');
    expect(floatingLogIndex).toBeGreaterThan(sidebarIndex);
    expect(floatingLogGuardIndex).toBeGreaterThan(floatingLogIndex);
  });

  it('uses the v2 green accent for sidebar and log resize guide lines', () => {
    expect(appSource).toContain('const resizeGuideColor = isV2Ui');
    expect(appSource).toContain("'var(--gn-accent, #16a34a)'");
    expect(appSource).toContain("darkMode ? 'rgba(246, 196, 83, 0.55)' : 'rgba(24, 144, 255, 0.5)'");
  });

  it('keeps the green v2 accent as fallback while allowing custom CSS tokens to override it', () => {
    expect(appSource).toContain("const v2AntPrimaryColor = customThemeAntTokens.primary ?? (darkMode ? '#22c55e' : '#16a34a');");
    expect(appSource).toContain("const v2AntPrimaryContrastColor = customThemeAntTokens.primaryContrast ?? '#ffffff';");
    expect(appSource).toContain('extractCustomThemeAntTokens(activeCustomTheme.css)');
    expect(appSource).toContain('resolveAvailableCustomTheme(customThemes, activeCustomThemeId)');
    expect(appSource).toContain('colorTextLightSolid: isV2Ui ? v2AntPrimaryContrastColor');
    expect(appSource).toContain("colorPrimary: isV2Ui ? v2AntPrimaryColor : (darkMode ? '#f6c453' : '#1677ff')");
    expect(appSource).toMatch(/background:\s*active\s*\?\s*overlayTheme\.selectedBg/);
    expect(appSource).toMatch(/background:\s*active\s*\?\s*overlayTheme\.selectedText/);
    expect(appSource).toContain("background: 'transparent'");
    expect(appSource).toMatch(/color:\s*active\s*\?\s*overlayTheme\.iconColor/);
    expect(appSource).toContain("background: isV2Ui ? v2AntPrimaryBgColor : (darkMode ? 'rgba(255,214,102,0.16)' : 'rgba(24,144,255,0.10)')");
    expect(appSource).toContain("color: isV2Ui ? v2AntPrimaryColor : (darkMode ? '#ffd666' : '#1677ff')");
  });

  it('does not start sidebar resize from right-clicking the resize handle', () => {
    expect(appSidebarResizeSource).toContain('if (e.button !== 0)');
    expect(appSource).toContain('onContextMenu={(event) => {');
    expect(appSource).toContain('event.preventDefault();');
    expect(appSource).toContain('event.stopPropagation();');

    const guardIndex = appSidebarResizeSource.indexOf('if (e.button !== 0)');
    const ghostDisplayIndex = appSidebarResizeSource.indexOf("ghostRef.current.style.display = 'block'", guardIndex);
    const dragStartIndex = appSidebarResizeSource.indexOf('sidebarDragRef.current = {', guardIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(ghostDisplayIndex).toBeGreaterThan(guardIndex);
    expect(dragStartIndex).toBeGreaterThan(guardIndex);
  });

  it('positions sidebar resize guide from the rendered sider edge', () => {
    expect(appSidebarResizeSource).toContain('const siderRef = useRef<HTMLDivElement | null>(null);');
    expect(appSource).toContain('ref={siderRef}');
    expect(appSidebarResizeSource).toContain('const siderRect = siderRef.current?.getBoundingClientRect();');
    expect(appSidebarResizeSource).toContain('const startGuideLeft = siderRect?.right ?? sidebarWidth;');
    expect(appSidebarResizeSource).toContain('const startWidth = siderRect?.width ?? sidebarWidth;');
    expect(appSidebarResizeSource).toContain('resolveSidebarResizeBounds(siderRef.current)');
    expect(appSidebarResizeSource).toContain('ghostRef.current.style.left = `${startGuideLeft}px`;');
    expect(appSidebarResizeSource).toContain('ghostRef.current.style.left = `${startGuideLeft + (newWidth - startWidth)}px`;');
  });

  it('keeps sidebar resize bounds aligned across drag logic and sider CSS limits', () => {
    expect(sidebarLayoutSource).toContain('export const SIDEBAR_RESIZE_MAX_WIDTH = 960;');
    expect(sidebarLayoutSource).toContain('export const SIDEBAR_MIN_WORKBENCH_WIDTH = 360;');
    expect(appSidebarResizeSource).toContain('resolveSidebarResizeMaxWidth(window.innerWidth, minWidth)');
    expect(appCss).toMatch(/body\[data-ui-version="legacy"\]\s+\.ant-layout-sider\s*\{[^}]*min-width:\s*232px\s*!important;[^}]*max-width:\s*min\(960px,\s*calc\(100vw - 360px\)\)\s*!important;/s);
    expect(v2ThemeCss).toMatch(/body\[data-ui-version="v2"\]\s+\.gn-v2-app-sider\s*\{[^}]*min-width:\s*232px\s*!important;[^}]*max-width:\s*min\(960px,\s*calc\(100vw - 360px\)\)\s*!important;/s);
  });

  it('keeps connection modal warm-mounted while leaving the remaining heavyweight modals conditional', () => {
    expect(appSource).toContain('const [isConnectionModalMounted, setIsConnectionModalMounted] = useState(false);');
    expect(appSource).toContain('{isConnectionModalMounted && (');
    expect(appSource).toContain('{isSettingsModalOpen && (');
    expect(appSource).toContain('{isThemeModalOpen && (');
    expect(appSource).not.toContain('{isToolsModalOpen && (');
    expect(appSource).not.toContain('{isShortcutModalOpen && (');
    expect(appSource).not.toContain('{isAISettingsOpen && (');
    expect(appSource).toContain('{isDriverModalOpen && (');
    expect(appSource).not.toContain('{isSyncModalOpen && (');
  });

  it('recreates the hidden download progress portal above dialogs opened later', () => {
    const start = appSource.indexOf('title={updateDownloadProgress.version');
    const end = appSource.indexOf('</Modal>', start);
    const downloadProgressModalSource = appSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(downloadProgressModalSource).toContain('open={updateDownloadProgress.open}');
    expect(downloadProgressModalSource).toContain('destroyOnHidden');
  });

  it('loads editable connection details before opening the edit modal so stored secrets can be shown', () => {
    expect(appSource).toContain("typeof backendApp?.GetEditableSavedConnection === 'function'");
    expect(appSource).toContain('const editableConnection = await backendApp.GetEditableSavedConnection(conn.id);');
    expect(appSource).toContain('const errorMessage = error?.message;');
    expect(appSource).toContain("typeof errorMessage === 'string'");
    expect(appSource).toContain("t('app.connection.message.editable_load_failed_with_detail', { detail })");
    expect(appSource).toContain("t('app.connection.message.editable_load_failed')");
    expect(appSource).toContain('setEditingConnection(nextConnection);');
    expect(appSource).toContain('setIsModalOpen(true);');
  });

  it('loads editable AI provider details inside settings-center AI pane content', () => {
    // 聊天/入口打开 AI 配置走设置中心 AISettingsContent，不再挂独立 AISettingsModal
    expect(appSource).toContain('<LazyAISettingsContent');
    expect(appSource).toContain("activeSettingsCenterPane.key === 'ai'");
    expect(appSource).not.toContain('<AISettingsModal');
    const modalSource = readFileSync(new URL('./components/AISettingsModal.tsx', import.meta.url), 'utf8');
    expect(modalSource).toContain("typeof Service?.AIGetEditableProvider === 'function'");
    expect(modalSource).toContain('await Service.AIGetEditableProvider(p.id)');
  });

  it('keeps edit-mode passwords masked by default instead of forcing the eye toggle open', () => {
    expect(appSource).not.toContain('setPrimaryPasswordVisible(String(config.password || "").trim() !== "")');
  });

  it('keeps shortcut manager scrolling inside the embedded settings pane', () => {
    expect(appSource).toContain('centered');
    expect(appSource).toContain("if (activeSettingsCenterPane.key === 'shortcut-settings')");
    expect(appSource).toContain('embedded');
    expect(appSource).toContain("body: { paddingTop: 8, overflow: 'hidden', flex: 1, minHeight: 0 }");
    expect(appSource).toContain('data-gonavi-shortcut-modal-scroll="true"');
    expect(appSource).toContain("height: '100%'");
    expect(appSource).toContain("overflowY: 'auto'");
  });

  it('renders recorded shortcuts with platform-specific display labels', () => {
    expect(appSource).toContain('getShortcutDisplayLabel');
    expect(appSource).toContain('getShortcutDisplayLabel(binding.combo, activeShortcutPlatform)');
  });

  it('executes every global shortcut action exposed in the shortcut manager', () => {
    const expectedHandlers = new Map([
      ['runQuery', 'gonavi:run-active-query'],
      ['focusSidebarSearch', 'gonavi:focus-sidebar-search'],
      ['newQueryTab', 'handleNewQuery();'],
      ['switchToNextTab', 'switchActiveTabByOffset(1);'],
      ['switchToPreviousTab', 'switchActiveTabByOffset(-1);'],
      ['newConnection', 'handleCreateConnection();'],
      ['toggleAIPanel', 'toggleOrFocusNativeAIChatFromMainWindow()'],
      ['toggleLogPanel', 'handleToggleLogPanel();'],
      ['toggleTheme', 'selectPresetTheme('],
      ['openShortcutManager', "handleOpenToolCenterPane('workspace', 'shortcut-settings');"],
      ['toggleMacFullscreen', 'handleTitleBarWindowToggle({ allowMacNativeFullscreen: true });'],
      ['resetWindowZoom', 'handleManualResetWindowZoom();'],
    ]);

    for (const [action, handler] of expectedHandlers) {
      expect(getGlobalShortcutCaseBlock(action)).toContain(handler);
    }
    expect(appSource).toContain('const switchActiveTabByOffset = useCallback((offset: 1 | -1) => {');
    expect(appSource).toContain('const nextIndex = (baseIndex + offset + tabs.length) % tabs.length;');
    expect(appSource).toContain('setActiveTab(tabs[nextIndex].id);');
    expect(appSource).toContain('handleCreateConnection, handleManualResetWindowZoom');
    expect(appSource).toContain('switchActiveTabByOffset, themeMode');
  });

  it('automatically resets WebView2 zoom when a Windows taskbar restore returns focus', () => {
    expect(appSource).toContain('shouldResetWebViewZoomForScaleFix(reason, hasViewportScaleDrift)');
    expect(appSource).toContain('const shouldResetWebViewZoom = shouldResetWebViewZoomForScaleFix(reason, hasViewportScaleDrift);');
    expect(appSource).toContain('if (shouldResetWebViewZoom && !isMaximised)');
    expect(appSource).toContain('const res = await (window as any).go?.app?.App?.ResetWebViewZoom?.();');
    expect(appSource).toContain('if (!shouldApplyWindowsScaleFix(reason, hasViewportScaleDrift))');
    expect(appSource).toContain('const nudgedWidth = getWindowsScaleFixNudgedWidth(width);');
    expect(appSource).toContain('WindowSetSize(nudgedWidth, height);');
    expect(appSource).toContain('该异常不一定表现为 viewport ratio drift');
  });

  it('settles Windows cold-start window layout without requiring a taskbar restore', () => {
    expect(appSource).toContain("const applyStartupWindowChrome = (attempt: number, mode: 'maximised' | 'fullscreen') => {");
    expect(appSource).toContain('markStartupWindowRestorePending(3200)');
    expect(appSource).toContain("applyStartupWindowChrome(1, 'maximised');");
    expect(appSource).toContain('const delayMs = attempt <= 1 ? 0 : applyRetryDelayMs');
    expect(appSource).toContain('markAppliedMaximisedOrFullscreen');
    expect(appSource).toContain('shouldPreferWindowsStartupMaximise(bounds, viewport)');
    expect(appSource).toContain('applyWindowsWorkAreaFillFallback');
    expect(appSource).toContain('resolveWorkAreaFillWindowBounds(readCurrentVisibleViewport())');
    expect(appSource).toContain('restoreNormalWindowBounds');
    expect(appSource).toContain("void fixWindowScaleIfNeeded('startup');");
    expect(appSource).toContain('const startupLayoutFixTimers = [220, 1000, 1900].map((delayMs) => (');
    expect(appSource).toContain('if (isStartupWindowRestorePending())');
    expect(appSource).toContain('clearStartupWindowRestorePending();');
    // 启动恢复顺序：开关最大化 → 记忆最大化 → 记忆尺寸
    expect(appSource).toContain('// 1) 「启动时最大化」开关优先（Windows 按 Maximize 处理）');
    expect(appSource).toContain('// 2) 记忆用户上次窗口态：最大化/全屏');
    expect(appSource).toContain('// 3) 普通窗口：恢复用户调整过的尺寸和位置');
  });

  it('captures window state on startup and lifecycle events instead of waiting only for the polling interval', () => {
    expect(appSource).toContain('const scheduleWindowStateSave = (delayMs = 120) => {');
    expect(appSource).toContain('const scheduleWindowBoundsRepair = (delayMs = 80) => {');
    expect(appSource).toContain('if (hydrated) {');
    expect(appSource).toContain('scheduleWindowBoundsRepair(360);');
    expect(appSource).toContain('scheduleWindowStateSave(320);');
    expect(appSource).toContain('const unsubscribeHydration = useStore.persist.onFinishHydration(() => {');
    expect(appSource).toContain('scheduleWindowBoundsRepair();');
    expect(appSource).toContain('scheduleWindowStateSave(260);');
    expect(appSource).toContain('const cleanupWindowActivityScheduler = installNativeWindowActivityScheduler({');
    expect(appSource).toContain('fallbackIntervalMs: WINDOW_STATE_FALLBACK_INTERVAL_MS,');
    expect(appSource).toContain('resize: handleWindowRuntimeChange,');
    expect(appSource).toContain('focus: handleWindowRuntimeChange,');
    expect(appSource).toContain('pageshow: handleWindowRuntimeChange,');
    expect(appSource).toContain('pagehide: handleWindowLifecycleFlush,');
    expect(appSource).toContain('beforeunload: handleWindowLifecycleFlush,');
    expect(appSource).toContain('cleanupWindowActivityScheduler();');
  });

  it('keeps the resize minimise probe independent from DPR debounce and clears it on unmount', () => {
    const scaleEffectStart = appSource.indexOf('let minimisedCheckTimer: number | null = null;');
    const dprScheduleStart = appSource.indexOf('const scheduleDevicePixelRatioCheck = (trigger: WindowsScaleCheckTrigger) => {', scaleEffectStart);
    const activationScheduleStart = appSource.indexOf('const scheduleActivationFix = () => {', dprScheduleStart);
    const resizeHandlerStart = appSource.indexOf('const handleWindowResize = () => {', activationScheduleStart);
    const startupFixStart = appSource.indexOf('// Windows 冷启动：', resizeHandlerStart);
    const schedulerStart = appSource.indexOf('fallbackIntervalMs: WINDOWS_SCALE_FALLBACK_INTERVAL_MS,', startupFixStart);
    const cleanupStart = appSource.indexOf('return () => {', schedulerStart);
    const cleanupEnd = appSource.indexOf('cleanupWindowActivityScheduler();', cleanupStart);

    expect([scaleEffectStart, dprScheduleStart, activationScheduleStart, resizeHandlerStart, startupFixStart, schedulerStart, cleanupStart, cleanupEnd]
      .every((index) => index >= 0)).toBe(true);
    expect(appSource.slice(dprScheduleStart, activationScheduleStart)).not.toContain('minimisedCheckTimer');
    const resizeHandlerSource = appSource.slice(resizeHandlerStart, startupFixStart);
    const minimiseProbeIndex = resizeHandlerSource.indexOf('rememberMinimisedStateSoon();');
    const dprCheckIndex = resizeHandlerSource.indexOf("scheduleDevicePixelRatioCheck('resize');");
    expect(minimiseProbeIndex).toBeGreaterThan(-1);
    expect(dprCheckIndex).toBeGreaterThan(minimiseProbeIndex);
    expect(appSource.slice(cleanupStart, cleanupEnd)).toContain('window.clearTimeout(minimisedCheckTimer);');
    expect(appSource.slice(cleanupStart, cleanupEnd)).toContain('minimisedCheckTimer = null;');
  });

  it('clamps normal runtime window bounds back into the visible screen after display changes', () => {
    expect(appSource).toContain('const readCurrentVisibleViewport = () => resolveWailsWindowVisibleViewport(');
    expect(appSource).toContain('{ useMonitorLocalOrigin: isMacLikePlatform() }');
    expect(appSource).toContain('const repairRuntimeWindowBounds = async () => {');
    expect(appSource).toContain('const nextBounds = resolveVisibleStartupWindowBounds(currentBounds, readCurrentVisibleViewport());');
    expect(appSource).toContain("void emitWindowDiagnostic('adjust:runtime-window-bounds'");
    expect(appSource).toContain('WindowSetSize(nextBounds.width, nextBounds.height);');
    expect(appSource).toContain('WindowSetPosition(nextBounds.x, nextBounds.y);');
  });

  it('keeps titlebar double-click on maximise while shortcuts may enter macOS fullscreen', () => {
    expect(appSource).toContain('const handleTitleBarWindowToggle = async (options?: { allowMacNativeFullscreen?: boolean }) => {');
    expect(appSource).toContain('const allowMacNativeFullscreen = options?.allowMacNativeFullscreen === true;');
    expect(appSource).toContain('if (allowMacNativeFullscreen && useNativeMacWindowControls && isMacRuntime) {');
    expect(appSource).toContain('void handleTitleBarWindowToggle({ allowMacNativeFullscreen: false });');
    expect(getGlobalShortcutCaseBlock('toggleMacFullscreen')).toContain('handleTitleBarWindowToggle({ allowMacNativeFullscreen: true });');
  });

  it('captures global shortcuts before Monaco/editor defaults consume them', () => {
    expect(appSource).toContain("window.addEventListener('keydown', handleGlobalShortcut, true);");
    expect(appSource).toContain("window.removeEventListener('keydown', handleGlobalShortcut, true);");
  });

  it('consumes repeated AI shortcut events without toggling the newly focused child again', () => {
    expect(appSource).toContain("if (event.repeat && matchedAction === 'toggleAIPanel') {");
    expect(appSource).toContain('event.stopImmediatePropagation();');
  });

  it('skips the native mac titlebar bridge when the current runtime does not expose it', () => {
    expect(appSource).toContain("const backendApp = (window as any).go?.app?.App;");
    expect(appSource).toContain("if (typeof backendApp?.SetMacNativeWindowControls !== 'function') {");
    expect(appSource).toContain('void safeWindowRuntimeCall(() => SetMacNativeWindowControls(useNativeMacWindowControls), undefined);');
  });

  it('listens for command search query-tab events and routes them through handleNewQuery', () => {
    expect(appSource).toContain("window.addEventListener('gonavi:create-query-tab', handleCreateQueryTabEvent as EventListener);");
    expect(appSource).toContain("window.removeEventListener('gonavi:create-query-tab', handleCreateQueryTabEvent as EventListener);");
    expect(appSource).toContain('const handleCreateQueryTabEvent = () => {');
    expect(appSource).toContain('handleNewQuery();');
  });
});

describe('global appearance tokens', () => {
  it('publishes v2 font and scale variables for non-AntD chrome', () => {
    expect(appSource).toContain("setProperty('--gonavi-font-size'");
    expect(appSource).toContain("setProperty('--gn-ui-scale'");
    expect(appSource).toContain("setProperty('--gn-font-size'");
    expect(appSource).toContain("setProperty('--gn-font-size-sm'");
    expect(appSource).toContain("setProperty('--gn-font-size-xs'");
    expect(appSource).toContain("setProperty('--gn-font-size-mono'");
    expect(appSource).toContain("setProperty('--gn-data-table-font-size'");
    expect(appSource).toContain("setProperty('--gn-sidebar-tree-font-size'");
    expect(appSource).toContain("setProperty('--gn-sidebar-rail-scale'");
    expect(appSource).toContain("setProperty('--gn-control-height'");
    expect(appSource).toContain("setProperty('--gn-control-height-sm'");
    expect(appSource).toContain('fontFamily: resolvedUiFontFamily');
    expect(appSource).toContain('fontFamilyCode: resolvedMonoFontFamily');
    expect(appSource).toContain('const effectiveSidebarRailScale = sanitizeV2SidebarRailScale(appearance.v2SidebarRailScale);');
    expect(appSource).toContain("t('app.theme.appearance.sidebar_rail_scale_title')");
    expect(appSource).toContain("t('app.theme.appearance.sidebar_rail_scale_hint')");
    expect(appSource).toContain('v2SidebarRailScale: sanitizeV2SidebarRailScale(value)');
    expect(appSource).toContain("t('app.theme.data_table.font_size')");
    expect(appSource).toContain("t('app.theme.data_table.sidebar_tree_font_size')");
    expect(v2ThemeCss).toContain('--gn-sidebar-rail-scale');
    expect(v2ThemeCss).toContain('font-size: calc(var(--gn-font-size-sm, 12px) * var(--gn-sidebar-rail-scale, 1));');
    expect(v2ThemeCss).toContain('width: calc(38px * var(--gn-v2-rail-scale));');
    expect(appSource).toContain("const tableDoubleClickAction = appearance.tableDoubleClickAction === 'open-design' ? 'open-design' : 'open-data';");
    expect(appSource).toContain("t('app.theme.data_table.table_double_click_action')");
    expect(appSource).toContain("t('app.theme.data_table.table_double_click_action.open_data')");
    expect(appSource).toContain("t('app.theme.data_table.table_double_click_action.open_design')");
    expect(appSource).toContain("t('app.theme.data_table.table_double_click_action_hint')");
    expect(appSource).toContain("setAppearance({ tableDoubleClickAction: value as 'open-data' | 'open-design' })");
    expect(appSource).toContain('buildFontFamilyOptions(runtimePlatform, \'ui\', installedFontFamilies, t)');
    expect(appSource).toContain('buildFontFamilyOptions(runtimePlatform, \'mono\', installedFontFamilies, t)');
    expect(appSource).toContain('ListInstalledFontFamilies()');
    expect(appSource).toContain('const [installedFontFamilies, setInstalledFontFamilies] = useState<InstalledFontFamily[]>(EMPTY_INSTALLED_FONT_FAMILIES);');
    expect(appSource).toContain("import LinuxCJKFontBanner from './components/LinuxCJKFontBanner';");
    expect(appSource).toContain('<LinuxCJKFontBanner');
    expect(linuxCJKFontBannerSource).toContain('data-gonavi-linux-cjk-font-banner="true"');
    expect(linuxCJKFontBannerSource).toContain('useI18n');
    expect(linuxCJKFontBannerSource).toContain("t('app.linux_cjk_font_banner.title')");
    expect(linuxCJKFontBannerSource).toContain("t('app.linux_cjk_font_banner.description')");
    expect(linuxCJKFontBannerSource).toContain("t('app.linux_cjk_font_banner.action.open_font_settings')");
    expect(linuxCJKFontBannerSource).toContain("t('common.close')");
    expect(linuxCJKFontBannerSource).not.toContain('Linux CJK fonts missing / Ubuntu 中文字体缺失');
    expect(linuxCJKFontBannerSource).not.toContain('Chinese text may render as');
    expect(linuxCJKFontBannerSource).not.toContain('Font Settings');
    expect(appSource).toContain("t('app.theme.font_family.linux_cjk_install_prefix')");
    expect(appSource).toContain("t('app.theme.font_family.linux_cjk_install_suffix')");
    expect(appSource).toContain("t('app.theme.query_template.title')");
    expect(appSource).toContain("t('app.theme.query_template.description')");
    expect(appSource).toContain("t('app.theme.query_template.hint')");
    expect(appSource).toContain("t('app.theme.query_template.reset_default')");
    expect(appSource).toContain("const newQuerySqlTemplate = appearance.newQuerySqlTemplate ?? DEFAULT_QUERY_TEMPLATE;");
    expect(appSource).toContain("onChange={(event) => setAppearance({ newQuerySqlTemplate: event.target.value })}");
    expect(appSource).toContain("onClick={() => setAppearance({ newQuerySqlTemplate: null })}");
    expect(appSource).not.toContain('Ubuntu/Linux 未检测到中文 CJK 字体');
    expect(appSource).not.toContain('，然后重启 GoNavi。');
    expect(appSource).not.toContain('新建查询默认 SQL');
    expect(appSource).not.toContain('清空后新建查询将保持空白');
    expect(appSource).toContain('setIsLinuxCJKFontBannerDismissed(true)');
    expect(appSource).toContain('matchFontFamilyOption');
    expect(appSource).toContain('showSearch');
    expect(appSource).toContain('const dataTableFontSizeFollowsGlobal = appearance.dataTableFontSizeFollowGlobal !== false;');
    expect(appSource).toContain('const sidebarTreeFontSizeFollowsGlobal = appearance.sidebarTreeFontSizeFollowGlobal !== false;');
    expect(appSource).toContain('disabled={dataTableFontSizeFollowsGlobal}');
    expect(appSource).toContain('disabled={sidebarTreeFontSizeFollowsGlobal}');
    expect(appSource).toContain("type={dataTableFontSizeFollowsGlobal ? 'primary' : 'default'}");
    expect(appSource).toContain("type={sidebarTreeFontSizeFollowsGlobal ? 'primary' : 'default'}");
    expect(appSource).toContain('dataTableFontSizeFollowGlobal: !dataTableFontSizeFollowsGlobal');
    expect(appSource).toContain('sidebarTreeFontSizeFollowGlobal: !sidebarTreeFontSizeFollowsGlobal');
    expect(appSource).toContain('dataTableFontSize: dataTableFontSizeFollowsGlobal');
    expect(appSource).toContain('sidebarTreeFontSize: sidebarTreeFontSizeFollowsGlobal');
  });

  it('scales settings-center typography and keeps action heights consistent', () => {
    expect(appCss).toContain('--gn-font-size: calc(var(--gonavi-font-size, 14px) * var(--gn-ui-scale, 1));');
    expect(appCss).toContain('--gn-font-size-sm: calc(var(--gonavi-font-size, 14px) * var(--gn-ui-scale, 1) * 0.86);');
    expect(appCss).toContain('--gn-font-size-xs: calc(var(--gonavi-font-size, 14px) * var(--gn-ui-scale, 1) * 0.76);');
    expect(appCss).toContain('--gn-font-size-mono: calc(var(--gonavi-font-size, 14px) * var(--gn-ui-scale, 1) * 0.92);');
    expect(appCss).toContain('--gn-settings-font-secondary: var(--gn-font-size-sm);');
    expect(appCss).toMatch(/\.gonavi-settings-center-modal \.ant-btn\s*\{[^}]*font-size:\s*var\(--gn-settings-font-caption\)/s);
    expect(appCss).toMatch(/\.gonavi-settings-center-modal \.gonavi-ai-provider-add\.ant-btn\s*\{[^}]*height:\s*var\(--gn-control-height, 32px\) !important;/s);
    expect(appCss).toMatch(/\.gonavi-theme-settings \.gonavi-settings-section-hint\s*\{[^}]*font-size:\s*var\(--gn-settings-font-secondary/s);
  });
});
