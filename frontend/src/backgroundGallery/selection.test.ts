// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundImageStore as store, BACKGROUND_IMAGE_STORAGE_KEY as KEY } from '../backgroundImageStore';
const transport = vi.hoisted(() => ({ download: vi.fn(), resolve: vi.fn(), cancel: vi.fn(async () => undefined) }));
vi.mock('./adapter', () => ({ getGalleryAdapter: async () => transport }));
const installed = { entry: { id: 'whale-maid-a', version: '1', names: { en: 'A' }, fit: 'contain' }, url: '/__gonavi/background-gallery/assets/' + 'a'.repeat(64) + '.webp' };
beforeEach(() => { localStorage.clear(); store.getState().reload(); transport.download.mockReset(); transport.resolve.mockReset().mockRejectedValue({ code: 'unavailable' }); transport.cancel.mockClear(); });

describe('durable gallery selection', () => {
  it('commits only after download succeeds and persists IDs, not resource URLs', async () => {
    let finish!: (value: unknown) => void;
    transport.download.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = store.getState().selectBuiltin('whale-maid-a', '1');
    await vi.waitFor(() => expect(transport.download).toHaveBeenCalled());
    expect(store.getState().builtinId).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    finish(installed); await pending;
    expect(store.getState()).toMatchObject({ builtinId: 'whale-maid-a', builtinVersion: '1', enabled: true });
    expect(localStorage.getItem(KEY)).not.toContain('assets/');
    expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty('resolvedGallery');
  });
  it.each(['toggle', 'cancel', 'reload', 'clear', 'upload', 'change'])('ignores a late download after %s', async (action) => {
    let finish!: (value: unknown) => void;
    transport.download.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = store.getState().selectBuiltin('whale-maid-a', '1');
    await vi.waitFor(() => expect(transport.download).toHaveBeenCalled());
    if (action === 'toggle') store.getState().setEnabled(false);
    if (action === 'cancel') store.getState().cancelGallerySelection();
    if (action === 'reload') store.getState().reload();
    if (action === 'clear') store.getState().clearImage();
    if (action === 'upload') {
      await store.getState().importImage(new File(['invalid'], 'x.svg', { type: 'image/svg+xml' })).catch(() => undefined);
    }
    if (action === 'change') {
      transport.resolve.mockResolvedValueOnce({ ...installed, entry: { ...installed.entry, id: 'whale-maid-b' } });
      await store.getState().selectBuiltin('whale-maid-b', '1');
    }
    const previous = localStorage.getItem(KEY);
    finish(installed); await pending;
    expect(localStorage.getItem(KEY)).toBe(previous);
    expect(store.getState().builtinId).toBe(action === 'change' ? 'whale-maid-b' : null);
    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });
  it('keeps old selection, intensity and positions on download and storage failure', async () => {
    transport.resolve.mockResolvedValueOnce(installed);
    await store.getState().selectBuiltin('whale-maid-a', '1');
    store.getState().setPosition(12, -25); store.getState().setOpacity(23);
    const before = store.getState(); const saved = localStorage.getItem(KEY);
    transport.download.mockRejectedValueOnce({ code: 'integrity' });
    await expect(store.getState().selectBuiltin('whale-maid-b', '1')).rejects.toMatchObject({ code: 'integrity' });
    expect(store.getState()).toBe(before); expect(localStorage.getItem(KEY)).toBe(saved);
    transport.resolve.mockResolvedValueOnce({ ...installed, entry: { ...installed.entry, id: 'whale-maid-b' } });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(store.getState().selectBuiltin('whale-maid-b', '1')).rejects.toMatchObject({ code: 'storage-failed' });
    expect(store.getState()).toBe(before); expect(localStorage.getItem(KEY)).toBe(saved);
    write.mockRestore();
  });
  it('resolves a legacy selection locally without mutating its snapshot or refreshing', async () => {
    const raw = JSON.stringify({ version: 1, builtinId: 'whale-maid-a', enabled: true, opacity: 22, positionX: 13, positionY: -21 });
    localStorage.setItem(KEY, raw); store.getState().reload();
    await store.getState().resolveSelected();
    expect(transport.resolve).toHaveBeenCalledWith('whale-maid-a', '');
    expect(transport.download).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ builtinId: 'whale-maid-a', enabled: true, resolvedGallery: null, galleryError: 'unavailable', opacity: 22, positionX: 13, positionY: -21 });
    expect(localStorage.getItem(KEY)).toBe(raw);
  });
});
