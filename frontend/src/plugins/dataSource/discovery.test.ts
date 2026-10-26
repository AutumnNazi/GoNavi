import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginDataSources: vi.fn(), PluginSetEnabled: vi.fn(), PluginInvoke: vi.fn() }));
vi.mock('../../../wailsjs/go/app/App', () => host);
const item = { type: 'plugin:demo.source:reader:mysql', pluginId: 'demo.source', id: 'reader', name: 'Reader', dialect: 'mysql',
  defaultPort: 0, version: '1', generation: 1, available: true, connectable: true, state: 'running', readOnly: true };
let discovery: typeof import('./discovery');
let store: typeof import('./snapshot');
let releases: (() => void)[] = [];
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); vi.resetAllMocks();
  discovery = await import('./discovery'); store = await import('./snapshot');
  host.PluginDataSources.mockResolvedValue({ success: true, data: { items: [item] } });
});
afterEach(() => { releases.forEach((release) => release()); releases = []; vi.useRealTimers(); });
const flush = () => vi.advanceTimersByTimeAsync(0);
describe('bounded non-activating datasource discovery', () => {
  it('shares one poller, reuses unchanged snapshots, and stops on final release', async () => {
    releases.push(discovery.retainPluginDataSourceDiscovery(), discovery.retainPluginDataSourceDiscovery());
    await flush(); expect(host.PluginDataSources).toHaveBeenCalledTimes(1);
    const items = store.getPluginDataSourceSnapshot().items;
    await vi.advanceTimersByTimeAsync(5000);
    expect(host.PluginDataSources).toHaveBeenCalledTimes(2); expect(store.getPluginDataSourceSnapshot().items).toBe(items);
    releases[0](); await vi.advanceTimersByTimeAsync(5000); expect(host.PluginDataSources).toHaveBeenCalledTimes(3);
    releases[1](); await vi.advanceTimersByTimeAsync(10000); expect(host.PluginDataSources).toHaveBeenCalledTimes(3);
    expect(store.findPluginDataSource(item.type)?.available).toBe(false);
    expect(host.PluginSetEnabled).not.toHaveBeenCalled(); expect(host.PluginInvoke).not.toHaveBeenCalled();
  });
  it('bounds a hanging bridge wait without duplicating the underlying call', async () => {
    host.PluginDataSources.mockImplementation(() => new Promise(() => {}));
    const pending = discovery.refreshPluginDataSources();
    await vi.advanceTimersByTimeAsync(10001); await pending;
    expect(store.getPluginDataSourceSnapshot().loading).toBe(false); expect(store.getPluginDataSourceSnapshot().error).toBeTruthy();
    await discovery.refreshPluginDataSources(); expect(host.PluginDataSources).toHaveBeenCalledTimes(1);
  });
  it('fences late results on unmount, without fake catalog records', async () => {
    let resolve: (value: unknown) => void = () => {};
    host.PluginDataSources.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const release = discovery.retainPluginDataSourceDiscovery(); releases.push(release); release();
    resolve({ success: true, data: { items: [item] } }); await flush();
    expect(store.getPluginDataSourceSnapshot().items).toEqual([]);
  });
  it('revokes immediately and ignores a stale in-flight discovery response', async () => {
    store.replacePluginDataSources({ items: [item] });
    let resolve: (value: unknown) => void = () => {};
    host.PluginDataSources.mockImplementation(() => new Promise((done) => { resolve = done; }));
    releases.push(discovery.retainPluginDataSourceDiscovery());
    discovery.revokePluginDataSourceAvailability(item.pluginId);
    expect(store.findPluginDataSource(item.type)?.connectable).toBe(false);
    resolve({ success: true, data: { items: [item] } }); await flush();
    expect(store.findPluginDataSource(item.type)?.available).toBe(false);
  });
  it('retains identifiable entries but removes permissions after an invalid or failed response', async () => {
    store.replacePluginDataSources({ items: [item] });
    host.PluginDataSources.mockResolvedValue({ success: true, data: { items: [{ ...item, readOnly: 'no' }] } });
    await discovery.refreshPluginDataSources();
    expect(store.getPluginDataSourceSnapshot().items).toHaveLength(1);
    expect(store.findPluginDataSource(item.type)?.connectable).toBe(false); expect(store.getPluginDataSourceSnapshot().error).toBeTruthy();
  });
});
