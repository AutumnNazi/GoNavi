import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopGalleryAdapter } from './desktopAdapter';
import { galleryEntry, galleryInstalled } from './testFixtures';
const host = vi.hoisted(() => ({ status: vi.fn(), refresh: vi.fn(), resolve: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn(), thumbnail: vi.fn(), off: vi.fn(), listener: undefined as ((value: unknown) => void) | undefined }));
vi.mock('./thumbnail', () => ({ fetchGalleryThumbnail: host.thumbnail }));
vi.mock('../../wailsjs/go/app/App', () => ({
  BackgroundGalleryStatus: host.status, BackgroundGalleryRefresh: host.refresh, BackgroundGalleryResolve: host.resolve,
  BackgroundGalleryDownload: host.download, BackgroundGalleryCancel: host.cancel, BackgroundGalleryRemove: host.remove,
}));
vi.mock('../../wailsjs/runtime', () => ({ EventsOn: (name: string, callback: (value: unknown) => void) => {
  expect(name).toBe('background-gallery:progress'); host.listener = callback; return host.off;
} }));
const ok = (data: unknown) => ({ success: true, data });
beforeEach(() => { vi.clearAllMocks(); host.cancel.mockResolvedValue(ok(true)); });
describe('generated Wails desktop gallery adapter', () => {
  it.each([65, 256])('accepts %i installed versions independently of catalog size', async count => {
    const installed = Array.from({ length: count }, (_, index) => {
      const value = galleryInstalled(); value.entry.version = String(index + 1); return value;
    });
    const data = { catalog: null, installed, stale: false };
    host.status.mockResolvedValue(ok(data)); host.refresh.mockResolvedValue(ok(data));
    const adapter = createDesktopGalleryAdapter();
    expect((await adapter.status()).installed).toHaveLength(count);
    expect((await adapter.refresh()).installed).toHaveLength(count);
  });
  it('rejects installed histories beyond the backend bound', async () => {
    host.status.mockResolvedValue(ok({ catalog: null, installed: Array.from({ length: 257 }, () => galleryInstalled()), stale: false }));
    await expect(createDesktopGalleryAdapter().status()).rejects.toMatchObject({ code: 'invalid_catalog' });
  });
  it('keeps local status/resolve separate from refresh and enforces local resource URLs', async () => {
    const adapter = createDesktopGalleryAdapter(); const installed = galleryInstalled();
    host.status.mockResolvedValue(ok({ catalog: null, installed: [installed], stale: false }));
    host.resolve.mockResolvedValue(ok(installed));
    expect((await adapter.status()).installed[0]).toEqual(installed);
    expect(await adapter.resolve(installed.entry.id, '')).toEqual(installed);
    expect(host.resolve).toHaveBeenCalledWith('whale-maid-a', '');
    expect(host.refresh).not.toHaveBeenCalled(); expect(host.download).not.toHaveBeenCalled();
    for (const url of ['https://evil.example/image.png', 'file:///secret.png', installed.url + '?token=secret', '//host/image.png']) {
      host.resolve.mockResolvedValue(ok({ ...installed, url }));
      await expect(adapter.resolve(installed.entry.id, '')).rejects.toMatchObject({ code: 'integrity' });
    }
  });
  it('filters progress by request and removes listeners after completion or cancellation', async () => {
    let finish!: (value: unknown) => void;
    host.download.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const adapter = createDesktopGalleryAdapter(); const progress = vi.fn();
    const pending = adapter.download('whale-maid-a', '1', 'request-1', progress);
    host.listener?.({ requestId: 'other', downloaded: 1, total: 60, phase: 'downloading' });
    host.listener?.({ requestId: 'request-1', downloaded: -1, total: 60, phase: 'downloading' });
    expect(progress).not.toHaveBeenCalled();
    host.listener?.({ requestId: 'request-1', downloaded: 20, total: 60, phase: 'downloading' });
    expect(progress).toHaveBeenCalledTimes(1);
    await adapter.cancel('request-1');
    expect(host.cancel).toHaveBeenCalledWith('request-1'); expect(host.off).toHaveBeenCalled();
    finish(ok(galleryInstalled()));
    await expect(pending).rejects.toMatchObject({ code: 'canceled' });
  });
  it('reuses verified thumbnails and revokes their memory URLs on disposal', async () => {
    host.thumbnail.mockResolvedValue('blob:verified-thumbnail');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const adapter = createDesktopGalleryAdapter();
    expect(await adapter.thumbnail(galleryEntry())).toBe('blob:verified-thumbnail');
    expect(await adapter.thumbnail(galleryEntry())).toBe('blob:verified-thumbnail');
    expect(host.thumbnail).toHaveBeenCalledTimes(1);
    adapter.dispose(); expect(revoke).toHaveBeenCalledWith('blob:verified-thumbnail');
    revoke.mockRestore();
  });
  it('validates the entire refreshed catalog and surfaces stable machine errors', async () => {
    const adapter = createDesktopGalleryAdapter(); const entry = galleryEntry();
    host.refresh.mockResolvedValue(ok({ catalog: { schemaVersion: 1, version: '1', entries: [entry, entry] }, installed: [], stale: false }));
    await expect(adapter.refresh()).rejects.toMatchObject({ code: 'invalid_catalog' });
    host.download.mockResolvedValue({ success: false, data: { code: 'storage_failed' }, message: 'translated host error' });
    await expect(adapter.download(entry.id, entry.version, 'request-2')).rejects.toMatchObject({ code: 'storage_failed' });
    expect(host.off).toHaveBeenCalled();
  });
});
