import { GalleryError } from './types';
import type { GalleryCatalog, GalleryEntry } from './types';

export interface GalleryStoredImage { entry: GalleryEntry; blob: Blob }
// Storage returns untrusted persisted data: the adapter validates it on every read.
export interface GalleryStorage {
  preflight(): Promise<void>;
  getCatalog(): Promise<GalleryCatalog | null>;
  putCatalog(catalog: GalleryCatalog): Promise<void>;
  list(): Promise<GalleryStoredImage[]>;
  get(id: string, version: string): Promise<GalleryStoredImage | null>;
  install(image: GalleryStoredImage, signal?: AbortSignal): Promise<void>;
  remove(id: string, version: string): Promise<void>;
  close(): void;
}

export class IndexedDBGalleryStorage implements GalleryStorage {
  private database?: Promise<IDBDatabase>;
  private closed = false;
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly name = 'gonavi-background-gallery-v1') {}

  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new GalleryError('unavailable'));
    if (!this.factory) return Promise.reject(new GalleryError('unsupported_environment'));
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory!.open(this.name, 1);
        let settled = false;
        const fail = () => { settled = true; reject(new GalleryError('storage_failed')); };
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog');
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        };
        request.onerror = fail;
        request.onblocked = fail;
        request.onsuccess = () => {
          const db = request.result;
          if (settled || this.closed) { db.close(); reject(new GalleryError('unavailable')); return; }
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
      }).catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }

  private async transaction<T>(storeName: string, mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new GalleryError('canceled');
    try {
      const db = await this.open();
      if (signal?.aborted) throw new GalleryError('canceled');
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let result: T;
        const abort = () => { try { tx.abort(); } catch { /* Already settled. */ } };
        const cleanup = () => signal?.removeEventListener('abort', abort);
        tx.oncomplete = () => { cleanup(); resolve(result); };
        tx.onabort = tx.onerror = () => {
          cleanup(); reject(new GalleryError(signal?.aborted ? 'canceled' : 'storage_failed'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          const request = action(tx.objectStore(storeName));
          request.onsuccess = () => { result = request.result; };
        } catch { abort(); cleanup(); reject(new GalleryError('storage_failed')); }
      });
    } catch (error) {
      if (error instanceof GalleryError) throw error;
      throw new GalleryError('storage_failed');
    }
  }

  async preflight(): Promise<void> {
    // Exercise a real readwrite transaction before any network or UI replacement.
    await this.transaction('catalog', 'readwrite', store => {
      store.put(true, 'capability-probe');
      return store.delete('capability-probe');
    });
  }
  async getCatalog(): Promise<GalleryCatalog | null> {
    return (await this.transaction<GalleryCatalog | undefined>('catalog', 'readonly', store => store.get('current'))) ?? null;
  }
  async putCatalog(catalog: GalleryCatalog): Promise<void> {
    await this.transaction('catalog', 'readwrite', store => store.put(catalog, 'current'));
  }
  async list(): Promise<GalleryStoredImage[]> {
    return this.transaction('images', 'readonly', store => store.getAll());
  }
  async get(id: string, version: string): Promise<GalleryStoredImage | null> {
    return (await this.transaction<GalleryStoredImage | undefined>('images', 'readonly', store => store.get([id, version]))) ?? null;
  }
  async install(image: GalleryStoredImage, signal?: AbortSignal): Promise<void> {
    // One record and one committed transaction publish bytes + license metadata together.
    await this.transaction('images', 'readwrite', store => store.put(image, [image.entry.id, image.entry.version]), signal);
  }
  async remove(id: string, version: string): Promise<void> {
    await this.transaction('images', 'readwrite', store => store.delete([id, version]));
  }
  close(): void {
    this.closed = true;
    void this.database?.then(db => db.close()).catch(() => undefined);
  }
}
