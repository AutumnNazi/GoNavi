import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ PluginList: vi.fn(), PluginRuntimeInfo: vi.fn() }));
vi.mock('../../../wailsjs/go/app/App', () => host);
const opener = vi.hoisted(() => ({ openPluginPageTab: vi.fn() }));
vi.mock('../../pluginPages/openPluginPageTab', () => opener);
vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import type { PluginNavigation, PluginPage, PluginStatus } from '../../plugins/types';
import type { TitleBarQuickAction } from '../TitleBarQuickActions';
import { collectPluginNavigation, usePluginPagesTitlebarMenu } from './usePluginPagesTitlebarMenu';

const page = (id: string): PluginPage => ({ id, title: id, body: { type: 'text', text: 'hi' } });
const nav = (id: string, target: string, order?: number): PluginNavigation =>
  ({ id, title: id, page: target, location: 'tools', ...(order === undefined ? {} : { order }) });
const status = (
  id: string,
  name: string,
  navigation: PluginNavigation[],
  pages: PluginPage[] = navigation.map((entry) => page(entry.page)),
  state: PluginStatus['state'] = 'running',
): PluginStatus => ({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    id,
    name,
    version: '1.0.0',
    permissions: ['ui.pages'],
    contributes: { pages, navigation },
  },
  digest: 'a'.repeat(64),
  state,
  desiredEnabled: state !== 'disabled',
  generation: 1,
  installedAt: '2026-01-01',
});

const captured: { action?: TitleBarQuickAction } = {};
const Harness = () => {
  captured.action = usePluginPagesTitlebarMenu();
  return null;
};
let renderer: ReactTestRenderer | undefined;

const render = () => {
  act(() => {
    renderer = create(<Harness />);
  });
  return captured.action!;
};
const openMenu = async () => {
  await act(async () => {
    captured.action?.onMenuOpen?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  captured.action = undefined;
  host.PluginList.mockReset();
  host.PluginRuntimeInfo.mockReset();
  host.PluginRuntimeInfo.mockResolvedValue({
    success: true,
    data: { safeMode: false, managementAllowed: true, webRuntime: false },
  });
  opener.openPluginPageTab.mockReset();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('usePluginPagesTitlebarMenu', () => {
  it('does not read the plugin list before the menu is opened', () => {
    render();
    expect(host.PluginList).not.toHaveBeenCalled();
    expect(host.PluginRuntimeInfo).not.toHaveBeenCalled();
    expect(captured.action?.menu).toEqual([]);
  });

  it('loads running plugins with location=tools entries on the first open', async () => {
    host.PluginList.mockResolvedValue({
      success: true,
      data: [
        status('test.pages', 'Pages', [nav('second', 'b', 10), nav('first', 'a', -5)]),
        status('test.stopped', 'Stopped', [nav('hidden', 'x')], undefined, 'disabled'),
      ],
    });
    render();
    await openMenu();
    expect(host.PluginList).toHaveBeenCalledTimes(1);
    const menu = captured.action?.menu ?? [];
    expect(menu.map((item) => item.label)).toEqual(['Pages · first', 'Pages · second']);
    expect(menu.map((item) => item.key)).toEqual([
      'plugin-page:test.pages:first',
      'plugin-page:test.pages:second',
    ]);
  });

  it('opens the workbench tab with the navigation title', async () => {
    host.PluginList.mockResolvedValue({
      success: true,
      data: [status('test.pages', 'Pages', [{ ...nav('overview-tools', 'overview'), title: 'Overview page' }])],
    });
    render();
    await openMenu();
    captured.action?.menu?.[0].onClick?.();
    expect(opener.openPluginPageTab).toHaveBeenCalledWith({
      pluginID: 'test.pages',
      pageID: 'overview',
      title: 'Overview page',
    });
  });

  it('shows the localized empty state when no running plugin declares a page', async () => {
    host.PluginList.mockResolvedValue({ success: true, data: [status('test.pages', 'Pages', [], [])] });
    render();
    await openMenu();
    expect(captured.action?.menu).toEqual([]);
    expect(captured.action?.emptyMenuLabel).toBe('plugin.pages.empty');
  });

  it('shows loading while the first read is in flight', async () => {
    host.PluginList.mockReturnValue(new Promise(() => undefined));
    render();
    await openMenu();
    expect(captured.action?.emptyMenuLabel).toBe('plugin.pages.loading');
  });

  it('shows the unavailable state when the host read fails', async () => {
    host.PluginList.mockResolvedValue({ success: false, message: 'host down' });
    render();
    await openMenu();
    expect(captured.action?.emptyMenuLabel).toBe('plugin.pages.unavailable');
    expect(captured.action?.menu).toEqual([]);
  });

  it('offers no page entry when a web session disables plugin management', async () => {
    host.PluginRuntimeInfo.mockResolvedValue({
      success: true,
      data: { safeMode: false, managementAllowed: false, webRuntime: true },
    });
    host.PluginList.mockResolvedValue({ success: true, data: [status('test.pages', 'Pages', [nav('a', 'a')])] });
    render();
    await openMenu();
    expect(captured.action?.menu).toEqual([]);
    expect(captured.action?.emptyMenuLabel).toBe('plugin.pages.web_unavailable');
  });

  it('refreshes the menu on a later open so lifecycle changes are reflected', async () => {
    host.PluginList.mockResolvedValue({ success: true, data: [status('test.pages', 'Pages', [nav('a', 'a')])] });
    render();
    await openMenu();
    expect(captured.action?.menu).toHaveLength(1);
    host.PluginList.mockResolvedValue({ success: true, data: [] });
    await openMenu();
    expect(host.PluginList).toHaveBeenCalledTimes(2);
    expect(captured.action?.menu).toEqual([]);
  });
});

describe('collectPluginNavigation', () => {
  it('keeps only running plugins, declared tools pages, and per-plugin order', () => {
    const items = collectPluginNavigation([
      status('test.pages', 'Pages', [nav('late', 'b', 5), nav('early', 'a', -1), nav('undeclared', 'missing')], [page('a'), page('b')]),
      status('test.stopped', 'Stopped', [nav('hidden', 'x')], undefined, 'disabled'),
    ]);
    expect(items.map((item) => item.navigationID)).toEqual(['early', 'late']);
  });
});
