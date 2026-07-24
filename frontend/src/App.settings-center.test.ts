import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.tsx', import.meta.url)),
  'utf8',
);

const appCssSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.css', import.meta.url)),
  'utf8',
);

const aiSettingsModalSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/AISettingsModal.tsx', import.meta.url)),
  'utf8',
);

describe('settings center layout', () => {
  it('hosts settings and tools in one split navigation shell', () => {
    expect(appSource).toContain("type SettingsCenterGroupKey = 'preferences' | 'services' | ToolCenterGroupKey | 'about';");
    expect(appSource).toContain('type SettingsCenterPaneKey =');
    expect(appSource).toContain('| ToolCenterPaneKey');
    expect(appSource).toContain("const [activeSettingsCenterGroupKey, setActiveSettingsCenterGroupKey] = useState<SettingsCenterGroupKey>('preferences');");
    expect(appSource).toContain("const [activeSettingsCenterPane, setActiveSettingsCenterPane] = useState<SettingsCenterPaneState | null>(null);");
    expect(appSource).toContain('style={toolCenterModalWorkspaceStyle}');
    expect(appSource).toContain('style={toolCenterModalSplitStyle}');
    expect(appSource).toContain('style={toolCenterNavPanelStyle}');
    expect(appSource).toContain('style={toolCenterNavScrollStyle}');
    expect(appSource).toContain('style={toolCenterContentPanelStyle}');
    expect(appSource).toContain('style={activeSettingsCenterDetailPanelStyle}');
    expect(appSource).toContain('style={isActiveToolCenterPane ? toolCenterDetailBodyStyle : settingsCenterDetailBodyStyle}');
    expect(appSource).toContain('style={toolCenterScrollableListStyle}');
    expect(appSource).toContain("title: t('app.settings.group.preferences.title')");
    expect(appSource).toContain("title: t('app.settings.group.services.title')");
    expect(appSource).toContain("title: t('app.tools.group.config.title')");
    expect(appSource).toContain("title: t('app.tools.group.workflow.title')");
    expect(appSource).toContain("title: t('app.tools.group.workspace.title')");
    expect(appSource).toContain("title: t('app.settings.group.about.title')");
    expect(appSource).toContain('const combinedSettingsCenterGroups = [');
    expect(appSource).not.toContain('const [isToolsModalOpen');
    expect(appSource).not.toContain('{isToolsModalOpen &&');
  });

  it('moves sidebar table metadata configuration into the settings center', () => {
    expect(appSource).toContain("key: 'sidebar-metadata'");
    expect(appSource).toContain("title: t('app.settings.sidebar_metadata.title')");
    expect(appSource).toContain("description: t('app.settings.sidebar_metadata.description')");
    expect(appSource).toContain("handleOpenSettingsCenterPane('preferences', 'sidebar-metadata')");
    expect(appSource).toContain("setSidebarTableMetadataFieldSelected(");
    expect(appSource).toContain('DndContext');
    expect(appSource).toContain('SortableContext');
    expect(appSource).toContain('handleSidebarMetadataDragEnd');
    expect(appSource).toContain('sidebarTableMetadataFieldOrder');
    expect(appSource).toContain('data-sidebar-metadata-field={field}');
    expect(appSource).toContain("sidebarTableMetadataFields: DEFAULT_SIDEBAR_TABLE_METADATA_FIELDS");
    expect(appSource).toContain("t('sidebar.v2_table_group_menu.display_table_rows')");
    expect(appSource).not.toContain("setIsLanguageModalOpen(true)");
  });

  it('adds persistent sidebar object visibility controls to preferences', () => {
    expect(appSource).toContain("key: 'sidebar-objects'");
    expect(appSource).toContain("title: t('app.settings.sidebar_objects.title')");
    expect(appSource).toContain("description: t('app.settings.sidebar_objects.description')");
    expect(appSource).toContain("handleOpenSettingsCenterPane('preferences', 'sidebar-objects')");
    expect(appSource).toContain("if (activeSettingsCenterPane.key === 'sidebar-objects')");
    expect(appSource).toContain('renderSidebarObjectVisibilitySettingsPane();');
    expect(appSource).toContain('sidebarHiddenObjectGroups');
    expect(appSource).toContain('SIDEBAR_OBJECT_GROUP_KEYS.filter((key) => key !== \'tables\')');
  });

  it('adds browser auth management into the services settings group', () => {
    expect(appSource).toContain("key: 'web-auth' as const");
    expect(appSource).toContain("title: t('app.settings.entry.web_auth.title')");
    expect(appSource).toContain("description: t('app.settings.entry.web_auth.description')");
    expect(appSource).toContain("handleOpenSettingsCenterPane('services', 'web-auth')");
    expect(appSource).toContain("<WebAuthSettingsPanel");
  });

  it('adds global proxy connection testing controls', () => {
    expect(appSource).toContain("const DEFAULT_GLOBAL_PROXY_TEST_URL = 'https://api.github.com/';");
    expect(appSource).toContain('const [proxyTestUrl, setProxyTestUrl]');
    expect(appSource).toContain('const [proxyTesting, setProxyTesting]');
    expect(appSource).toContain('const [proxyTestResult, setProxyTestResult]');
    expect(appSource).toContain('handleTestGlobalProxyDraft');
    expect(appSource).toContain('TestGlobalProxyConnection');
    expect(appSource).toContain('https://github.com/Syngnat/GoNavi/releases/latest');
    expect(appSource).toContain("t('app.proxy.test.action')");
    expect(appSource).toContain("t('app.proxy.test.target_placeholder')");
  });

  it('adds close and back-to-settings actions to settings center detail panes', () => {
    expect(appSource).toContain('const handleBackFromSettingsCenterPane = useCallback(() => {');
    expect(appSource).toContain('const handleCancelSettingsCenterPane = useCallback(() => {');
    expect(appSource).toContain('onClick={handleCancelSettingsCenterPane}');
    expect(appSource).toContain("t('common.close')");
    expect(appSource).toContain('onClick={handleBackFromSettingsCenterPane}');
    expect(appSource).toContain("t('common.back_to_settings')");
  });

  it('clears embedded tool transient state before switching settings groups or panes', () => {
    const cleanupStart = appSource.indexOf('const clearSettingsCenterTransientPaneState = useCallback(() => {');
    const cleanupSource = appSource.slice(
      cleanupStart,
      appSource.indexOf('const handleOpenToolsModal', cleanupStart),
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupSource).toContain('setCapturingShortcutAction(null);');
    expect(cleanupSource).toContain("activeSettingsCenterPaneRef.current?.key === 'connection-package'");
    expect(cleanupSource).toContain('closeConnectionPackageDialog();');
    expect(cleanupSource).toContain("activeSettingsCenterPaneRef.current?.key === 'ai'");
    expect(cleanupSource).toContain('setFocusedAIProviderId(undefined);');
    expect(cleanupSource).toContain('setSecurityUpdateRepairSource(null);');
    expect(appSource).toContain('const handleOpenSettingsModal = useCallback');
    expect(appSource).toContain('const handleOpenToolCenterPane = useCallback');
    expect(appSource.match(/clearSettingsCenterTransientPaneState\(\);/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('routes every security-update detail and repair return through settings center', () => {
    const openDetailsStart = appSource.indexOf('const openSecurityUpdateSettings = useCallback(');
    const openDetailsSource = appSource.slice(
      openDetailsStart,
      appSource.indexOf('const handleOpenSecurityUpdateSettings', openDetailsStart),
    );

    expect(openDetailsStart).toBeGreaterThan(-1);
    expect(openDetailsSource).toContain("setActiveSettingsCenterGroupKey('config');");
    expect(openDetailsSource).toContain("setActiveSettingsCenterPane({ key: 'security-update', group: 'config' });");
    expect(openDetailsSource).toContain('setIsSettingsModalOpen(true);');
    expect(appSource).toContain("const detailsWereOpen = isSettingsModalOpen && activeSettingsCenterPane?.key === 'security-update';");
    expect(appSource.match(/<SecurityUpdateSettingsModal/g)?.length).toBe(1);
    expect(appSource).toMatch(/<SecurityUpdateSettingsModal\r?\n\s+embedded/);
    expect(appSource).not.toContain('isSecurityUpdateSettingsOpen');
    expect(appSource).not.toContain('setIsSecurityUpdateSettingsOpen');
  });

  it('uses a consistent close footer while keeping the theme instant-apply hint', () => {
    expect(appSource).toContain("t('common.back_to_settings')");
    expect(appSource).toContain("t('common.close')");
    expect(appSource).toContain("t('app.theme.instant_apply_hint')");
  });

  it('gates the new theme layout to v2 and keeps legacy side nav for old UI', () => {
    expect(appSource).toContain('renderThemeSettingsContentV2');
    expect(appSource).toContain('renderThemeSettingsContentLegacy');
    expect(appSource).toContain('isV2Ui ? renderThemeSettingsContentV2() : renderThemeSettingsContentLegacy()');
    expect(aiSettingsModalSource).toContain("gridTemplateColumns: '168px minmax(0, 1fr)', gap: 0, padding: '10px 0'");
    expect(aiSettingsModalSource).toContain('className="ai-settings-body gonavi-ai-settings-flat"');
    expect(appSource).toContain('className="gonavi-theme-settings"');
    expect(appSource).toContain('ThemeSettingsSlider');
    expect(appSource).toContain("t('app.theme.custom.title')");
    expect(appSource).toContain('<CustomThemeManager />');
    expect(appSource).toContain('<CustomThemeManager legacyMode />');
    expect(appSource).toContain("value: 'workspace'");
    expect(appSource).toContain('gonavi-settings-tabs');
    expect(appSource).toContain('setThemeModalSection(item.value)');
  });

  it('resolves custom-theme base mode synchronously and bridges its surfaces into Ant Design', () => {
    expect(appSource).toContain("const resolvedThemeMode = effectiveThemePreference === 'system'");
    expect(appSource).toContain("const darkMode = resolvedThemeMode === 'dark';");
    expect(appSource).toContain('const customThemeStyleContextKey = `${resolvedThemeMode}:${appearance.uiVersion}`;');
    expect(appSource).toContain('colorBgContainer: (isV2Ui ? v2AntBgContainer : undefined)');
    expect(appSource).toContain('colorBgElevated: (isV2Ui ? v2AntBgElevated : undefined)');
    expect(appSource).toContain('colorTextSecondary: v2AntTextSecondary');
    expect(appSource).toContain('rowHoverBg: (isV2Ui ? v2AntRowHoverBg : undefined)');
  });

  it('opens theme, AI, and about entries inside settings center detail panes', () => {
    expect(appSource).toContain("handleOpenSettingsCenterPane('preferences', 'theme')");
    expect(appSource).toContain("handleOpenSettingsCenterPane('services', 'ai')");
    expect(appSource).toContain("handleOpenSettingsCenterPane('about', 'about-go-navi')");
    expect(appSource).toContain("if (activeSettingsCenterPane.key === 'theme')");
    expect(appSource).toContain("if (activeSettingsCenterPane.key === 'ai')");
    expect(appSource).toContain('<LazyAISettingsContent');
    expect(appSource).toContain("if (activeSettingsCenterPane.key === 'about-go-navi')");
    expect(appSource).toContain('renderSettingsCenterAboutPane()');
  });

  it('opens AI settings from the chat panel via settings center instead of a standalone modal', () => {
    expect(appSource).toContain('const handleOpenAISettings = useCallback((providerId?: string) => {');
    expect(appSource).toContain("setActiveSettingsCenterPane({ key: 'ai', group: 'services' })");
    expect(appSource).toContain('setIsSettingsModalOpen(true)');
    expect(appSource).not.toContain('setIsAISettingsOpen(true)');
    expect(appSource).not.toContain('<AISettingsModal');
  });

  it('keeps the settings center above the in-webview detached AI fallback', () => {
    const settingsModalStart = appSource.indexOf(
      "title={renderUtilityModalTitle(<SettingOutlined />, t('app.settings.title')",
    );
    const settingsModalSource = appSource.slice(settingsModalStart, settingsModalStart + 900);

    expect(settingsModalStart).toBeGreaterThan(-1);
    expect(appSource).toContain('APP_FOREGROUND_MODAL_Z_INDEX,');
    expect(appSource).toContain('APP_NESTED_MODAL_Z_INDEX,');
    expect(appSource).toContain('const settingsCenterModalZIndex = Math.max(');
    expect(appSource).toContain('Number.isFinite(detachedAIChatZIndex) ? detachedAIChatZIndex + 1 : APP_FOREGROUND_MODAL_Z_INDEX');
    expect(appSource).toContain('const settingsChildModalZIndex = Math.max(');
    expect(appSource).toContain('settingsCenterModalZIndex + 100');
    expect(settingsModalSource).toContain('zIndex={settingsCenterModalZIndex}');
  });

  it('opens the about group directly instead of showing a one-item list', () => {
    expect(appSource).toContain('const resolveSettingsCenterGroupInitialPane = (group: SettingsCenterGroupKey): SettingsCenterPaneState | null => (');
    expect(appSource).toContain("group === 'about' ? { key: 'about-go-navi', group: 'about' } : null");
    expect(appSource).toContain('setActiveSettingsCenterPane(resolveSettingsCenterGroupInitialPane(group));');
    expect(appSource).toContain('handleOpenSettingsModal(group.key);');
  });

  it('routes silent update discovery to the settings center about pane via bridge', () => {
    expect(appSource).toContain('const updateCenterBridgeRef = useRef<{');
    expect(appSource).toContain('updateCenterBridgeRef,');
    expect(appSource).toContain('updateCenterBridgeRef.current = {');
    expect(appSource).toContain("handleOpenSettingsCenterPane('about', 'about-go-navi')");
    expect(appSource).toContain('prepareAboutSurface');
    expect(appSource).toContain('isSettingsAboutPaneOpen');
  });

  it('renders the settings center about page as flat sections without nested cards', () => {
    const projectEntryStart = appSource.indexOf('const renderSettingsCenterAboutProjectEntry = ({');
    const aboutPaneStart = appSource.indexOf('const renderSettingsCenterAboutPane = () => {');
    const aboutPaneEnd = appSource.indexOf('const renderSettingsCenterAboutFooter = () => (', aboutPaneStart);
    const projectEntrySource = appSource.slice(projectEntryStart, aboutPaneStart);
    const aboutPaneSource = appSource.slice(aboutPaneStart, aboutPaneEnd);

    expect(projectEntryStart).toBeGreaterThan(-1);
    expect(aboutPaneStart).toBeGreaterThan(projectEntryStart);
    expect(aboutPaneEnd).toBeGreaterThan(aboutPaneStart);
    expect(appSource).toContain('const renderSettingsCenterAboutPane = () => {');
    expect(appSource).toContain('const renderSettingsCenterAboutProjectEntry = ({');
    expect(appSource).toContain("activeSettingsCenterPane?.key === 'about-go-navi'");
    expect(appSource).toContain("padding: '0 4px 0 0'");
    expect(appSource).toContain("border: 'none'");
    expect(appSource).toContain("background: 'transparent'");
    expect(aboutPaneSource).toContain('className="gonavi-about-pane"');
    expect(aboutPaneSource).toContain('aria-labelledby="gonavi-about-version-heading"');
    expect(aboutPaneSource).toContain('aria-labelledby="gonavi-about-project-heading"');
    expect(aboutPaneSource).toContain("gridTemplateColumns: 'minmax(0, 1.15fr) minmax(260px, 0.85fr)'");
    expect(aboutPaneSource).not.toContain('cardBorder');
    expect(aboutPaneSource).not.toContain('cardBg');
    expect(aboutPaneSource).not.toContain('borderRadius');
    expect(projectEntrySource).toContain('className="gonavi-about-project-entry"');
    expect(projectEntrySource).toContain("border: 'none'");
    expect(projectEntrySource).toContain("background: 'transparent'");
    expect(projectEntrySource).not.toContain('borderRadius');
    expect(appCssSource).toContain('.gonavi-about-project-entry:hover:not(:disabled)');
    expect(appSource).toContain('width={92}');
    expect(appSource).toContain('height={92}');
    expect(appSource).toContain('width: 92');
    expect(appSource).toContain('height: 92');
    expect(appSource).toContain('const releaseTimeText = formatAboutReleaseTime(lastUpdateInfo?.releasePublishedAt);');
    expect(appSource).toContain("[t('app.about.version.release_time'), releaseTimeText]");
    expect(appSource).toContain("installMode === 'msi' || installMode === 'portable'");
    expect(appSource).toContain("[t('app.about.version.install_mode'), t(`app.about.install_mode.${installMode}`)]");
    expect(appSource).toContain("hasUpdate && packageType !== 'unknown'");
    expect(appSource).toContain("[t('app.about.version.package_type'), t(`app.about.package_type.${packageType}`)]");
    expect(appSource).toContain('className="gonavi-about-update-channel"');
    expect(appSource).toContain('<Segmented');
    expect(appSource).toContain("t('app.about.field.auto_check_updates')");
    expect(appSource).toContain("t('app.about.field.auto_check_interval')");
    expect(appSource).toContain("t('app.about.version_update.auto_check_hint')");
    expect(appSource).toContain("t('app.about.version_update.auto_check_disabled_hint')");
    expect(appSource).toContain('className="gonavi-about-auto-check-interval"');
    expect(appSource).toContain('checked={autoCheckForUpdates}');
    expect(appSource).toContain('setAutoCheckForUpdates(checked)');
    expect(appSource).toContain('setAutoCheckForUpdatesIntervalMinutes(Number(value))');
    expect(appSource).toContain('maxWidth: 360');
    expect(appSource).toContain("alignItems: 'start'");
    expect(appSource).toContain("overflowWrap: 'anywhere'");
    expect(appSource).toContain("t('app.about.version_update.title')");
    expect(appSource).toContain("t('app.about.project.github.title')");
    expect(appSource).toContain("t('app.about.project.issues.title')");
    expect(appSource).toContain("t('app.about.project.releases.title')");
    expect(appSource).toContain('const renderSettingsCenterAboutFooter = () => (');
    expect(appSource).toContain("t('app.about.last_checked_at', { time: aboutLastCheckedAt })");
    expect(appSource).toContain('renderAboutUpdateActions()');
  });

  it('uses one flat detail shell across every settings page', () => {
    expect(appSource).toContain('const activeSettingsCenterDetailPanelStyle: React.CSSProperties = {');
    expect(appSource).toContain('style={activeSettingsCenterDetailPanelStyle}');
    expect(appSource).toContain("padding: '0 4px 0 0'");
    expect(appSource).toContain("background: 'transparent'");
    expect(aiSettingsModalSource).toContain('className="ai-settings-body gonavi-ai-settings-flat"');
    expect(aiSettingsModalSource).toContain("gap: 0, padding: '10px 0'");
    expect(aiSettingsModalSource).toContain("padding: '0 6px 24px 22px'");
  });

  it('keeps embedded split-pane settings stable at scroll boundaries', () => {
    expect(appSource).toContain('const isSettingsCenterContainedScrollPane =');
    expect(appSource).toContain("activeSettingsCenterPane?.key === 'theme' || activeSettingsCenterPane?.key === 'ai'");
    expect(appSource).toContain('const settingsCenterDetailBodyStyle: React.CSSProperties = isSettingsCenterContainedScrollPane');
    expect(appSource).toContain("overflowY: 'hidden'");
    expect(appSource).toContain('style={isActiveToolCenterPane ? toolCenterDetailBodyStyle : settingsCenterDetailBodyStyle}');
    expect(appSource).toContain("boxSizing: 'border-box'");
    expect(appSource).toContain("overscrollBehavior: 'contain'");
    expect(aiSettingsModalSource).toContain("boxSizing: 'border-box'");
    expect(aiSettingsModalSource).toContain("overscrollBehavior: 'contain'");
  });
});
