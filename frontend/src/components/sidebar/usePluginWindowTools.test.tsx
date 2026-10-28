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

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const api = vi.hoisted(() => ({ list: vi.fn(), runtimeInfo: vi.fn(), openWindow: vi.fn() }));
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
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); Reflect.deleteProperty(window, '__GONAVI_WEB_RUNTIME__'); vi.useRealTimers(); vi.resetAllMocks(); });

describe('window plugin toolbar', () => {
  it('opens a declared page inside SQL tools and focuses the same store tab without a database', async () => {
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
    const entry = sql.menu?.find(item => item.label === 'Log2SQL');
    expect(entry).toBeDefined();
    expect(entry?.disabled).toBe(false);
    expect(entry?.menu).toBeUndefined();
    expect(toolbar!.v2TitlebarQuickActions.some(item => item.label === 'Log2SQL')).toBe(false);
    expect(container.querySelector('button[aria-label="Log2SQL"]')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-titlebar-quick-menu="sql-tools"]')!.click(); });
    const menuEntry = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === 'Log2SQL');
    expect(menuEntry).toBeDefined();
    await act(async () => { menuEntry!.click(); });
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
  it('returns multiple tools as direct SQL menu entries without a second plugin menu', async () => {
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
    act(() => { click(); click(); });
    expect(api.openWindow).toHaveBeenCalledTimes(1); expect(actions[0].disabled).toBe(true);
    await act(async () => { opened.reject(new Error('plugin.backend.error.window_unavailable')); });
    expect(actions[0].disabled).toBe(false);
    expect(actions.some((item) => item.label === '重试')).toBe(true);
    await act(async () => { actions[0].onClick?.(); });
    expect(api.openWindow).toHaveBeenCalledTimes(2);
  });
  it('does not show a late open error after replacement or disable', async () => {
    const opened = deferred<void>(); api.openWindow.mockReturnValueOnce(opened.promise); await mount();
    act(() => actions[0].onClick?.());
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
