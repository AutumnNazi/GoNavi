import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.tsx', import.meta.url)),
  'utf8',
);

describe('UI version switch placement', () => {
  it('loads the v2 theme stylesheet with the app shell', () => {
    expect(appSource).toContain("import './App.css';");
    expect(appSource).toContain("import './v2-theme.css';");
  });

  it('keeps light/dark first with compact previews and UI version preview tiles', () => {
    const themeBranchIndex = appSource.indexOf("{themeModalSection === 'theme' ? (");
    const lightThemeIndex = appSource.indexOf("t('app.theme.mode.light.label')", themeBranchIndex);
    const customThemeIndex = appSource.indexOf("t('app.theme.custom.title')", lightThemeIndex);
    const uiVersionIndex = appSource.indexOf("t('app.theme.ui_version.title')", themeBranchIndex);
    const appearanceBranchIndex = appSource.indexOf(") : themeModalSection === 'appearance' ? (", themeBranchIndex);
    const macWindowIndex = appSource.indexOf("t('app.theme.mac_window.title')");

    expect(themeBranchIndex).toBeGreaterThan(-1);
    expect(lightThemeIndex).toBeGreaterThan(themeBranchIndex);
    expect(customThemeIndex).toBeGreaterThan(lightThemeIndex);
    expect(customThemeIndex).toBeLessThan(uiVersionIndex);
    expect(uiVersionIndex).toBeGreaterThan(lightThemeIndex);
    expect(uiVersionIndex).toBeLessThan(appearanceBranchIndex);
    expect(macWindowIndex).toBeGreaterThan(uiVersionIndex);
    expect(appSource).toContain('renderUiVersionPreview');
    expect(appSource).toContain('gonavi-settings-ui-version-grid');
    expect(appSource).toContain("onClick={() => setAppearance({ uiVersion: item.key })}");
    expect(appSource).toContain("t('app.theme.ui_version.beta_warning')");
    expect(appSource).toContain("t('app.theme.ui_version.platform_hint')");
    expect(appSource).toContain("t('app.theme.ui_version.sidebar_search.title')");
    expect(appSource).toContain("value={appearance.v2SidebarSearchMode ?? 'command'}");
    expect(appSource).toContain("setAppearance({ v2SidebarSearchMode: value as 'command' | 'filter' })");
    expect(appSource).toContain("appearance.uiVersion === 'v2' ? (");
  });

  it('uses compact previews only in v2 theme settings layout', () => {
    expect(appSource).toContain('renderThemeSettingsContentV2');
    expect(appSource).toContain('renderThemeSettingsContentLegacy');
    expect(appSource).toContain('isV2Ui ? renderThemeSettingsContentV2() : renderThemeSettingsContentLegacy()');
    expect(appSource).toContain('className="gonavi-theme-settings"');
    expect(appSource).toContain('gonavi-settings-mode-grid');
    expect(appSource).toContain('gonavi-settings-mode-tile');
    expect(appSource).toContain('renderThemeModePreview');
    expect(appSource).toContain("preview: 'light' as const");
    expect(appSource).toContain('ThemeSettingsSlider');
    expect(appSource).toContain("unit=\"percent\"");
    expect(appSource).toContain('gonavi-settings-tabs');
    expect(appSource).toContain('gonavi-settings-tab');
    expect(appSource).toContain('gonavi-settings-pill');
    expect(appSource).toContain('<CustomThemeManager />');
    expect(appSource).toContain('<CustomThemeManager legacyMode />');
    // 旧版布局仍保留侧栏导航
    expect(appSource).toContain("gridTemplateColumns: '180px minmax(0, 1fr)', gap: 16, padding: '12px 0'");
  });

  it('keeps theme and UI version radio tiles on one tab stop with complete keyboard navigation', () => {
    const themeBranchIndex = appSource.indexOf("{themeModalSection === 'theme' ? (");
    const appearanceBranchIndex = appSource.indexOf(") : themeModalSection === 'appearance' ? (", themeBranchIndex);
    const themeSource = appSource.slice(themeBranchIndex, appearanceBranchIndex);

    expect(themeSource).toContain(']).map((item, itemIndex, themeItems) => {');
    expect(themeSource).toContain('tabIndex={themePreference === item.key ? 0 : -1}');
    expect(themeSource).toContain('selectPresetTheme(themeItems[nextIndex].key);');
    expect(themeSource).toContain(']).map((item, itemIndex, uiVersionItems) => {');
    expect(themeSource).toContain('tabIndex={active ? 0 : -1}');
    expect(themeSource).toContain('setAppearance({ uiVersion: uiVersionItems[nextIndex].key });');
    expect(themeSource.match(/\['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'\]/g)).toHaveLength(2);
    expect(themeSource.match(/querySelectorAll<HTMLElement>\('\[role="radio"\]'\)/g)).toHaveLength(2);
  });

  it('isolates workspace settings and remembers the active section', () => {
    expect(appSource).toContain("value: 'workspace'");
    expect(appSource).toContain("t('app.theme.nav.workspace.title')");
    expect(appSource).toContain("setThemeModalSection('workspace')");
    expect(appSource).toContain("themeModalSection !== 'workspace'");
    expect(appSource).toContain('gonavi.themeSettingsSection');
  });

  it('localizes the v2 sidebar search mode copy', () => {
    expect(appSource).toContain("t('app.theme.ui_version.sidebar_search.title')");
    expect(appSource).toContain("t('app.theme.ui_version.sidebar_search.command')");
    expect(appSource).toContain("t('app.theme.ui_version.sidebar_search.filter')");
    expect(appSource).toContain("t('app.theme.ui_version.sidebar_search.hint')");
    expect(appSource).not.toContain('新版左侧搜索模式');
    expect(appSource).not.toContain('新版命令搜索');
    expect(appSource).not.toContain('旧版侧栏筛选');
    expect(appSource).not.toContain('新版命令搜索适合跳转连接、表和动作');
  });
});
