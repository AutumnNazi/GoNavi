/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import { useStore } from '../../store';
import type { PluginStatus } from '../../plugins/types';
import { usePluginWindowTools } from './usePluginWindowTools';
import TitleBarQuickActions from '../TitleBarQuickActions';
import { PLUGIN_LIFECYCLE_EVENT } from '../../plugins/events';
import { invalidatePluginContributions } from '../../plugins/invalidation';
import { useSidebarToolbarModel, type UseSidebarToolbarModelInput } from './useSidebarToolbarModel';
import { PluginPageHost } from '../../pluginPages/PluginPageHost';
import TitleBarQuickActionsHost from '../TitleBarQuickActionsHost';
import TitleBarActionRow from '../titlebar/TitleBarActionRow';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const api = vi.hoisted(() => ({ list: vi.fn(), runtimeInfo: vi.fn(), openWindow: vi.fn(), updateWindowPreferences: vi.fn() }));
const pageAPI = vi.hoisted(() => ({ pageCall: vi.fn(async () => null) }));
vi.mock('../../pluginPages/api', () => pageAPI);
vi.mock('../../plugins/api', () => ({ pluginAPI: api }));
vi.mock('../../i18n/runtime', () => ({ syncLanguageRuntime: vi.fn(async () => undefined) }));

const plugin = (id = 'example.tool', extra: Partial<PluginStatus> = {}): PluginStatus => ({
  manifest: { schemaVersion: 1, apiVersion: 1, id, name: id === 'example.tool' ? 'Log2SQL' : id, version: '1.0.0', permissions: [], window: { entry: 'index.html' } },
  digest: 'digest', generation: 1, state: 'running', desiredEnabled: true, installedAt: '', ...extra,
});
let root: Root;
let container: HTMLDivElement;
let actions: ReturnType<typeof usePluginWindowTools>;
function Probe() {
  actions = usePluginWindowTools();
  return <TitleBarQuickActions label="Tools" actions={actions} />;
}
async function mount(strict = false, preference: 'zh-CN' | 'en-US' = 'zh-CN') {
  await act(async () => {
    const content = <I18nProvider preference={preference} onPreferenceChange={() => undefined}><Probe /></I18nProvider>;
    root.render(strict ? <React.StrictMode>{content}</React.StrictMode> : content);
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.list.mockResolvedValue([plugin()]);
  api.runtimeInfo.mockResolvedValue({ safeMode: false, managementAllowed: true, webRuntime: false });
  api.openWindow.mockResolvedValue(undefined);
  api.updateWindowPreferences.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); Reflect.deleteProperty(window, '__GONAVI_WEB_RUNTIME__'); vi.useRealTimers(); vi.resetAllMocks(); });

describe('window plugin toolbar', () => {
  it.each(['success', 'failure'])('retries a hung preference update through the real open entry and ignores late %s', async (late) => {
    vi.useFakeTimers();
    useStore.setState({ theme: 'light' });
    document.body.style.setProperty('--gn-bg-panel-2', '#112233');
    const hung = deferred<void>();
    api.updateWindowPreferences.mockReturnValueOnce(hung.promise);
    await mount();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Log2SQL"]')!.click(); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(1);
    expect(api.openWindow).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(actions.some(item => item.key === 'plugin-window-failure')).toBe(true);
    expect(actions[0].disabled).toBe(false);
    document.body.style.setProperty('--gn-bg-panel-2', '#445566');
    await act(async () => { actions.find(item => item.key === 'plugin-window-retry')!.onClick?.(); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(2);
    expect(JSON.parse(api.updateWindowPreferences.mock.calls[1][0])).toMatchObject({ palette: { bg: 'rgb(68, 85, 102)' } });
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    expect(actions).toHaveLength(1);
    await act(async () => { late === 'success' ? hung.resolve() : hung.reject(new Error('plugin.backend.error.invalid_request')); });
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    expect(actions).toHaveLength(1);
    expect(actions[0].disabled).toBe(false);
    document.body.style.removeProperty('--gn-bg-panel-2');
  });
  it('keeps queued snapshots ordered and deduplicated with the latest rapid change winning', async () => {
    vi.useFakeTimers(); await mount(); api.updateWindowPreferences.mockClear();
    const first = deferred<void>();
    api.updateWindowPreferences.mockReturnValueOnce(first.promise);
    document.body.style.setProperty('--gn-bg-panel-2', '#112233');
    await act(async () => { actions[0].onClick?.(); });
    document.body.style.setProperty('--gn-bg-panel-2', '#445566');
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    document.body.style.setProperty('--gn-bg-panel-2', '#778899');
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(3);
    const sent = api.updateWindowPreferences.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(sent.map(item => item.palette.bg)).toEqual(['rgb(17, 34, 51)', 'rgb(68, 85, 102)', 'rgb(119, 136, 153)']);
    expect(sent[0].requestRevision).toBeLessThan(sent[1].requestRevision);
    expect(sent[1].requestRevision).toBeLessThan(sent[2].requestRevision);
    await act(async () => { actions[0].onClick?.(); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(3);
    document.body.style.removeProperty('--gn-bg-panel-2');
  });
  it.each(['unmount', 'disable'])('discards queued preferences on %s and keeps remount revisions increasing', async (mode) => {
    vi.useFakeTimers(); await mount(true); api.updateWindowPreferences.mockClear();
    const first = deferred<void>();
    api.updateWindowPreferences.mockReturnValueOnce(first.promise);
    document.body.style.setProperty('--gn-bg-panel-2', '#112233');
    await act(async () => { actions[0].onClick?.(); });
    const oldRevision = JSON.parse(api.updateWindowPreferences.mock.calls[0][0]).requestRevision;
    document.body.style.setProperty('--gn-bg-panel-2', '#445566');
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    if (mode === 'unmount') {
      act(() => root.unmount()); root = createRoot(container);
    } else {
      act(() => invalidatePluginContributions({ pluginId: 'example.tool', reason: 'disabled' }));
    }
    await act(async () => { first.resolve(); await vi.advanceTimersByTimeAsync(10000); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(1);
    expect(api.openWindow).not.toHaveBeenCalled();
    document.body.style.setProperty('--gn-bg-panel-2', '#778899');
    if (mode === 'unmount') await mount(true);
    else {
      api.list.mockResolvedValue([plugin('example.tool', { generation: 2 })]);
      await act(async () => window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)));
    }
    await act(async () => { actions[0].onClick?.(); });
    const newest = JSON.parse(api.updateWindowPreferences.mock.calls.at(-1)![0]);
    expect(newest.requestRevision).toBeGreaterThan(oldRevision);
    expect(newest.palette.bg).toBe('rgb(119, 136, 153)');
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    expect(actions).toHaveLength(1);
    document.body.style.removeProperty('--gn-bg-panel-2');
  });
  it('continues a stored revision across remount even when the wall clock moves backwards', async () => {
    const key = 'gonavi:plugin-window-preference-revision';
    const previous = Number(localStorage.getItem(key));
    localStorage.setItem(key, String(previous + 10000));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1);
    try {
      await mount(true);
      const first = JSON.parse(api.updateWindowPreferences.mock.calls.at(-1)![0]).requestRevision;
      expect(first).toBeGreaterThan(previous + 10000);
      act(() => root.unmount()); root = createRoot(container);
      await mount(true);
      const second = JSON.parse(api.updateWindowPreferences.mock.calls.at(-1)![0]).requestRevision;
      expect(second).toBeGreaterThan(first);
      expect(Number(localStorage.getItem(key))).toBe(second);
    } finally { clock.mockRestore(); }
  });
  it.each(['invalid', 'unavailable'])('shows a preference storage %s error rather than sending an unsafe revision', async (mode) => {
    await mount(); api.updateWindowPreferences.mockClear();
    const key = 'gonavi:plugin-window-preference-revision';
    const previous = localStorage.getItem(key);
    if (mode === 'invalid') localStorage.setItem(key, 'not-a-number');
    const spy = mode === 'unavailable' ? vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); }) : undefined;
    document.body.style.setProperty('--gn-bg-panel-2', '#112233');
    await act(async () => { actions[0].onClick?.(); });
    expect(api.updateWindowPreferences).not.toHaveBeenCalled();
    expect(api.openWindow).not.toHaveBeenCalled();
    expect(actions.some(item => item.key === 'plugin-window-failure')).toBe(true);
    spy?.mockRestore();
    if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
    await act(async () => { actions.find(item => item.key === 'plugin-window-retry')!.onClick?.(); });
    expect(api.updateWindowPreferences).toHaveBeenCalledTimes(1);
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    document.body.style.removeProperty('--gn-bg-panel-2');
  });
  it('sends current resolved colors before opening and updates light-to-light presets', async () => {
    useStore.setState({ theme: 'light' });
    document.body.style.setProperty('--gn-bg-panel-2', '#112233');
    await mount();
    api.updateWindowPreferences.mockClear();
    document.body.style.setProperty('--gn-bg-panel-2', '#445566');
    const updating = deferred<void>();
    api.updateWindowPreferences.mockReturnValueOnce(updating.promise);
    await act(async () => { actions[0].onClick?.(); });
    expect(api.updateWindowPreferences).toHaveBeenCalled();
    expect(JSON.parse(api.updateWindowPreferences.mock.calls[0][0])).toMatchObject({ theme: 'light', palette: { bg: 'rgb(68, 85, 102)' } });
    expect(api.openWindow).not.toHaveBeenCalled();
    await act(async () => { updating.resolve(); });
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    api.updateWindowPreferences.mockClear();
    document.body.style.setProperty('--gn-bg-panel-2', '#778899');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
    expect(JSON.parse(api.updateWindowPreferences.mock.calls.at(-1)![0])).toMatchObject({ theme: 'light', palette: { bg: 'rgb(119, 136, 153)' } });
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    document.body.style.removeProperty('--gn-bg-panel-2');
  });
  it('keeps page and window plugins as independent actions after AI and out of SQL tools', async () => {
    const pageTool = plugin();
    pageTool.manifest.contributes = { pages: [{ id: 'workbench', title: 'Log2SQL', html: { source: '<textarea></textarea>' } }] };
    const ssh = plugin('autumnnazi.ssh');
    ssh.manifest.name = 'GoNavi SSH';
    api.list.mockResolvedValue([pageTool, ssh, plugin('another.window')]);
    useStore.setState({ tabs: [], activeTabId: '', theme: 'light' });
    useStore.getState().setAppearance({ titlebarActionsPlacement: 'toolbar' });
    let toolbar: ReturnType<typeof useSidebarToolbarModel>;
    function WindowToolbar() {
      const placement = useStore(state => state.appearance.titlebarActionsPlacement);
      toolbar = useSidebarToolbarModel({
        treeRef: { current: null }, selectedNodesRef: { current: [] }, appearance: {}, tabs: [], connections: [],
        activeTabId: '', activeTabHasConnection: false, connectionIds: [], commandSearchFlatItems: [],
        commandSearchDestinations: { tabs: [], savedQueries: [], settings: [] },
      } as unknown as UseSidebarToolbarModelInput);
      return <>
        <TitleBarQuickActionsHost label="Tools" actions={toolbar.v2TitlebarQuickActions} />
        <TitleBarActionRow placement={placement} messageQueuePrimary={false} aiActive={false}
          onNewQuery={() => undefined} onNewConnection={() => undefined} onManageConnectionGroups={() => undefined} onToggleAI={() => undefined} />
      </>;
    }
    await act(async () => root.render(<I18nProvider preference="zh-CN" onPreferenceChange={() => undefined}><WindowToolbar /></I18nProvider>));
    const sql = toolbar!.v2TitlebarQuickActions.find(item => item.key === 'sql-tools')!;
    expect(sql.menu?.some(item => item.label === 'Log2SQL')).toBe(false);
    expect(sql.menu?.some(item => item.label === 'GoNavi SSH' || item.label === 'another.window')).toBe(false);
    expect(toolbar!.v2TitlebarQuickActions.some(item => item.label === 'Log2SQL')).toBe(true);
    expect(container.querySelector('button[aria-label="Log2SQL"]')).not.toBeNull();
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="GoNavi SSH"]');
    expect(button).not.toBeNull();
    expect(container.querySelector('button[aria-label="another.window"]')).not.toBeNull();
    expect(toolbar!.v2TitlebarQuickActions.find(item => item.label === 'GoNavi SSH')?.menu).toBeUndefined();
    expect(toolbar!.v2TitlebarQuickActions.find(item => item.label === 'GoNavi SSH')?.afterAI).toBe(true);
    expect(toolbar!.v2TitlebarQuickActions.find(item => item.label === 'Log2SQL')?.afterAI).toBe(true);
    expect(toolbar!.v2TitlebarQuickActions.find(item => item.label === 'another.window')?.afterAI).toBe(true);
    const assertPluginGroup = (labels: string[]) => {
      const ai = container.querySelector('[data-gonavi-ai-toolbar-action="true"]')!;
      const slot = container.querySelector('#gonavi-titlebar-after-ai-actions')!;
      const separators = slot.querySelectorAll('[role="separator"]');
      expect(separators).toHaveLength(labels.length ? 1 : 0);
      expect(slot.querySelectorAll('button')).toHaveLength(labels.length);
      if (labels.length) expect(ai.compareDocumentPosition(separators[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (const label of labels) {
        const buttons = container.querySelectorAll('button[aria-label="' + label + '"]');
        expect(buttons).toHaveLength(1);
        expect(slot.contains(buttons[0])).toBe(true);
        expect(separators[0].compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    };
    assertPluginGroup(['Log2SQL', 'GoNavi SSH', 'another.window']);
    const opening = deferred<void>();
    api.openWindow.mockReturnValueOnce(opening.promise);
    await act(async () => { button!.click(); button!.click(); });
    expect(api.openWindow).toHaveBeenCalledTimes(1);
    expect(api.openWindow).toHaveBeenCalledWith('autumnnazi.ssh', 'zh-CN', 'light');
    expect(button!.disabled).toBe(true);
    await act(async () => opening.resolve());
    await act(async () => { button!.click(); });
    expect(api.openWindow).toHaveBeenCalledTimes(2);
    expect(useStore.getState().tabs).toHaveLength(0);
    act(() => invalidatePluginContributions({ pluginId: 'autumnnazi.ssh', reason: 'disabled' }));
    expect(container.querySelector('button[aria-label="GoNavi SSH"]')).toBeNull();
    expect(toolbar!.v2TitlebarQuickActions.find(item => item.key === 'sql-tools')!.menu?.some(item => item.label === 'Log2SQL')).toBe(false);
    expect(container.querySelector('button[aria-label="Log2SQL"]')).not.toBeNull();
    assertPluginGroup(['Log2SQL', 'another.window']);
    await act(async () => useStore.getState().setAppearance({ titlebarActionsPlacement: 'titlebar' }));
    assertPluginGroup(['Log2SQL', 'another.window']);
    await act(async () => useStore.getState().setAppearance({ titlebarActionsPlacement: 'toolbar' }));
    assertPluginGroup(['Log2SQL', 'another.window']);
    act(() => invalidatePluginContributions({ reason: 'root' }));
    assertPluginGroup([]);
  });
  it('opens a declared page from an independent button and focuses the same store tab without a database', async () => {
    const tool = plugin();
    tool.manifest.contributes = { pages: [{ id: 'workbench', title: 'Log2SQL', html: { source: '<textarea></textarea>' } }] };
    api.list.mockResolvedValue([tool]);
    useStore.setState({ tabs: [], activeTabId: '' });
    let toolbar: ReturnType<typeof useSidebarToolbarModel>;
    function SqlToolbar() {
      toolbar = useSidebarToolbarModel({
        treeRef: { current: null }, selectedNodesRef: { current: [] }, appearance: {}, tabs: [], connections: [],
        activeTabId: '', activeTabHasConnection: false, connectionIds: [], commandSearchFlatItems: [],
        commandSearchDestinations: { tabs: [], savedQueries: [], settings: [] },
      } as unknown as UseSidebarToolbarModelInput);
      const tabs = useStore(state => state.tabs);
      return <><TitleBarQuickActions label="Tools" actions={toolbar.v2TitlebarQuickActions} />
        {tabs.map(tab => tab.pluginPage && <PluginPageHost key={tab.id} pluginID={tab.pluginPage.pluginID} pageID={tab.pluginPage.pageID} />)}
      </>;
    }
    await act(async () => root.render(<I18nProvider preference="zh-CN" onPreferenceChange={() => undefined}><SqlToolbar /></I18nProvider>));
    const sql = toolbar!.v2TitlebarQuickActions.find(item => item.key === 'sql-tools')!;
    const entry = toolbar!.v2TitlebarQuickActions.find(item => item.label === 'Log2SQL');
    expect(sql.menu?.some(item => item.label === 'Log2SQL')).toBe(false);
    expect(entry).toBeDefined();
    expect(entry?.disabled).toBe(false);
    expect(entry?.menu).toBeUndefined();
    expect(entry?.afterAI).toBe(true);
    expect(container.querySelector('button[aria-label="Log2SQL"]')).not.toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Log2SQL"]')!.click(); });
    expect(api.openWindow).not.toHaveBeenCalled();
    const tab = useStore.getState().tabs[0];
    expect(tab).toMatchObject({ id: 'plugin-page:example.tool:workbench', type: 'plugin-page', connectionId: '' });
    const frame = container.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    const srcDoc = frame.srcdoc;
    const input = frame.contentDocument!.createElement('textarea');
    frame.contentDocument!.body.append(input); input.value = 'keep logs';
    act(() => useStore.setState({ activeTabId: 'other' }));
    await act(async () => { entry!.onClick?.(); });
    expect(useStore.getState().tabs).toHaveLength(1);
    expect(useStore.getState().activeTabId).toBe(tab.id);
    expect(container.querySelector('iframe')).toBe(frame); expect(frame.srcdoc).toBe(srcDoc);
    expect(input.value).toBe('keep logs'); expect(frame.contentDocument!.body.contains(input)).toBe(true);
    const sourceWindow = frame.contentWindow;
    act(() => invalidatePluginContributions({ pluginId: 'example.tool', reason: 'disabled' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(toolbar!.v2TitlebarQuickActions.find(item => item.key === 'sql-tools')!.menu?.some(item => item.label === 'Log2SQL')).toBe(false);
    const token = /var token = "([^"]+)"/.exec(srcDoc)![1];
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: sourceWindow, data: { type: 'gonavi:page-call', token, id: 'late', method: 'plugin.invoke', arguments: { command: 'saveSettings' } } })); });
    expect(container.querySelector('iframe')).toBeNull();
    expect(pageAPI.pageCall).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(container.querySelector('iframe')).toBeNull();
  });
  it('does not add a placeholder when discovery fails before any tool is installed', async () => {
    api.list.mockRejectedValueOnce(new Error('plugin.backend.error.operation_failed'));
    await mount();
    expect(actions).toHaveLength(0);
    expect(container.querySelector('button')).toBeNull();
  });
  it('does not add a placeholder when initial discovery times out', async () => {
    vi.useFakeTimers(); api.list.mockReturnValueOnce(new Promise(() => undefined));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(actions).toHaveLength(0);
    expect(container.querySelector('button')).toBeNull();
  });
  it('adds a button only after installation and enable, and removes it on uninstall', async () => {
    api.list.mockResolvedValue([]);
    await mount();
    expect(actions).toHaveLength(0);
    api.list.mockResolvedValue([plugin('example.tool', { state: 'disabled', desiredEnabled: false })]);
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(actions).toHaveLength(0);
    api.list.mockResolvedValue([plugin()]);
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(actions[0]?.label).toBe('Log2SQL');
    act(() => { invalidatePluginContributions({ pluginId: 'example.tool', reason: 'removed' }); });
    expect(actions).toHaveLength(0);
    api.list.mockRejectedValueOnce(new Error('plugin.backend.error.operation_failed'));
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(actions).toHaveLength(0);
    expect(container.querySelector('button')).toBeNull();
    api.list.mockResolvedValue([]);
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(actions).toHaveLength(0);
  });
  it('does not restore a placeholder after an empty installed-plugin snapshot', async () => {
    await mount();
    api.list.mockResolvedValue([]);
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    api.list.mockRejectedValueOnce(new Error('plugin.backend.error.operation_failed'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(actions).toHaveLength(0);
    expect(container.querySelector('button')).toBeNull();
  });
  it('returns multiple plugins as independent actions without a plugin menu', async () => {
    api.list.mockResolvedValue([plugin(), plugin('example.other')]);
    await mount();
    expect(actions.map(item => item.label)).toEqual(['Log2SQL', 'example.other']);
    expect(actions.every(item => item.menu === undefined)).toBe(true);
  });
  it.each(['safe', 'management'])('does not expose declared pages in %s mode', async mode => {
    const tool = plugin(); tool.manifest.contributes = { pages: [{ id: 'main', title: 'Main', html: { source: '<input>' } }] };
    api.list.mockResolvedValue([tool]);
    api.runtimeInfo.mockResolvedValue({ safeMode: mode === 'safe', managementAllowed: mode !== 'management' });
    await mount(); expect(actions).toHaveLength(0);
  });
  it('uses the first usable declared page rather than a hardcoded workbench id', async () => {
    const tool = plugin(); tool.manifest.contributes = { pages: [{ id: 'invalid', title: 'No content' }, { id: 'custom-main', title: 'Main', body: { type: 'text', text: 'hello' } }] };
    api.list.mockResolvedValue([tool]); useStore.setState({ tabs: [], activeTabId: '' });
    await mount(); await act(async () => { actions[0].onClick?.(); });
    expect(useStore.getState().tabs[0]?.id).toBe('plugin-page:example.tool:custom-main');
    expect(api.openWindow).not.toHaveBeenCalled();
  });
  it.each(['host-web', 'local-web'])('keeps declared pages usable but not window fallback in %s', async (runtime) => {
    const pageTool = plugin('page.only');
    pageTool.manifest.window = undefined;
    pageTool.manifest.contributes = { pages: [{ id: 'primary', title: 'Primary', html: { source: '<input>' } }] };
    api.list.mockResolvedValue([pageTool, plugin()]);
    if (runtime === 'host-web') api.runtimeInfo.mockResolvedValue({ safeMode: false, managementAllowed: true, webRuntime: true });
    else Object.assign(window, { __GONAVI_WEB_RUNTIME__: { buildType: 'web' } });
    useStore.setState({ tabs: [], activeTabId: '' });
    await mount();
    expect(actions.map(item => item.label)).toEqual(['page.only']);
    await act(async () => { actions[0].onClick?.(); });
    expect(useStore.getState().tabs[0]?.id).toBe('plugin-page:page.only:primary');
    expect(api.openWindow).not.toHaveBeenCalled();
  });
  it.each(['empty', 'no-window', 'disabled', 'starting', 'faulted', 'safe', 'management', 'web', 'local-web'])('hides unavailable tools: %s', async (condition) => {
    if (condition === 'empty') api.list.mockResolvedValue([]);
    if (condition === 'no-window') api.list.mockResolvedValue([plugin('x', { manifest: { ...plugin().manifest, window: undefined } })]);
    if (condition === 'disabled') api.list.mockResolvedValue([plugin('x', { desiredEnabled: false })]);
    if (condition === 'starting' || condition === 'faulted') api.list.mockResolvedValue([plugin('x', { state: condition })]);
    if (['safe', 'management', 'web'].includes(condition)) api.runtimeInfo.mockResolvedValue({ safeMode: condition === 'safe', managementAllowed: condition !== 'management', webRuntime: condition === 'web' });
    if (condition === 'local-web') Object.assign(window, { __GONAVI_WEB_RUNTIME__: { buildType: 'web' } });
    await mount();
    expect(actions).toHaveLength(0);
    expect(container.querySelector('button')).toBeNull();
    if (condition === 'local-web') { expect(api.list).toHaveBeenCalled(); Reflect.deleteProperty(window, '__GONAVI_WEB_RUNTIME__'); }
  });
  it('refreshes on focus and lifecycle, dropping obsolete tools before the response', async () => {
    await mount();
    const next = deferred<PluginStatus[]>(); api.list.mockReturnValueOnce(next.promise);
    act(() => window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)));
    expect(actions).toHaveLength(0);
    await act(async () => { next.resolve([plugin(), plugin('second')]); });
    expect(actions).toHaveLength(2);
    api.list.mockResolvedValue([]);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(actions).toHaveLength(0);
  });
  it('does not let an old request replace a newer lifecycle snapshot', async () => {
    const old = deferred<PluginStatus[]>(); api.list.mockReturnValueOnce(old.promise);
    await mount();
    api.list.mockResolvedValue([plugin('new')]);
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(actions[0]?.label).toBe('new');
    await act(async () => { old.resolve([plugin()]); });
    expect(actions[0]?.label).toBe('new');
  });
  it('revokes a tool immediately and does not revive the old enabled generation', async () => {
    await mount(); const staleClick = actions[0].onClick;
    act(() => invalidatePluginContributions({ pluginId: 'example.tool', reason: 'disabled' }));
    expect(actions).toHaveLength(0);
    await act(async () => { staleClick?.(); window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(api.openWindow).not.toHaveBeenCalled(); expect(actions).toHaveLength(0);
    api.list.mockResolvedValue([plugin('example.tool', { generation: 2 })]);
    await act(async () => window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)));
    expect(actions[0]?.label).toBe('Log2SQL');
  });
  it('tracks starting to running with a short bounded startup refresh', async () => {
    vi.useFakeTimers(); api.list.mockResolvedValueOnce([plugin('example.tool', { state: 'starting' })]);
    await mount(); expect(actions).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(actions[0]?.label).toBe('Log2SQL');
    const count = api.list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(api.list).toHaveBeenCalledTimes(count);
    vi.useRealTimers();
  });
  it('times out a hung list with visible retry and ignores its late result', async () => {
    vi.useFakeTimers(); await mount();
    const hung = deferred<PluginStatus[]>(); api.list.mockReturnValueOnce(hung.promise);
    await act(async () => { window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(actions.find((item) => !item.disabled)?.label).toBe('重试');
    const retry = actions.find((item) => !item.disabled)!;
    await act(async () => { retry.onClick?.(); });
    expect(actions[0].label).toBe('Log2SQL');
    await act(async () => { hung.resolve([plugin('late')]); });
    expect(actions[0].label).toBe('Log2SQL');
  });
  it('shows a localized list failure, removes old tools, and retries', async () => {
    await mount(); api.list.mockRejectedValueOnce(new Error('plugin.backend.error.operation_failed'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(container.querySelector('[aria-label="Log2SQL"]')).toBeNull();
    expect(actions[0]?.label).not.toContain('plugin.');
    const retry = actions.find((item) => !item.disabled); expect(retry?.label).toBe('重试');
    await act(async () => { retry?.onClick?.(); });
    expect(actions[0].label).toBe('Log2SQL');
  });
  it('cleans up StrictMode requests and listeners, ignoring the first late request', async () => {
    const old = deferred<PluginStatus[]>(); api.list.mockReturnValueOnce(old.promise).mockResolvedValue([plugin('strict')]);
    await mount(true); expect(actions[0]?.label).toBe('strict');
    await act(async () => { old.resolve([plugin()]); });
    expect(actions[0]?.label).toBe('strict');
    act(() => root.unmount()); const calls = api.list.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)); });
    expect(api.list).toHaveBeenCalledTimes(calls);
    root = createRoot(container);
  });
  it('deduplicates busy opens and shows an opening failure with recovery', async () => {
    const opened = deferred<void>(); api.openWindow.mockReturnValueOnce(opened.promise); await mount();
    const click = actions[0].onClick!;
    await act(async () => { click(); click(); });
    expect(api.openWindow).toHaveBeenCalledTimes(1); expect(actions[0].disabled).toBe(true);
    await act(async () => { opened.reject(new Error('plugin.backend.error.window_unavailable')); });
    expect(actions[0].disabled).toBe(false);
    expect(actions.some((item) => item.label === '重试')).toBe(true);
    await act(async () => { actions[0].onClick?.(); });
    expect(api.openWindow).toHaveBeenCalledTimes(2);
  });
  it('does not show a late open error after replacement or disable', async () => {
    const opened = deferred<void>(); api.openWindow.mockReturnValueOnce(opened.promise); await mount();
    await act(async () => { actions[0].onClick?.(); });
    api.list.mockResolvedValue([plugin('new')]);
    await act(async () => window.dispatchEvent(new Event(PLUGIN_LIFECYCLE_EVENT)));
    await act(async () => { opened.reject(new Error('plugin.backend.error.window_unavailable')); });
    expect(actions).toHaveLength(1); expect(actions[0].label).toBe('new');
  });
  it('uses the current resolved provider language and latest store theme', async () => {
    await mount(); await mount(false, 'en-US'); useStore.setState({ theme: 'dark' });
    await act(async () => { actions[0].onClick?.(); });
    expect(api.openWindow).toHaveBeenLastCalledWith('example.tool', 'en-US', 'dark');
  });
  it('opens a single named window tool without a selected database', async () => {
    useStore.setState({ theme: 'light' });
    await mount();
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Log2SQL"]');
    expect(button).not.toBeNull();
    expect(actions).toHaveLength(1);
    expect(actions[0].menu).toBeUndefined();
    await act(async () => { button!.click(); });
    expect(api.openWindow).toHaveBeenCalledWith('example.tool', 'zh-CN', 'light');
  });
});
