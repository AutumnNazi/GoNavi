// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_IMAGE_STORAGE_KEY as KEY, useBackgroundImageStore as store } from './backgroundImageStore';
import { prepareBackgroundImage, type BackgroundImage } from './utils/backgroundImage';
import { BUILTIN_BACKGROUNDS } from './utils/builtinBackgrounds';
import { galleryInstalled } from './backgroundGallery/testFixtures';
vi.mock('./backgroundGallery/adapter', () => ({ getGalleryAdapter: async () => ({
  resolve: async (id: string) => galleryInstalled(id), cancel: async () => undefined,
}) }));

vi.mock('./utils/backgroundImage', async (original) => ({
  ...await original<typeof import('./utils/backgroundImage')>(),
  prepareBackgroundImage: vi.fn(),
}));
const image = { name: 'upload.jpg', dataUrl: 'data:image/jpeg;base64,/9j//9k=' };
const file = new File(['test'], image.name, { type: 'image/jpeg' });
const saved = () => JSON.parse(localStorage.getItem(KEY)!);

beforeEach(() => {
  localStorage.clear();
  store.getState().reload();
  vi.mocked(prepareBackgroundImage).mockReset().mockResolvedValue(image);
});
afterEach(() => vi.restoreAllMocks());

describe('background selection and opt-in persistence', () => {
  it('starts disabled with no implicit builtin selection and never writes on load', () => {
    expect(store.getState()).toMatchObject({ enabled: false, builtinId: null, image: null, positionX: 0, positionY: 0 });
    expect(localStorage.getItem(KEY)).toBeNull();
    store.getState().setEnabled(true);
    expect(store.getState().enabled).toBe(false);
  });

  it.each([undefined, false, 'true', 1, null])('legacy or invalid enabled=%s never automatically opts in', (enabled) => {
    const raw = JSON.stringify({ version: 1, image, opacity: 23, positionX: 12, positionY: -34, enabled });
    localStorage.setItem(KEY, raw);
    store.getState().reload();
    expect(store.getState()).toMatchObject({ image, enabled: false, builtinId: null, opacity: 23, positionX: 12, positionY: -34 });
    expect(localStorage.getItem(KEY)).toBe(raw);
    store.getState().setEnabled(true);
    store.getState().reload();
    expect(store.getState().enabled).toBe(true);
  });

  it.each(BUILTIN_BACKGROUNDS)('selects and restores $id using only its ID, with no image bytes or URLs', async ({ id }) => {
    store.getState().setOpacity(27);
    await store.getState().selectBuiltin(id);
    expect(saved()).toEqual({ version: 1, enabled: true, builtinId: id, builtinVersion: '1', image: null, opacity: 27, positionX: 0, positionY: 0 });
    expect(localStorage.getItem(KEY)!.length).toBeLessThan(160);
    store.getState().reload();
    expect(store.getState()).toMatchObject({ enabled: true, builtinId: id, image: null, opacity: 27 });
  });

  it.each(['builtin', 'uploaded'])('off/on preserves %s selection, intensity and offsets across reload', async (source) => {
    if (source === 'builtin') await store.getState().selectBuiltin('whale-maid-a');
    else await store.getState().importImage(file);
    store.getState().setOpacity(29);
    store.getState().setPosition(12.3, -45.6);
    store.getState().previewPositionAt(90, 90);
    store.getState().setEnabled(false);
    store.getState().reload();
    expect(store.getState()).toMatchObject({ enabled: false, opacity: 29, positionX: 12.3, positionY: -45.6, previewPosition: null });
    expect(store.getState().builtinId).toBe(source === 'builtin' ? 'whale-maid-a' : null);
    expect(store.getState().image).toEqual(source === 'uploaded' ? image : null);
    store.getState().setEnabled(true);
    store.getState().reload();
    expect(store.getState()).toMatchObject({ enabled: true, opacity: 29, positionX: 12.3, positionY: -45.6 });
  });

  it('switches between uploads and builtins without restoring an obsolete upload', async () => {
    await store.getState().importImage(file);
    store.getState().setPosition(11, 22);
    await store.getState().selectBuiltin('whale-maid-a');
    await store.getState().selectBuiltin('whale-maid-b');
    expect(store.getState()).toMatchObject({ image: null, builtinId: 'whale-maid-b', enabled: true, positionX: 11, positionY: 22 });
    expect(saved().image).toBeNull();
    store.getState().setEnabled(false);
    await store.getState().importImage(file);
    expect(store.getState()).toMatchObject({ image, builtinId: null, enabled: true, positionX: 0, positionY: 0 });
    expect(prepareBackgroundImage).toHaveBeenCalledTimes(2);
  });

  it.each(['clearImage', 'reset'] as const)('%s removes selection and positions and explicitly disables the background', async (action) => {
    await store.getState().selectBuiltin('whale-maid-b');
    store.getState().setOpacity(24);
    store.getState().setPosition(11, 22);
    store.getState().previewPositionAt(30, 40);
    store.getState()[action]();
    store.getState().reload();
    expect(store.getState()).toMatchObject({
      enabled: false, image: null, builtinId: null, positionX: 0, positionY: 0, previewPosition: null,
      opacity: action === 'reset' ? 15 : 24,
    });
  });

  it.each(['https://evil.example/a.webp', 'data:image/webp;base64,AAAA', '__proto__', '', 'whale-maid-c'])('rejects unknown builtin %s', async (id) => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, builtinId: id, enabled: true, image: null, positionX: 50 }));
    store.getState().reload();
    expect(store.getState()).toMatchObject({ enabled: false, builtinId: null, image: null, positionX: 0 });
    const before = store.getState();
    await expect(before.selectBuiltin(id)).rejects.toThrow();
    expect(store.getState()).toBe(before);
  });

  it.each(['toggle', 'select'])('keeps state and persisted selection intact on %s storage failure', async (action) => {
    await store.getState().selectBuiltin('whale-maid-a');
    const previous = store.getState();
    const raw = localStorage.getItem(KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    if (action === 'toggle') expect(() => previous.setEnabled(false)).toThrow(expect.objectContaining({ code: 'storage-failed' }));
    else await expect(previous.selectBuiltin('whale-maid-b')).rejects.toMatchObject({ code: 'storage-failed' });
    expect(store.getState()).toBe(previous);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it.each(['toggle', 'select'])('cancels an obsolete pending upload after %s', async (action) => {
    let finish!: (image: BackgroundImage) => void;
    vi.mocked(prepareBackgroundImage).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = store.getState().importImage(file);
    if (action === 'toggle') store.getState().setEnabled(false);
    else await store.getState().selectBuiltin('whale-maid-b');
    finish(image);
    await pending;
    expect(store.getState()).toMatchObject({ image: null, enabled: action === 'select', builtinId: action === 'select' ? 'whale-maid-b' : null });
  });
});
