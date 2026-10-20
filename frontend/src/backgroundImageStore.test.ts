import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundImage } from './utils/backgroundImage';

const { prepareImage } = vi.hoisted(() => ({ prepareImage: vi.fn<(file: File) => Promise<BackgroundImage>>() }));
vi.mock('./utils/backgroundImage', async (importOriginal) => ({
  ...await importOriginal<typeof import('./utils/backgroundImage')>(),
  prepareBackgroundImage: prepareImage,
}));

const KEY = 'gonavi-background-image-v1';
const IMAGE: BackgroundImage = {
  dataUrl: `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xe0\x00\x00\xff\xd9')}`,
  name: 'photo.png',
};
const FILE = new File(['source'], 'photo.png', { type: 'image/png' });
const importStore = () => import('./backgroundImageStore');
const serialize = (image: BackgroundImage | null = IMAGE, opacity = 15, positionX = 0, positionY = 0) => (
  JSON.stringify({ version: 1, image, opacity, positionX, positionY, enabled: Boolean(image), builtinId: null })
);

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  getItem(key: string) {
    if (this.failReads) throw new DOMException('Blocked', 'SecurityError');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.data.set(key, String(value));
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  prepareImage.mockReset().mockResolvedValue(IMAGE);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('background image persistence', () => {
  it('defaults to no image and 15 percent without writing storage', async () => {
    const { useBackgroundImageStore, BACKGROUND_IMAGE_STORAGE_KEY } = await importStore();
    expect(BACKGROUND_IMAGE_STORAGE_KEY).toBe(KEY);
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 15 });
    expect(storage.length).toBe(0);
  });

  it('imports and restores from the independent storage key', async () => {
    storage.setItem('gonavi-storage', 'unrelated root state');
    let module = await importStore();
    await expect(module.useBackgroundImageStore.getState().importImage(FILE)).resolves.toBeUndefined();
    expect(prepareImage).toHaveBeenCalledWith(FILE);
    expect(storage.getItem(KEY)).toBe(serialize());
    module.useBackgroundImageStore.getState().setOpacity(23);
    expect(storage.getItem(KEY)).toBe(serialize(IMAGE, 23));
    vi.resetModules();
    module = await importStore();
    expect(module.useBackgroundImageStore.getState()).toMatchObject({ image: IMAGE, opacity: 23 });
    expect(storage.getItem('gonavi-storage')).toBe('unrelated root state');
    expect(storage.length).toBe(2);
  });

  it('clears persisted image data while retaining opacity, including after restart', async () => {
    storage.setItem(KEY, serialize(IMAGE, 20));
    let module = await importStore();
    module.useBackgroundImageStore.getState().clearImage();
    expect(module.useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 20 });
    expect(storage.getItem(KEY)).toBe(serialize(null, 20));
    vi.resetModules();
    module = await importStore();
    expect(module.useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 20 });
  });

  it('reloads external edits and defaults after external removal without writing', async () => {
    const { useBackgroundImageStore } = await importStore();
    storage.setItem(KEY, serialize(IMAGE, 19));
    const write = vi.spyOn(storage, 'setItem');
    useBackgroundImageStore.getState().reload();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: IMAGE, opacity: 19 });
    storage.removeItem(KEY);
    useBackgroundImageStore.getState().reload();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 15 });
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    '', '{', 'null', '[]', '42', '{}',
    JSON.stringify({ version: 2, image: IMAGE, opacity: 20 }),
    JSON.stringify({ version: 1, image: { ...IMAGE, name: 123 }, opacity: 20 }),
    JSON.stringify({ version: 1, image: { ...IMAGE, dataUrl: 'blob:local' }, opacity: 20 }),
    JSON.stringify({ version: 1, image: { ...IMAGE, dataUrl: 'https://example.com/a.jpg' }, opacity: 20 }),
    JSON.stringify({ version: 1, image: { ...IMAGE, dataUrl: `${IMAGE.dataUrl}');color:red` }, opacity: 20 }),
  ])('falls back for corrupt persistence case %#', async (raw) => {
    storage.setItem(KEY, raw);
    const { useBackgroundImageStore } = await importStore();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 15 });
    expect(storage.getItem(KEY)).toBe(raw);
  });

  it.each([[0, 5], [99, 30], [17.5, 17.5], ['20', 15], [null, 15]])('sanitizes stored opacity %s', async (value, expected) => {
    storage.setItem(KEY, JSON.stringify({ version: 1, image: IMAGE, opacity: value }));
    const { useBackgroundImageStore } = await importStore();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: IMAGE, opacity: expected });
  });

  it.each([[-10, 5], [5, 5], [30, 30], [99, 30], [17.5, 17.5], [NaN, 15], [Infinity, 15], [-Infinity, 15]])(
    'normalizes intensity %s to %s percent', async (value, expected) => {
      const { useBackgroundImageStore } = await importStore();
      useBackgroundImageStore.getState().setOpacity(value);
      expect(useBackgroundImageStore.getState().opacity).toBe(expected);
      expect(JSON.parse(storage.getItem(KEY)!).opacity).toBe(expected);
    },
  );
});

describe('background image position', () => {
  it('migrates old snapshots to centered offsets without rewriting the image', async () => {
    const raw = JSON.stringify({ version: 1, image: IMAGE, opacity: 24 });
    storage.setItem(KEY, raw);
    const { useBackgroundImageStore } = await importStore();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: IMAGE, opacity: 24, positionX: 0, positionY: 0 });
    expect(storage.getItem(KEY)).toBe(raw);
  });

  it.each([[999, 100], [-999, -100], [15.36, 15.4], [null, 0], ['40', 0], [{}, 0]])(
    'sanitizes stored offsets %j to %s', async (value, expected) => {
      storage.setItem(KEY, JSON.stringify({ version: 1, image: IMAGE, positionX: value, positionY: value }));
      const { useBackgroundImageStore } = await importStore();
      expect(useBackgroundImageStore.getState()).toMatchObject({ positionX: expected, positionY: expected });
    },
  );

  it.each([[101, 100], [-101, -100], [NaN, 0], [Infinity, 0], [-Infinity, 0], [7.36, 7.4]])(
    'normalizes committed and transient offsets %s', async (value, expected) => {
      const { useBackgroundImageStore: store } = await importStore();
      store.getState().previewPositionAt(value, value);
      expect(store.getState().previewPosition).toEqual({ positionX: expected, positionY: expected });
      store.getState().setPosition(value, value);
      expect(store.getState()).toMatchObject({ positionX: expected, positionY: expected, previewPosition: null });
      expect(JSON.parse(storage.getItem(KEY)!)).toMatchObject({ positionX: expected, positionY: expected });
    },
  );

  it('does not serialize or write while previewing, persists once and restores both axes', async () => {
    storage.setItem(KEY, serialize());
    const { useBackgroundImageStore: store } = await importStore();
    const write = vi.spyOn(storage, 'setItem');
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let i = 1; i <= 50; i++) store.getState().previewPositionAt(i, -i);
    expect(write).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ positionX: 0, positionY: 0 });
    store.getState().setPosition(50, -50);
    expect(write).toHaveBeenCalledOnce();
    expect(stringify).toHaveBeenCalledOnce();
    store.getState().setOpacity(22);
    store.getState().reload();
    expect(store.getState()).toMatchObject({ positionX: 50, positionY: -50, previewPosition: null, opacity: 22 });
    expect(JSON.parse(storage.getItem(KEY)!)).not.toHaveProperty('previewPosition');
  });

  it('rolls a failed position commit back to the saved offsets', async () => {
    storage.setItem(KEY, serialize(IMAGE, 20, 12, -34));
    const { useBackgroundImageStore: store } = await importStore();
    store.getState().previewPositionAt(50, 70);
    storage.failWrites = true;
    expect(() => store.getState().setPosition(50, 70)).toThrow(expect.objectContaining({ code: 'storage-failed' }));
    expect(store.getState()).toMatchObject({ positionX: 12, positionY: -34, previewPosition: null });
    expect(storage.getItem(KEY)).toBe(serialize(IMAGE, 20, 12, -34));
  });

  it.each(['clearImage', 'reset', 'importImage', 'reload'] as const)('resets transient and saved offsets on %s', async (action) => {
    storage.setItem(KEY, serialize(IMAGE, 24, 12, -34));
    const { useBackgroundImageStore: store } = await importStore();
    store.getState().previewPositionAt(50, 70);
    if (action === 'importImage') await store.getState().importImage(FILE);
    else {
      if (action === 'reload') storage.removeItem(KEY);
      store.getState()[action]();
    }
    expect(store.getState()).toMatchObject({ positionX: 0, positionY: 0, previewPosition: null });
  });

  it('resets all settings atomically if storage is unavailable', async () => {
    storage.setItem(KEY, serialize(IMAGE, 24, 12, -34));
    const { useBackgroundImageStore: store } = await importStore();
    const previous = store.getState();
    storage.failWrites = true;
    expect(() => previous.reset()).toThrow(expect.objectContaining({ code: 'storage-failed' }));
    expect(store.getState()).toBe(previous);
  });
});

describe('background image failure atomicity', () => {
  it('preserves the old image, storage and subscribers when import persistence fails', async () => {
    storage.setItem(KEY, serialize(IMAGE, 22));
    const { useBackgroundImageStore } = await importStore();
    const { BackgroundImageError } = await import('./utils/backgroundImage');
    const previous = useBackgroundImageStore.getState();
    const changed = vi.fn();
    const unsubscribe = useBackgroundImageStore.subscribe(changed);
    prepareImage.mockResolvedValue({ ...IMAGE, name: 'replacement.webp' });
    storage.failWrites = true;
    await expect(previous.importImage(FILE)).rejects.toBeInstanceOf(BackgroundImageError);
    await expect(previous.importImage(FILE)).rejects.toMatchObject({ code: 'storage-failed' });
    expect(useBackgroundImageStore.getState()).toBe(previous);
    expect(storage.getItem(KEY)).toBe(serialize(IMAGE, 22));
    expect(changed).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(['invalid-type', 'too-large', 'invalid-image'] as const)('preserves the old image on %s', async (code) => {
    storage.setItem(KEY, serialize());
    const { useBackgroundImageStore } = await importStore();
    const { BackgroundImageError } = await import('./utils/backgroundImage');
    const previous = useBackgroundImageStore.getState();
    const error = new BackgroundImageError(code);
    prepareImage.mockRejectedValue(error);
    await expect(previous.importImage(FILE)).rejects.toBe(error);
    expect(useBackgroundImageStore.getState()).toBe(previous);
    expect(storage.getItem(KEY)).toBe(serialize());
  });

  it.each(['clearImage', 'setOpacity'] as const)('preserves state if %s cannot persist', async (action) => {
    storage.setItem(KEY, serialize());
    const { useBackgroundImageStore } = await importStore();
    const previous = useBackgroundImageStore.getState();
    storage.failWrites = true;
    expect(() => action === 'clearImage' ? previous.clearImage() : previous.setOpacity(25))
      .toThrow(expect.objectContaining({ code: 'storage-failed' }));
    expect(useBackgroundImageStore.getState()).toBe(previous);
    expect(storage.getItem(KEY)).toBe(serialize());
  });

  it('tolerates failed reads on initialization and reload', async () => {
    storage.failReads = true;
    const { useBackgroundImageStore } = await importStore();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 15 });
    storage.failReads = false;
    await useBackgroundImageStore.getState().importImage(FILE);
    storage.failReads = true;
    expect(() => useBackgroundImageStore.getState().reload()).not.toThrow();
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: null, opacity: 15 });
  });

  it.each(['missing', 'denied'])('defaults on %s storage but rejects all writes', async (mode) => {
    if (mode === 'missing') vi.stubGlobal('localStorage', undefined);
    else Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Blocked', 'SecurityError'); },
    });
    const { useBackgroundImageStore } = await importStore();
    const previous = useBackgroundImageStore.getState();
    expect(previous).toMatchObject({ image: null, opacity: 15 });
    await expect(previous.importImage(FILE)).rejects.toMatchObject({ code: 'storage-failed' });
    expect(() => previous.setOpacity(25)).toThrow(expect.objectContaining({ code: 'storage-failed' }));
    expect(() => previous.clearImage()).toThrow(expect.objectContaining({ code: 'storage-failed' }));
    expect(useBackgroundImageStore.getState()).toBe(previous);
  });
});

describe('background image pending imports', () => {
  const pendingImage = () => {
    let resolve!: (image: BackgroundImage) => void;
    const promise = new Promise<BackgroundImage>((done) => { resolve = done; });
    return { promise, resolve };
  };

  it.each(['clearImage', 'reload'] as const)('does not resurrect a pending image after %s', async (action) => {
    const { useBackgroundImageStore } = await importStore();
    const pending = pendingImage();
    prepareImage.mockReturnValueOnce(pending.promise);
    const importing = useBackgroundImageStore.getState().importImage(FILE);
    useBackgroundImageStore.getState()[action]();
    pending.resolve(IMAGE);
    await importing;
    expect(useBackgroundImageStore.getState().image).toBeNull();
    expect(storage.getItem(KEY)).toBe(action === 'clearImage' ? serialize(null) : null);
  });

  it('keeps the latest import if decoding completes out of order', async () => {
    const { useBackgroundImageStore } = await importStore();
    const pending = pendingImage();
    prepareImage.mockReturnValueOnce(pending.promise);
    const first = useBackgroundImageStore.getState().importImage(FILE);
    const newest = { ...IMAGE, name: 'new.webp' };
    prepareImage.mockResolvedValueOnce(newest);
    await useBackgroundImageStore.getState().importImage(FILE);
    pending.resolve(IMAGE);
    await first;
    expect(useBackgroundImageStore.getState().image).toEqual(newest);
    expect(storage.getItem(KEY)).toBe(serialize(newest));
  });

  it('preserves intensity edits made during decoding', async () => {
    const { useBackgroundImageStore } = await importStore();
    const pending = pendingImage();
    prepareImage.mockReturnValueOnce(pending.promise);
    const importing = useBackgroundImageStore.getState().importImage(FILE);
    useBackgroundImageStore.getState().setOpacity(28);
    pending.resolve(IMAGE);
    await importing;
    expect(useBackgroundImageStore.getState()).toMatchObject({ image: IMAGE, opacity: 28 });
    expect(storage.getItem(KEY)).toBe(serialize(IMAGE, 28));
  });
});
