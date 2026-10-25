import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginMarketSources: vi.fn(), PluginMarketSaveSources: vi.fn(), PluginMarketSourceSettings: vi.fn(), PluginMarketSourceCatalog: vi.fn(),
  PluginMarketSourceDetail: vi.fn(), PluginMarketSourceRatings: vi.fn(), PluginMarketSourceRate: vi.fn(), PluginMarketSourceDeleteRating: vi.fn(),
  PluginMarketSourceLogin: vi.fn(), PluginMarketSourcePollLogin: vi.fn(), PluginMarketSourceLogout: vi.fn(), PluginMarketSourceSubmit: vi.fn(), PluginMarketConfigure: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);
import { decodeSources, marketSourcesAPI, sourceMarketAPI } from './sourceApi';
const a = 'a'.repeat(64); const b = 'b'.repeat(64);
const source = { baseUrl: 'https://plugin.gonavi.org', sourceId: a, enabled: true, trustedOfficial: true };
const plugin = { id: 'test.same', name: 'Same', description: '', author: 'Author', publisherId: 'author', official: true,
  version: '1.0.0', platforms: [], ratingAverage: 0, ratingCount: 0, downloadCount: 0, updatedAt: 'now', sourceId: a };
const ok = (data: unknown) => ({ success: true, data });
beforeEach(() => vi.resetAllMocks());
describe('explicit registered source adapter', () => {
  it('loads and saves typed sources without inferred defaults', async () => {
    host.PluginMarketSources.mockResolvedValue(ok([source])); host.PluginMarketSaveSources.mockResolvedValue(ok([source]));
    expect(await marketSourcesAPI.list()).toEqual([source]);
    await marketSourcesAPI.save([{ baseUrl: source.baseUrl, enabled: false }]);
    expect(host.PluginMarketSaveSources).toHaveBeenCalledWith([{ baseUrl: source.baseUrl, enabled: false }]);
  });
  it('binds catalog and settings requests to the source ID', async () => {
    host.PluginMarketSourceSettings.mockResolvedValue(ok({ ...source, authenticated: false }));
    host.PluginMarketSourceCatalog.mockResolvedValue(ok({ sourceId: a, items: [plugin] }));
    const client = sourceMarketAPI(a); await client.settings(); await client.catalog('same', 'rating', 'next');
    expect(host.PluginMarketSourceSettings).toHaveBeenCalledWith(a);
    expect(host.PluginMarketSourceCatalog).toHaveBeenCalledWith(a, 'same', 'rating', 'next');
  });
  it.each([
    { sourceId: b, items: [plugin] }, { sourceId: a, items: [{ ...plugin, sourceId: b }] },
    { sourceId: a, items: Array.from({ length: 25 }, () => plugin) },
  ])('rejects a foreign or oversized page', async (page) => {
    host.PluginMarketSourceCatalog.mockResolvedValue(ok(page));
    await expect(sourceMarketAPI(a).catalog('', 'updated', '')).rejects.toThrow();
  });
  it('never configures the global source to perform a scoped action', async () => {
    await expect(sourceMarketAPI(a).configure('https://other.test')).rejects.toThrow();
    expect(host.PluginMarketConfigure).not.toHaveBeenCalled();
    host.PluginMarketSourceLogout.mockResolvedValue(ok(null)); await sourceMarketAPI(b).logout();
    expect(host.PluginMarketSourceLogout).toHaveBeenCalledWith(b);
  });
  it('rejects duplicate or malformed source descriptors', () => {
    expect(() => decodeSources([source, source])).toThrow();
    expect(() => decodeSources([{ ...source, sourceId: 'bad' }])).toThrow();
    expect(() => decodeSources([{ ...source, enabled: 'yes' }])).toThrow();
  });
  it('binds authorization, polling and publishing to the selected source', async () => {
    host.PluginMarketSourceLogin.mockResolvedValue(ok({ verificationUri: 'https://private.example/auth', userCode: 'CODE', deviceCode: 'device', intervalSeconds: 1, expiresIn: 60 }));
    host.PluginMarketSourcePollLogin.mockResolvedValue(ok({ status: 'pending' }));
    host.PluginMarketSourceSubmit.mockResolvedValue(ok({ id: 's1', pluginId: 'test.same', version: '1.0.0', state: 'published', publisherId: 'publisher' }));
    const client = sourceMarketAPI(b); await client.login(); await client.pollLogin('device'); await client.submit('/tmp/plugin.zip', 'https://github.com/example/plugin');
    expect(host.PluginMarketSourceLogin).toHaveBeenCalledWith(b);
    expect(host.PluginMarketSourcePollLogin).toHaveBeenCalledWith(b, 'device');
    expect(host.PluginMarketSourceSubmit).toHaveBeenCalledWith(b, '/tmp/plugin.zip', 'https://github.com/example/plugin');
    expect(host.PluginMarketConfigure).not.toHaveBeenCalled();
  });

});
