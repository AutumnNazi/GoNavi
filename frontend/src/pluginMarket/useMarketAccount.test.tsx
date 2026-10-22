import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginMarketSettings: vi.fn(), PluginMarketConfigure: vi.fn(), PluginMarketCatalog: vi.fn(),
  PluginMarketDetail: vi.fn(), PluginMarketRatings: vi.fn(), PluginMarketRate: vi.fn(), PluginMarketDeleteRating: vi.fn(),
  PluginMarketLogin: vi.fn(), PluginMarketPollLogin: vi.fn(), PluginMarketLogout: vi.fn(), PluginMarketInstall: vi.fn(), PluginMarketInspect: vi.fn(), PluginMarketCancelInspection: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);
import { useMarketAccount, type MarketAccount } from './useMarketAccount';
const ok = (data: unknown) => ({ success: true, data });
let renderer: ReturnType<typeof create> | undefined;
let account: MarketAccount;
function Harness() { account = useMarketAccount(); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  host.PluginMarketSettings.mockResolvedValue(ok({ baseUrl: 'https://market.test', authenticated: false }));
  host.PluginMarketLogin.mockResolvedValue(ok({ verificationUri: 'https://market.test/device', userCode: 'CODE', deviceCode: 'private', intervalSeconds: 1, expiresIn: 60 }));
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); });
describe('market device authorization', () => {
  it('does not fabricate login; polls pending then refreshes authoritative account state', async () => {
    host.PluginMarketPollLogin.mockResolvedValueOnce(ok({ status: 'pending' })).mockResolvedValueOnce(ok({ status: 'authorized' }));
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await account.start(); });
    expect(account.settings?.authenticated).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(account.status).toBe('pending');
    expect(account.settings?.authenticated).toBe(false);
    host.PluginMarketSettings.mockResolvedValue(ok({ baseUrl: 'https://market.test', authenticated: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(account.status).toBe('authorized');
    expect(account.settings?.authenticated).toBe(true);
    expect(account.login).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(host.PluginMarketPollLogin).toHaveBeenCalledTimes(2);
  });
  it('cancels polling and ignores a late authorized response', async () => {
    let complete: (value: unknown) => void = () => {};
    host.PluginMarketPollLogin.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await account.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => account.cancel());
    await act(async () => { complete(ok({ status: 'authorized' })); });
    expect(account.settings?.authenticated).toBe(false);
    expect(account.status).toBe('');
    expect(account.login).toBeNull();
  });
  it('expires even if the poll request hangs and does not overlap requests', async () => {
    host.PluginMarketPollLogin.mockImplementation(() => new Promise(() => {}));
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await account.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });
    expect(account.status).toBe('expired');
    expect(account.login).toBeNull();
    expect(account.settings?.authenticated).toBe(false);
    expect(host.PluginMarketPollLogin).toHaveBeenCalledTimes(1);
  });
  it('refreshes signed-out state even when remote revocation fails', async () => {
    host.PluginMarketSettings.mockResolvedValueOnce(ok({ baseUrl: 'https://market.test', authenticated: true }))
      .mockResolvedValue(ok({ baseUrl: 'https://market.test', authenticated: false }));
    host.PluginMarketLogout.mockResolvedValue({ success: false, message: 'Remote revocation failed' });
    await act(async () => { renderer = create(<Harness />); });
    expect(account.settings?.authenticated).toBe(true);
    await act(async () => { await account.logout(); });
    expect(account.settings?.authenticated).toBe(false);
    expect(account.error).toBe('Remote revocation failed');
    expect(host.PluginMarketSettings).toHaveBeenCalledTimes(2);
  });
  it('reports denied and network errors without successful account state', async () => {
    host.PluginMarketPollLogin.mockResolvedValue(ok({ status: 'denied' }));
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { await account.start(); await vi.advanceTimersByTimeAsync(1000); });
    // Effects start after the action flush.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(account.status).toBe('denied');
    host.PluginMarketLogin.mockRejectedValue(new Error('offline'));
    await act(async () => { await account.start(); });
    expect(account.error).toBeTruthy();
    expect(account.settings?.authenticated).toBe(false);
  });
});
