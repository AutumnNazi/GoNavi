import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createWebGalleryAdapter } from './webAdapter';
import { BaseURL } from './types';
import type { GalleryCatalog, GalleryEntry } from './types';
import type { GalleryStoredImage, GalleryStorage } from './webStorage';

class MemoryStorage implements GalleryStorage {
  catalog: GalleryCatalog | null = null;
  images = new Map<string, GalleryStoredImage>();
  async preflight() {}
  async getCatalog() { return structuredClone(this.catalog); }
  async putCatalog(value: GalleryCatalog) { this.catalog = structuredClone(value); }
  async list() { return structuredClone([...this.images.values()]); }
  async get(id: string, version: string) { return structuredClone(this.images.get(id + '@' + version) ?? null); }
  async install(value: GalleryStoredImage) { this.images.set(value.entry.id + '@' + value.entry.version, structuredClone(value)); }
  async remove(id: string, version: string) { this.images.delete(id + '@' + version); }
  close() {}
}
function harness(storage = new MemoryStorage()) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const createObjectURL = vi.fn(() => 'blob:test-' + Math.random());
  const revokeObjectURL = vi.fn();
  const adapter = createWebGalleryAdapter({ storage, fetch, subtle: webcrypto.subtle as SubtleCrypto,
    decode: async () => ({ width: 1, height: 1 }), createObjectURL, revokeObjectURL });
  return { adapter, storage, fetch, createObjectURL, revokeObjectURL };
}

async function fixture() {
  const chunk = (name: string, data: number[]) => {
    const bytes = new Uint8Array(data.length + 12);
    new DataView(bytes.buffer).setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(name), 4); bytes.set(data, 8); return Array.from(bytes);
  };
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND', [])]);
  const hash = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  const asset = { path: 'assets/' + hash + '.png', sha256: hash, sizeBytes: bytes.length, width: 1, height: 1, mimeType: 'image/png' as const };
  const entry: GalleryEntry = { id: 'test-pattern', version: '1', names: { en: 'Synthetic test' }, fit: 'contain', image: asset, thumbnail: { ...asset },
    attribution: 'Test author', sourceUrl: 'https://example.org/source', rightsStatus: 'approved',
    license: { id: 'test', name: 'Test', url: 'https://example.org/license', notice: 'Test notice', text: 'Synthetic test only', nonCommercial: true } };
  return { bytes, entry, catalog: { schemaVersion: 1 as const, version: '1', entries: [entry] } };
}
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.useRealTimers());

describe('browser gallery explicit network boundary', () => {
  it('falls back to a stale valid catalogue when a refresh times out', async () => {
    vi.useFakeTimers(); const f = await fixture(); const h = harness(); h.storage.catalog = f.catalog;
    let requested!: () => void; const started = new Promise<void>(resolve => { requested = resolve; });
    h.fetch.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      requested();
    }));
    const result = h.adapter.refresh();
    const assertion = expect(result).resolves.toMatchObject({ catalog: f.catalog, stale: true, warningCode: 'download_failed' });
    await started; await vi.advanceTimersByTimeAsync(30_001); await assertion;
  });
  it('refreshes explicitly, commits bytes plus metadata, then restores offline in another instance', async () => {
    const f = await fixture();
    const h = harness();
    h.fetch.mockResolvedValueOnce(jsonResponse(f.catalog));
    await expect(h.adapter.refresh()).resolves.toMatchObject({ catalog: f.catalog, stale: false });
    h.fetch.mockResolvedValueOnce(new Response(f.bytes, { headers: { 'Content-Type': 'image/png' } }));
    const progress = vi.fn();
    const installed = await h.adapter.download(f.entry.id, f.entry.version, 'request-1', progress);
    expect(installed.entry.license).toEqual(f.entry.license);
    expect(installed.url).toMatch(/^blob:/);
    expect(h.storage.images.size).toBe(1);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-1', downloaded: f.bytes.length, total: f.bytes.length }));
    expect(h.fetch).toHaveBeenNthCalledWith(1, BaseURL + 'catalog.json', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    expect(h.fetch).toHaveBeenNthCalledWith(2, BaseURL + f.entry.image.path, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    h.adapter.dispose();
    expect(h.revokeObjectURL).toHaveBeenCalledWith(installed.url);
    const next = harness(h.storage);
    await expect(next.adapter.resolve(f.entry.id, '')).resolves.toMatchObject({ entry: f.entry, url: expect.stringMatching(/^blob:/) });
    expect(next.fetch).not.toHaveBeenCalled();
  });
  it('retains the last validated catalogue with stale warning on CORS and invalid refresh failures', async () => {
    const f = await fixture(); const h = harness(); h.storage.catalog = f.catalog;
    h.fetch.mockRejectedValueOnce(new TypeError('CORS denied'));
    await expect(h.adapter.refresh()).resolves.toMatchObject({ catalog: f.catalog, stale: true, warningCode: 'download_failed' });
    h.fetch.mockResolvedValueOnce(jsonResponse({ ...f.catalog, entries: [{ ...f.entry, rightsStatus: 'pending' }] }));
    await expect(h.adapter.refresh()).resolves.toMatchObject({ catalog: f.catalog, stale: true, warningCode: 'invalid_catalog' });
    expect(h.storage.catalog).toEqual(f.catalog);
  });
  it('fails closed before network when crypto or storage is unavailable', async () => {
    const h = harness();
    const noCrypto = createWebGalleryAdapter({ storage: h.storage, subtle: null, fetch: h.fetch, decode: async () => ({ width: 1, height: 1 }) });
    await expect(noCrypto.refresh()).rejects.toMatchObject({ code: 'unsupported_environment' });
    vi.spyOn(h.storage, 'preflight').mockRejectedValueOnce(new DOMException('Disabled', 'SecurityError'));
    await expect(h.adapter.refresh()).rejects.toMatchObject({ code: 'storage_failed' });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('keeps the previous installed image when a new download cannot commit its transaction', async () => {
    const f = await fixture(); const h = harness(); h.storage.catalog = f.catalog;
    await h.storage.install({ entry: f.entry, blob: new Blob([f.bytes], { type: 'image/png' }) });
    const original = await h.adapter.resolve(f.entry.id, f.entry.version);
    h.fetch.mockResolvedValueOnce(new Response(f.bytes, { headers: { 'Content-Type': 'image/png' } }));
    vi.spyOn(h.storage, 'install').mockRejectedValueOnce(new DOMException('Quota', 'QuotaExceededError'));
    await expect(h.adapter.download(f.entry.id, f.entry.version, 'quota')).rejects.toMatchObject({ code: 'storage_failed' });
    await expect(h.adapter.resolve(f.entry.id, f.entry.version)).resolves.toEqual(original);
    expect(h.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('rejects a corrupted offline cache without fetching and omits it from installed status', async () => {
    const f = await fixture(); const h = harness();
    const bytes = f.bytes.slice(); bytes[bytes.length - 1] ^= 1;
    await h.storage.install({ entry: f.entry, blob: new Blob([bytes], { type: 'image/png' }) });
    await expect(h.adapter.resolve(f.entry.id, f.entry.version)).rejects.toMatchObject({ code: 'integrity' });
    await expect(h.adapter.status()).resolves.toMatchObject({ installed: [], warningCode: 'integrity' });
    expect(h.createObjectURL).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(['oversized', 'wrong-mime', 'wrong-hash', 'redirect', 'truncated'])('rejects %s downloads without exposing a URL or partial install', async kind => {
    const f = await fixture(); const h = harness(); h.storage.catalog = f.catalog;
    let response: Response;
    if (kind === 'oversized') response = new Response(new Uint8Array(f.bytes.length + 1), { headers: { 'Content-Type': 'image/png' } });
    else if (kind === 'wrong-mime') response = new Response(f.bytes, { headers: { 'Content-Type': 'image/svg+xml' } });
    else if (kind === 'truncated') response = new Response(f.bytes.slice(0, -1), { headers: { 'Content-Type': 'image/png' } });
    else {
      const bytes = f.bytes.slice(); if (kind === 'wrong-hash') bytes[bytes.length - 1] ^= 1;
      response = new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
      if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    }
    h.fetch.mockResolvedValueOnce(response);
    await expect(h.adapter.download(f.entry.id, f.entry.version, 'invalid')).rejects.toMatchObject({ code: kind === 'redirect' ? 'download_failed' : 'integrity' });
    expect(h.storage.images.size).toBe(0); expect(h.createObjectURL).not.toHaveBeenCalled();
  });
  it('cancels a pending stream and never commits, including immediate cancellation before preflight', async () => {
    const f = await fixture(); const h = harness(); h.storage.catalog = f.catalog;
    const cancel = vi.fn(); let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const stream = new ReadableStream<Uint8Array>({ pull() { started(); }, cancel }, { highWaterMark: 0 });
    h.fetch.mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'image/png' } }));
    const pending = h.adapter.download(f.entry.id, f.entry.version, 'cancel');
    const rejection = expect(pending).rejects.toMatchObject({ code: 'canceled' });
    await reading; await h.adapter.cancel('cancel'); await rejection;
    expect(cancel).toHaveBeenCalled(); expect(h.storage.images.size).toBe(0);
    const immediate = h.adapter.download(f.entry.id, f.entry.version, 'immediate');
    const immediateRejection = expect(immediate).rejects.toMatchObject({ code: 'canceled' });
    await h.adapter.cancel('immediate'); await immediateRejection;
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('validates thumbnail bytes, caches only ephemeral URLs and releases them on disposal', async () => {
    const f = await fixture(); const h = harness();
    const controller = new AbortController(); controller.abort();
    await expect(h.adapter.thumbnail(f.entry, controller.signal)).rejects.toMatchObject({ code: 'canceled' });
    expect(h.fetch).not.toHaveBeenCalled();
    h.fetch.mockResolvedValueOnce(new Response(f.bytes, { headers: { 'Content-Type': 'image/png' } }));
    const url = await h.adapter.thumbnail(f.entry);
    await expect(h.adapter.thumbnail(f.entry)).resolves.toBe(url);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.storage.images.size).toBe(0);
    h.adapter.dispose(); expect(h.revokeObjectURL).toHaveBeenCalledWith(url);
    await expect(h.adapter.thumbnail(f.entry)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('removes only the requested version and revokes its URL after successful deletion', async () => {
    const f = await fixture(); const h = harness();
    await h.storage.install({ entry: f.entry, blob: new Blob([f.bytes], { type: 'image/png' }) });
    await h.storage.install({ entry: { ...f.entry, version: '2' }, blob: new Blob([f.bytes], { type: 'image/png' }) });
    const first = await h.adapter.resolve(f.entry.id, '1'); const second = await h.adapter.resolve(f.entry.id, '2');
    await h.adapter.remove(f.entry.id, '1');
    await expect(h.adapter.resolve(f.entry.id, '1')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(h.adapter.resolve(f.entry.id, '2')).resolves.toEqual(second);
    expect(h.revokeObjectURL).toHaveBeenCalledWith(first.url); expect(h.revokeObjectURL).not.toHaveBeenCalledWith(second.url);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('does not resolve a mismatched persisted identity or let callers mutate an in-flight thumbnail entry', async () => {
    const f = await fixture(); const h = harness();
    h.storage.images.set('test-pattern@1', { entry: { ...f.entry, id: 'another-image' }, blob: new Blob([f.bytes], { type: 'image/png' }) });
    await expect(h.adapter.resolve('test-pattern', '1')).rejects.toMatchObject({ code: 'integrity' });
    h.fetch.mockResolvedValueOnce(new Response(f.bytes, { headers: { 'Content-Type': 'image/png' } }));
    const pending = h.adapter.thumbnail(f.entry);
    f.entry.thumbnail.path = 'https://evil.example/image.png';
    await expect(pending).resolves.toMatch(/^blob:/);
    expect(h.fetch).toHaveBeenCalledWith(expect.stringContaining(BaseURL + 'assets/'), expect.anything());
  });
  it('queues visible thumbnail bursts rather than failing cards beyond the concurrency limit', async () => {
    const f = await fixture(); const h = harness();
    let started!: () => void; const sixStarted = new Promise<void>(resolve => { started = resolve; });
    const responses: Array<(response: Response) => void> = [];
    h.fetch.mockImplementation(() => new Promise(resolve => { responses.push(resolve); if (responses.length === 6) started(); }));
    const requests = Array.from({ length: 7 }, () => h.adapter.thumbnail(f.entry));
    const all = Promise.all(requests); void all.catch(() => undefined);
    await sixStarted;
    expect(h.fetch).toHaveBeenCalledTimes(6);
    for (const resolve of responses) resolve(new Response(f.bytes, { headers: { 'Content-Type': 'image/png' } }));
    await expect(all).resolves.toHaveLength(7);
  });
  it('starts with local status and resolves a missing legacy selection without networking', async () => {
    const { adapter, fetch } = harness();
    await expect(adapter.status()).resolves.toEqual({ catalog: null, installed: [], stale: false });
    await expect(adapter.resolve('whale-maid-a', '')).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
