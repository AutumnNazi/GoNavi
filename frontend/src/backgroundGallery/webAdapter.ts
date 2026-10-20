import { BaseURL, GalleryError } from './types';
import type { GalleryAdapter, GalleryAsset, GalleryCatalog, GalleryEntry, GalleryErrorCode, GalleryInstalled, GalleryProgress, GalleryState } from './types';
import { assetURL, decodeBrowserImage, MAX_CATALOG_BYTES, MAX_IMAGE_BYTES, MAX_THUMBNAIL_BYTES, parseCatalog, validateCatalog, validateEntry, validateImage, validateSelection } from './validation';
import type { ImageDecoder } from './validation';
import { IndexedDBGalleryStorage } from './webStorage';
import type { GalleryStorage, GalleryStoredImage } from './webStorage';
export { BaseURL } from './types';

export interface WebGalleryOptions {
  storage?: GalleryStorage;
  indexedDB?: IDBFactory;
  fetch?: typeof globalThis.fetch;
  subtle?: SubtleCrypto | null;
  decode?: ImageDecoder;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  timeoutMs?: number;
}

function checkCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new GalleryError('canceled');
}
function errorCode(error: unknown, fallback: GalleryErrorCode): GalleryError {
  return error instanceof GalleryError ? error : new GalleryError(fallback);
}
export async function readBoundedResponse(response: Response, maximum: number, signal: AbortSignal,
  expected?: number, progress?: (downloaded: number) => void): Promise<Uint8Array> {
  checkCanceled(signal);
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maximum
    || (expected !== undefined && Number(length) !== expected))) {
    void response.body?.cancel().catch(() => undefined);
    throw new GalleryError('integrity');
  }
  if (!response.body) throw new GalleryError('download_failed');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  let total = 0;
  const bytes = new Uint8Array(expected ?? maximum);
  try {
    while (true) {
      checkCanceled(signal);
      const { done, value } = await reader.read();
      checkCanceled(signal);
      if (done) break;
      total += value.byteLength;
      if (total > maximum || (expected !== undefined && total > expected)) throw new GalleryError('integrity');
      bytes.set(value, total - value.byteLength); progress?.(total);
    }
    if (expected !== undefined && total !== expected) throw new GalleryError('integrity');
    return bytes.slice(0, total);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

export class WebGalleryAdapter implements GalleryAdapter {
  private readonly storage: GalleryStorage;
  private readonly subtle: SubtleCrypto | undefined | null;
  private readonly decode: ImageDecoder;
  private readonly createURL: (blob: Blob) => string;
  private readonly revokeURL: (url: string) => void;
  private readonly urls = new Map<string, string>();
  private readonly requests = new Map<string, AbortController>();
  private readonly controllers = new Set<AbortController>();
  private activeOperations = 0;
  private readonly waitingOperations: Array<() => void> = [];
  private refreshing?: Promise<GalleryState>;
  private disposed = false;
  private ready?: Promise<void>;
  constructor(private readonly options: WebGalleryOptions = {}) {
    this.storage = options.storage ?? new IndexedDBGalleryStorage(options.indexedDB);
    this.subtle = options.subtle === undefined ? globalThis.crypto?.subtle : options.subtle;
    this.decode = options.decode ?? decodeBrowserImage;
    this.createURL = options.createObjectURL ?? (blob => URL.createObjectURL(blob));
    this.revokeURL = options.revokeObjectURL ?? (url => URL.revokeObjectURL(url));
  }
  private async preflight(): Promise<void> {
    if (this.disposed) throw new GalleryError('unavailable');
    if (!this.subtle?.digest || (!this.options.decode && typeof globalThis.createImageBitmap !== 'function')
      || (!this.options.createObjectURL && typeof URL.createObjectURL !== 'function')) {
      throw new GalleryError('unsupported_environment');
    }
    if (!this.ready) this.ready = (async () => {
      try { await this.subtle!.digest('SHA-256', new Uint8Array()); }
      catch { throw new GalleryError('unsupported_environment'); }
      try { await this.storage.preflight(); } catch (error) { throw errorCode(error, 'storage_failed'); }
    })().catch(error => { this.ready = undefined; throw error; });
    await this.ready;
    if (this.disposed) throw new GalleryError('unavailable');
  }
  private async localCatalog(): Promise<GalleryCatalog | null> {
    const catalog = await this.storage.getCatalog();
    return catalog === null ? null : validateCatalog(catalog);
  }
  private async installed(record: GalleryStoredImage): Promise<GalleryInstalled> {
    const entry = validateEntry(record.entry);
    await validateImage(record.blob, entry.image, this.subtle!, this.decode);
    if (this.disposed) throw new GalleryError('unavailable');
    const key = entry.id + '@' + entry.version + ':' + entry.image.sha256;
    let url = this.urls.get(key);
    if (!url) { url = this.createURL(record.blob); this.urls.set(key, url); }
    return { entry, url };
  }
  async status(): Promise<GalleryState> {
    await this.preflight();
    const state: GalleryState = { catalog: null, installed: [], stale: false };
    try { state.catalog = await this.localCatalog(); }
    catch (error) { state.warningCode = error instanceof GalleryError ? error.code : 'storage_failed'; state.stale = true; }
    for (const image of await this.storage.list()) {
      try { state.installed.push(await this.installed(image)); }
      catch (error) { state.warningCode = error instanceof GalleryError ? error.code : 'integrity'; }
    }
    return state;
  }
  async resolve(id: string, version: string): Promise<GalleryInstalled> {
    validateSelection(id, version, true);
    await this.preflight();
    const record = version ? await this.storage.get(id, version)
      : (await this.storage.list()).filter(value => value.entry?.id === id).sort((a, b) => b.entry.version.localeCompare(a.entry.version))[0];
    if (!record) throw new GalleryError('unavailable');
    if (record.entry?.id !== id || (version && record.entry?.version !== version)) throw new GalleryError('integrity');
    return this.installed(record);
  }
  private acquireOperation(signal: AbortSignal): Promise<() => void> {
    checkCanceled(signal);
    return new Promise((resolve, reject) => {
      const release = () => { this.activeOperations--; this.waitingOperations.shift()?.(); };
      const start = () => {
        signal.removeEventListener('abort', abort);
        this.activeOperations++; resolve(release);
      };
      const abort = () => {
        const index = this.waitingOperations.indexOf(start);
        if (index >= 0) this.waitingOperations.splice(index, 1);
        reject(new GalleryError('canceled'));
      };
      if (this.activeOperations < 6) start();
      else {
        signal.addEventListener('abort', abort, { once: true });
        this.waitingOperations.push(start);
      }
    });
  }
  private async operation<T>(controller: AbortController, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) throw new GalleryError('unavailable');
    if (this.waitingOperations.length >= 64) throw new GalleryError('unavailable');
    this.controllers.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 30_000);
    let release: (() => void) | undefined;
    try {
      release = await this.acquireOperation(controller.signal);
      checkCanceled(controller.signal);
      return await action(controller.signal);
    }
    catch (error) {
      if (timedOut) throw new GalleryError('download_failed');
      if (controller.signal.aborted) throw new GalleryError('canceled');
      throw errorCode(error, 'download_failed');
    } finally { clearTimeout(timeout); this.controllers.delete(controller); release?.(); }
  }
  private async fetchBytes(url: string, mime: string, maximum: number, signal: AbortSignal,
    expected?: number, progress?: (downloaded: number) => void): Promise<Uint8Array> {
    checkCanceled(signal);
    const fetcher = this.options.fetch ?? globalThis.fetch;
    if (!fetcher) throw new GalleryError('unsupported_environment');
    const response = await fetcher(url, { credentials: 'omit', redirect: 'error', signal,
      referrerPolicy: 'no-referrer', cache: 'no-cache', mode: 'cors' });
    if (signal.aborted) { void response.body?.cancel().catch(() => undefined); checkCanceled(signal); }
    if (!response.ok || response.redirected || (response.url && response.url !== url)) {
      void response.body?.cancel().catch(() => undefined);
      throw new GalleryError('download_failed');
    }
    if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== mime) {
      void response.body?.cancel().catch(() => undefined);
      throw new GalleryError(mime === 'application/json' ? 'invalid_catalog' : 'integrity');
    }
    return readBoundedResponse(response, maximum, signal, expected, progress);
  }
  async refresh(): Promise<GalleryState> {
    if (!this.refreshing) this.refreshing = this.refreshCatalog().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async refreshCatalog(): Promise<GalleryState> {
    await this.preflight();
    try {
      return await this.operation(new AbortController(), async signal => {
        const bytes = await this.fetchBytes(BaseURL + 'catalog.json', 'application/json', MAX_CATALOG_BYTES, signal);
        const catalog = parseCatalog(bytes);
        checkCanceled(signal);
        try { await this.storage.putCatalog(catalog); } catch (error) { throw errorCode(error, 'storage_failed'); }
        checkCanceled(signal);
        return this.status();
      });
    } catch (error) {
      if (this.disposed) throw new GalleryError('canceled');
      const fallback = await this.status();
      if (!fallback.catalog) throw errorCode(error, 'download_failed');
      return { ...fallback, stale: true, warningCode: errorCode(error, 'download_failed').code };
    }
  }
  private async fetchImage(asset: GalleryAsset, maximum: number, signal: AbortSignal,
    progress?: (downloaded: number) => void): Promise<Blob> {
    const bytes = await this.fetchBytes(assetURL(asset, maximum), asset.mimeType, maximum, signal, asset.sizeBytes, progress);
    const blob = new Blob([new Uint8Array(bytes)], { type: asset.mimeType });
    await validateImage(blob, asset, this.subtle!, this.decode, maximum);
    checkCanceled(signal);
    return blob;
  }
  async download(id: string, version: string, requestId: string, onProgress?: (progress: GalleryProgress) => void): Promise<GalleryInstalled> {
    validateSelection(id, version);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) || this.requests.has(requestId)) throw new GalleryError('invalid_id');
    if (this.requests.size >= 2) throw new GalleryError('unavailable');
    const controller = new AbortController();
    this.requests.set(requestId, controller);
    try {
      return await this.operation(controller, async signal => {
        await this.preflight(); checkCanceled(signal);
        const catalog = await this.localCatalog(); checkCanceled(signal);
        const entry = catalog?.entries.find(value => value.id === id && value.version === version);
        if (!entry) throw new GalleryError('unavailable');
        const emit = (downloaded: number, phase: string) => {
          try { onProgress?.({ requestId, downloaded, total: entry.image.sizeBytes, phase }); } catch { /* Observers cannot interrupt persistence. */ }
        };
        emit(0, 'downloading');
        const blob = await this.fetchImage(entry.image, MAX_IMAGE_BYTES, signal, n => emit(n, 'downloading'));
        emit(blob.size, 'installing'); checkCanceled(signal);
        try { await this.storage.install({ entry, blob }, signal); }
        catch (error) { throw errorCode(error, 'storage_failed'); }
        checkCanceled(signal);
        const installed = await this.installed({ entry, blob }); checkCanceled(signal);
        emit(blob.size, 'complete'); return installed;
      });
    } finally { this.requests.delete(requestId); }
  }
  async cancel(requestId: string): Promise<void> { this.requests.get(requestId)?.abort(); }
  async remove(id: string, version: string): Promise<void> {
    validateSelection(id, version);
    await this.preflight();
    await this.storage.remove(id, version);
    for (const [key, url] of this.urls) if (key.startsWith(id + '@' + version + ':')) {
      this.revokeURL(url); this.urls.delete(key);
    }
  }
  async thumbnail(entry: GalleryEntry, signal?: AbortSignal): Promise<string> {
    entry = validateEntry(structuredClone(entry));
    if (signal?.aborted) throw new GalleryError('canceled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await this.operation(controller, async inner => {
        await this.preflight(); checkCanceled(inner);
        const key = 'thumbnail:' + entry.thumbnail.sha256;
        const cached = this.urls.get(key);
        if (cached) return cached;
        const blob = await this.fetchImage(entry.thumbnail, MAX_THUMBNAIL_BYTES, inner);
        checkCanceled(inner);
        const existing = this.urls.get(key);
        if (existing) return existing;
        const url = this.createURL(blob); this.urls.set(key, url); return url;
      });
    } finally { signal?.removeEventListener('abort', abort); }
  }
  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    for (const url of this.urls.values()) this.revokeURL(url);
    this.urls.clear(); this.storage.close();
  }
}
export function createWebGalleryAdapter(options?: WebGalleryOptions): GalleryAdapter {
  return new WebGalleryAdapter(options);
}
