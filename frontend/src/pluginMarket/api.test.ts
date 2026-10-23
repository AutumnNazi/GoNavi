import { beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginMarketSettings: vi.fn(), PluginMarketConfigure: vi.fn(), PluginMarketCatalog: vi.fn(),
  PluginMarketDetail: vi.fn(), PluginMarketRatings: vi.fn(), PluginMarketRate: vi.fn(), PluginMarketDeleteRating: vi.fn(),
  PluginMarketLogin: vi.fn(), PluginMarketPollLogin: vi.fn(), PluginMarketLogout: vi.fn(), PluginMarketInstall: vi.fn(), PluginMarketInspect: vi.fn(), PluginMarketCancelInspection: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);
import { marketAPI } from './api';
import { safeHTTPURL } from './decode';
beforeEach(() => vi.resetAllMocks());
describe('market generated adapter', () => {
  it('passes query sort and real cursor without inventing records', async () => {
    host.PluginMarketCatalog.mockResolvedValue({ success: true, data: { items: [], nextCursor: 'after:12' } });
    expect(await marketAPI.catalog('hello', 'rating', 'after:8')).toEqual({ items: [], nextCursor: 'after:12' });
    expect(host.PluginMarketCatalog).toHaveBeenCalledWith('hello', 'rating', 'after:8');
  });
  it('surfaces offline and structured backend errors', async () => {
    host.PluginMarketCatalog.mockRejectedValue(new Error('offline'));
    await expect(marketAPI.catalog('', 'updated', '')).rejects.toThrow('offline');
    host.PluginMarketRatings.mockResolvedValue({ success: false, message: 'Source unavailable', data: { code: 'market_unavailable' } });
    await expect(marketAPI.ratings('test.hello')).rejects.toThrow();
  });
  it('preserves explicitly stale cache data on failed requests without marking it live', async () => {
    host.PluginMarketCatalog.mockResolvedValue({ success: false, message: 'Offline', data: { items: [], stale: true, error: 'Offline', cachedAt: '2026-01-01', sourceId: 'opaque' } });
    const page = await marketAPI.catalog('', 'updated', '');
    expect(page.stale).toBe(true); expect(page.error).toBe('Offline'); expect(page.cachedAt).toBe('2026-01-01');
    host.PluginMarketCatalog.mockResolvedValue({ success: false, data: { items: [], stale: false } });
    await expect(marketAPI.catalog('', 'updated', '')).rejects.toThrow();
  });
  it('uses real create/update/delete rating operations', async () => {
    const rating = { userId: 'u1', pluginId: 'test.hello', stars: 4, body: 'Helpful', version: '1.0.0', updatedAt: 'now' };
    host.PluginMarketRate.mockResolvedValue({ success: true, data: rating });
    host.PluginMarketDeleteRating.mockResolvedValue({ success: true, data: null });
    expect(await marketAPI.rate('test.hello', 4, 'Helpful', '1.0.0')).toEqual(rating);
    await marketAPI.deleteRating('test.hello');
    expect(host.PluginMarketDeleteRating).toHaveBeenCalledWith('test.hello');
  });
  it('reports a committed disabled install separately from provenance failure', async () => {
    const installed = { manifest: { schemaVersion: 1, apiVersion: 1, id: 'test.hello', name: 'Hello', version: '1.0.0', permissions: [] },
      digest: 'a'.repeat(64), state: 'disabled', desiredEnabled: false, generation: 1, installedAt: 'now' };
    host.PluginMarketInstall.mockResolvedValue({ success: false, data: { installed, provenanceRecorded: false } });
    await expect(marketAPI.install('test.hello', '1.0.0', 'b'.repeat(64), true, 'approval-token')).rejects.toThrow('plugin.install.partial');
  });
  it.each(['javascript:alert(1)', 'file:///tmp/x', 'data:text/html,hi', 'https://user:secret@example.test'])('rejects unsafe auth URL %s', async (verificationUri) => {
    host.PluginMarketLogin.mockResolvedValue({ success: true, data: { verificationUri, userCode: 'CODE', deviceCode: 'device', intervalSeconds: 1, expiresIn: 30 } });
    await expect(marketAPI.login()).rejects.toThrow();
    expect(safeHTTPURL(verificationUri)).toBe(false);
  });
});
