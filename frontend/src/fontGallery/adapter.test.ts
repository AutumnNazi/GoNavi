// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopFontGalleryAdapter } from './adapter';
import { fontEntry, fontInstalled } from './testFixtures';
vi.mock('../../wailsjs/runtime', () => ({ EventsOn: vi.fn(() => () => {}) }));
afterEach(() => { vi.unstubAllGlobals(); });

describe('generated font bindings adapter', () => {
  it('uses the generated status binding and rejects missing desktop APIs', async () => {
    vi.stubGlobal('go', undefined);
    await expect(createDesktopFontGalleryAdapter().status()).rejects.toMatchObject({ code: 'unsupported_environment' });
    const status = vi.fn(async () => ({ success: true, data: { catalog: null, installed: [], stale: false } }));
    vi.stubGlobal('go', { app: { App: { FontGalleryStatus: status } } });
    expect((await createDesktopFontGalleryAdapter().status()).installed).toEqual([]);
    expect(status).toHaveBeenCalledOnce();
  });
  it('passes exact download arguments and validates the returned alias', async () => {
    const entry = fontEntry(); const installed = fontInstalled(entry);
    const download = vi.fn(async () => ({ success: true, data: installed }));
    vi.stubGlobal('go', { app: { App: { FontGalleryDownload: download } } });
    const result = await createDesktopFontGalleryAdapter().download(entry.id, entry.version, 'request-1');
    expect(download).toHaveBeenCalledWith(entry.id, entry.version, 'request-1');
    expect(result.family).toBe(installed.family);
    download.mockResolvedValue({ success: true, data: { ...installed, family: 'fallback' } });
    await expect(createDesktopFontGalleryAdapter().download(entry.id, entry.version, 'request-2')).rejects.toMatchObject({ code: 'integrity' });
  });
});
