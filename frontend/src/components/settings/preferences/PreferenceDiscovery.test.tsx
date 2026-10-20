import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../store';
import { DEFAULT_APPEARANCE } from '../../../store/storeConstants';
import { PreferencePage } from './PreferencePage';
import { QuickPreferencePanel } from './QuickPreferences';
import { PREFERENCE_PAGES, OPEN_PREFERENCE_PAGE } from './preferencePages';
import { resolveSettingsCenterGroupInitialPane } from '../../../appShell/settingsCenterPanes';
import { routePreferenceSearchEntry } from './preferenceSearchRouting';
import { filterSettingsCenterTreeGroups } from '../settingsCenterTreeSearchModel';
import { t } from '../../../i18n';

vi.mock('./livePreview/PreviewSurface', () => ({ PreviewSurface: () => <div /> }));
vi.mock('antd', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  Switch: ({ checked, onChange, ...props }: { checked: boolean; onChange: (checked: boolean) => void }) => <input {...props} type="checkbox" checked={checked} onChange={() => onChange(!checked)} />,
  Select: ({ value, onChange, options, ...props }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) => <select {...props} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
  Checkbox: ({ checked, onChange, children }: { checked: boolean; onChange: (event: { target: { checked: boolean } }) => void; children: React.ReactNode }) => <label><input type="checkbox" checked={checked} onChange={() => onChange({ target: { checked: !checked } })} />{children}</label>,
  InputNumber: ({ value }: { value: number }) => <input type="number" value={value} readOnly />,
  Popover: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../TitlebarActionsPlacementSettings', () => ({ default: () => <div /> }));
vi.mock('../SidebarLayoutSettings', () => ({ SidebarActionsPlacementSettings: () => <div />, SidebarSearchModeSettings: () => <div /> }));
beforeEach(() => useStore.setState({ appearance: { ...DEFAULT_APPEARANCE } }));
const renderTheme = vi.fn(() => <div />);
const renderPage = (page: typeof PREFERENCE_PAGES[number]) => <PreferencePage page={page} renderTheme={renderTheme} metadata={() => <div />} objects={() => <div />} />;

describe('discoverable preferences', () => {
  it('opens common settings by default and gives each category a direct destination', () => {
    expect(resolveSettingsCenterGroupInitialPane('common-settings')).toEqual({ group: 'common-settings', key: 'common-settings' });
    for (const page of PREFERENCE_PAGES) expect(resolveSettingsCenterGroupInitialPane(page)).toEqual({ group: page, key: page });
  });
  it('offers eight editable settings on the common page and shares values with quick settings', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(<>{renderPage('common-settings')}<QuickPreferencePanel area="toolbar" /></>); });
    const toggles = view.root.findAll(node => node.type === 'input' && node.props['aria-label'] === t('app.theme.appearance.navicat_layout_title'));
    expect(toggles).toHaveLength(2);
    expect(toggles[0].props.checked).toBe(false);
    act(() => toggles[0].props.onChange());
    expect(toggles[1].props.checked).toBe(true);
    expect(useStore.getState().appearance.uiLayoutMode).toBe('navicat');
    expect(view.root.findByProps({ 'data-settings-page': 'common-settings' }).findAll(node => !!node.props['data-preference-control'])).toHaveLength(8);
    act(() => view.unmount());
  });
  it('routes detail categories to their dedicated existing controls', () => {
    let view!: ReactTestRenderer;
    act(() => { view = create(renderPage('tabs-settings')); });
    expect(renderTheme).toHaveBeenLastCalledWith({ hideSectionTabs: true, section: 'workspace', page: 'tabs-settings' });
    act(() => view.update(renderPage('fonts-settings')));
    expect(renderTheme).toHaveBeenLastCalledWith({ hideSectionTabs: true, section: 'appearance', page: 'fonts-settings' });
    act(() => view.unmount());
  });
  it('finds a control on a flat root category and opens that exact category', () => {
    const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent });
    const entry = routePreferenceSearchEntry({ group: 'preferences', item: 'theme-appearance', labelKey: 'app.theme.appearance.workbench_sidebar_auto_collapse_title' });
    const groups = filterSettingsCenterTreeGroups([{ key: 'sidebar-settings', title: 'Side navigation', description: '', items: [] }], '自动折叠', { entries: [entry], translate: key => t(key, undefined, 'zh-CN') });
    expect(groups).toHaveLength(1);
    groups[0].items[0].onClick();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: OPEN_PREFERENCE_PAGE, detail: 'sidebar-settings' }));
    vi.unstubAllGlobals();
  });
});
