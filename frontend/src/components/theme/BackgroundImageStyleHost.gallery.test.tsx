// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundImageStore as store, BACKGROUND_IMAGE_STORAGE_KEY as KEY } from '../../backgroundImageStore';
import { galleryInstalled } from '../../backgroundGallery/testFixtures';
import BackgroundImageStyleHost from './BackgroundImageStyleHost';
const adapter = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn(), download: vi.fn(), cancel: vi.fn(async () => undefined) }));
vi.mock('../../backgroundGallery/adapter', () => ({ getGalleryAdapter: async () => adapter }));
let view: ReactTestRenderer; let root: HTMLElement;
const persist = (id = 'whale-maid-a') => localStorage.setItem(KEY, JSON.stringify({ version: 1, builtinId: id, enabled: true, image: null, opacity: 24, positionX: 13, positionY: -27 }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); store.getState().reload();
  root = document.createElement('main'); root.className = 'gn-v2-app-root'; document.body.append(root);
});
afterEach(() => { act(() => view?.unmount()); document.body.replaceChildren(); });
const mount = async () => { await act(async () => { view = create(<BackgroundImageStyleHost />); }); };
describe('local-only gallery background rendering', () => {
  it('resolves old IDs locally on startup and preserves offsets across windows without fetching a catalog', async () => {
    persist(); store.getState().reload(); adapter.resolve.mockImplementation(async id => galleryInstalled(id));
    await mount();
    expect(adapter.resolve).toHaveBeenCalledWith('whale-maid-a', '');
    expect(root.style.getPropertyValue('--gn-background-image')).toContain(galleryInstalled().url);
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('13vw');
    expect(root.style.getPropertyValue('--gn-background-offset-y')).toBe('-27vh');
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('76%');
    await act(async () => { persist('whale-maid-b'); window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
    expect(adapter.resolve).toHaveBeenCalledWith('whale-maid-b', '');
    expect(root.style.getPropertyValue('--gn-background-image')).toContain(galleryInstalled('whale-maid-b').url);
    expect(adapter.refresh).not.toHaveBeenCalled(); expect(adapter.download).not.toHaveBeenCalled();
  });
  it('keeps missing/corrupt saved selections untouched and renders ordinary theme without automatic download', async () => {
    persist(); store.getState().reload(); const raw = localStorage.getItem(KEY);
    adapter.resolve.mockRejectedValue({ code: 'integrity' }); await mount();
    expect(root.hasAttribute('data-background-image')).toBe(false);
    expect(store.getState()).toMatchObject({ builtinId: 'whale-maid-a', enabled: true, galleryError: 'integrity', positionX: 13, positionY: -27 });
    expect(localStorage.getItem(KEY)).toBe(raw); expect(adapter.refresh).not.toHaveBeenCalled(); expect(adapter.download).not.toHaveBeenCalled();
  });
  it('keeps resolving the previous local background while a new selection is canceled', async () => {
    let finish!: (value: unknown) => void;
    adapter.resolve.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    persist(); store.getState().reload(); await mount();
    store.getState().cancelGallerySelection();
    await act(async () => { finish(galleryInstalled()); });
    expect(root.style.getPropertyValue('--gn-background-image')).toContain(galleryInstalled().url);
  });
  it('does not let an old local resolution repaint a new across-window selection', async () => {
    let finish!: (value: unknown) => void;
    adapter.resolve.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(galleryInstalled('whale-maid-b'));
    persist(); store.getState().reload(); await mount();
    await act(async () => { persist('whale-maid-b'); window.dispatchEvent(new StorageEvent('storage', { key: KEY })); });
    await act(async () => { finish(galleryInstalled()); });
    expect(store.getState().builtinId).toBe('whale-maid-b');
    expect(root.style.getPropertyValue('--gn-background-image')).toContain(galleryInstalled('whale-maid-b').url);
  });
});
