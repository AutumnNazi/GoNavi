import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketAccount } from './useMarketAccount';
import type { MarketPlugin } from './types';
const state = vi.hoisted(() => ({ account: {} as MarketAccount, catalog: {} as ReturnType<typeof import('./useMarketCatalog').useMarketCatalog> }));
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? key + ' ' + Object.values(params).join(' ') : key }) }));
vi.mock('./useMarketAccount', () => ({ useMarketAccount: () => state.account }));
vi.mock('./useMarketCatalog', () => ({ useMarketCatalog: () => state.catalog }));
vi.mock('./useInstalledPluginVersions', () => ({ useInstalledPluginVersions: () => ({ installed: new Map(), refresh: vi.fn() }) }));
vi.mock('./MarketDetailDrawer', () => ({ MarketDetailDrawer: () => null }));
vi.mock('./MarketPublishModal', () => ({ MarketPublishModal: () => null }));
vi.mock('../../wailsjs/runtime', () => ({ BrowserOpenURL: vi.fn() }));
vi.mock('antd', () => {
  const element = (name: string) => ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('div', { ...props, 'data-component': name }, children);
  return { Alert: element('alert'), Button: element('button'), Empty: Object.assign(element('empty'), { PRESENTED_IMAGE_SIMPLE: 'simple' }),
    Input: Object.assign(element('input'), { Search: element('search') }), Select: element('select'), Spin: element('spin'),
    Popover: element('popover'), Space: element('space'), Rate: element('rate'), Tag: element('tag'),
    Typography: { Text: element('text'), Title: element('title'), Paragraph: element('paragraph') } };
});
vi.mock('@ant-design/icons', () => ({ ArrowUpOutlined: () => null, SafetyCertificateOutlined: () => null, ReloadOutlined: () => null, SettingOutlined: () => null }));
import { PluginMarketPanel } from './PluginMarketPanel';
const plugin: MarketPlugin = { id: 'com.gonavi.nginx-inspector', name: 'Nginx Inspector', version: '1.0.0', author: 'GoNavi', description: 'Nginx diagnostics',
  publisherId: 'com.gonavi', official: true, minHostVersion: '1.1.5', platforms: ['windows/amd64'], ratingAverage: 0, ratingCount: 0, downloadCount: 0, updatedAt: 'now' };
let renderer: ReturnType<typeof create> | undefined;
const components = (name: string) => renderer!.root.findAllByProps({ 'data-component': name });
const button = (key: string) => components('button').find((node) => node.props.children === key)!;
async function mount(allowed = true) { await act(async () => { renderer = create(<PluginMarketPanel allowed={allowed} onInstalled={vi.fn()} />); }); }
beforeEach(() => {
  state.account = { settings: { baseUrl: 'https://plugin.gonavi.org', authenticated: false, trustedOfficial: true },
    login: null, status: '', error: '', busy: false, revision: 0, refresh: vi.fn(), start: vi.fn(), cancel: vi.fn(), configure: vi.fn(), logout: vi.fn() };
  state.catalog = { query: '', setQuery: vi.fn(), sort: 'updated', setSort: vi.fn(), items: [plugin], nextCursor: '', loading: false,
    error: '', warning: '', stale: false, cachedAt: '', reload: vi.fn(), more: vi.fn() };
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });
describe('compact market workspace', () => {
  it('keeps source editing in a click popover and exposes release requirements', async () => {
    await mount();
    expect(components('popover')[0].props.trigger).toBe('click');
    expect(components('input')).toHaveLength(0);
    expect(renderer!.root.findByProps({ className: 'plugin-market-requirement' }).props.children).toBe('plugin.market.requires_host 1.1.5');
    expect(components('search')).toHaveLength(1);
  });
  it('refreshes the catalog as well as account settings', async () => {
    await mount(); await act(async () => { button('plugin.action.refresh').props.onClick(); });
    expect(state.catalog.reload).toHaveBeenCalledOnce(); expect(state.account.refresh).toHaveBeenCalledOnce();
  });
  it('clears unsuccessful searches without confusing them with an empty market', async () => {
    state.catalog.items = []; state.catalog.query = 'missing'; await mount();
    expect(components('empty')[0].props.description).toBe('plugin.market.empty_search');
    await act(async () => { button('plugin.market.reset_search').props.onClick(); });
    expect(state.catalog.setQuery).toHaveBeenCalledWith('');
  });
  it.each(['loading', 'error'] as const)('does not show a misleading empty state while %s', async (mode) => {
    state.catalog.items = [];
    if (mode === 'loading') state.catalog.loading = true; else state.catalog.error = 'offline';
    await mount(); expect(components('empty')).toHaveLength(0);
    expect(components(mode === 'loading' ? 'spin' : 'alert')).toHaveLength(1);
  });
  it('shows a configuration hint instead of a published-empty message when disabled', async () => {
    state.account.settings!.baseUrl = ''; state.catalog.items = []; await mount(false);
    expect(components('empty')).toHaveLength(0); expect(button('plugin.market.sign_in').props.disabled).toBe(true);
    expect(components('alert')[0].props.message).toBe('plugin.market.no_source');
  });
});
