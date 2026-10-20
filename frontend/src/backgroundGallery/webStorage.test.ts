import { describe, expect, it } from 'vitest';
import { IndexedDBGalleryStorage } from './webStorage';
import type { GalleryStoredImage } from './webStorage';
import type { GalleryCatalog, GalleryEntry } from './types';

// This models only the browser's asynchronous transaction boundary, not gallery behavior.
// The application storage implementation itself is exercised unchanged.
class IDBTestBoundary {
  data = new Map<string, Map<string, unknown>>();
  failNextCommit = false;
  database = {
    objectStoreNames: { contains: (name: string) => this.data.has(name) },
    createObjectStore: (name: string) => this.data.set(name, new Map()),
    close: () => undefined,
    transaction: (name: string) => this.transaction(name),
  };
  factory = { open: () => {
    const request = { result: this.database, onupgradeneeded: () => undefined, onsuccess: () => undefined };
    setTimeout(() => { request.onupgradeneeded(); request.onsuccess(); }, 0);
    return request;
  } } as unknown as IDBFactory;

  private transaction(name: string) {
    const snapshot = new Map(this.data.get(name));
    let aborted = false; let pending = 0;
    const tx = {
      oncomplete: () => undefined,
      onerror: () => undefined,
      onabort: () => undefined,
      abort: () => { if (!aborted) { aborted = true; queueMicrotask(() => tx.onabort()); } },
      objectStore: () => ({
        put: (value: unknown, key: unknown) => request(() => { snapshot.set(JSON.stringify(key), structuredClone(value)); return key; }),
        delete: (key: unknown) => request(() => { snapshot.delete(JSON.stringify(key)); }),
        get: (key: unknown) => request(() => structuredClone(snapshot.get(JSON.stringify(key)))),
        getAll: () => request(() => structuredClone([...snapshot.values()])),
      }),
    };
    const request = (action: () => unknown) => {
      pending++;
      const req = { result: undefined as unknown, onsuccess: () => undefined };
      setTimeout(() => {
        if (aborted) return;
        req.result = action(); req.onsuccess(); pending--;
        if (pending === 0) setTimeout(() => {
          if (aborted) return;
          if (this.failNextCommit) { this.failNextCommit = false; tx.abort(); }
          else { this.data.set(name, snapshot); tx.oncomplete(); }
        }, 0);
      }, 0);
      return req;
    };
    return tx;
  }
}
function image(version = '1'): GalleryStoredImage {
  const asset = { path: 'assets/' + 'a'.repeat(64) + '.png', sha256: 'a'.repeat(64), sizeBytes: 1, width: 1, height: 1, mimeType: 'image/png' as const };
  const entry: GalleryEntry = { id: 'test', version, names: { en: 'Test' }, fit: 'contain', image: asset, thumbnail: asset,
    sourceUrl: 'https://example.org', attribution: 'Test author', rightsStatus: 'approved',
    license: { id: 'test', name: 'Test', url: 'https://example.org', notice: 'Test', text: 'Test', nonCommercial: true } };
  return { entry, blob: new Blob(['x'], { type: 'image/png' }) };
}

describe('browser IndexedDB gallery persistence', () => {
  it('atomically persists Blob plus license metadata and restores them from a new client', async () => {
    const browser = new IDBTestBoundary(); const storage = new IndexedDBGalleryStorage(browser.factory);
    const saved = image(); const catalog: GalleryCatalog = { schemaVersion: 1, version: '1', entries: [saved.entry] };
    await storage.preflight(); await storage.putCatalog(catalog); await storage.install(saved); storage.close();
    const reopened = new IndexedDBGalleryStorage(browser.factory);
    expect(await reopened.getCatalog()).toEqual(catalog);
    const restored = await reopened.get(saved.entry.id, saved.entry.version);
    expect(restored?.entry.license).toEqual(saved.entry.license);
    expect(await restored?.blob.text()).toBe('x');
    expect(restored).not.toHaveProperty('url');
  });
  it('does not expose a request success until its transaction commits and preserves old data on abort', async () => {
    const browser = new IDBTestBoundary(); const storage = new IndexedDBGalleryStorage(browser.factory);
    const saved = image(); await storage.install(saved);
    browser.failNextCommit = true;
    await expect(storage.install({ ...saved, blob: new Blob(['corrupt']) })).rejects.toMatchObject({ code: 'storage_failed' });
    expect(await (await storage.get('test', '1'))?.blob.text()).toBe('x');
    browser.failNextCommit = true;
    await expect(storage.remove('test', '1')).rejects.toMatchObject({ code: 'storage_failed' });
    expect(await storage.list()).toHaveLength(1);
  });
  it('aborts an install when its caller cancels and keeps catalog refresh atomic', async () => {
    const browser = new IDBTestBoundary(); const storage = new IndexedDBGalleryStorage(browser.factory);
    await storage.preflight();
    const controller = new AbortController(); const pending = storage.install(image(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'canceled' }); expect(await storage.list()).toEqual([]);
    const catalog: GalleryCatalog = { schemaVersion: 1, version: '1', entries: [] };
    await storage.putCatalog(catalog); browser.failNextCommit = true;
    await expect(storage.putCatalog({ ...catalog, version: '2' })).rejects.toMatchObject({ code: 'storage_failed' });
    expect(await storage.getCatalog()).toEqual(catalog);
  });
  it('rejects missing or blocked IDB instead of silently using server storage', async () => {
    const absent = new IndexedDBGalleryStorage(undefined);
    await expect(absent.preflight()).rejects.toMatchObject({ code: 'unsupported_environment' });
    const denied = new IndexedDBGalleryStorage({ open() { throw new DOMException('Denied', 'SecurityError'); } } as unknown as IDBFactory);
    await expect(denied.preflight()).rejects.toMatchObject({ code: 'storage_failed' });
  });
});
