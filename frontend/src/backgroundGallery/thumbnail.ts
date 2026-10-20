import { GalleryError, type GalleryEntry } from './types';
import { assetURL, MAX_THUMBNAIL_BYTES, validateEntry, validateImage } from './validation';

export async function fetchGalleryThumbnail(entry: GalleryEntry, signal?: AbortSignal): Promise<string> {
  validateEntry(entry);
  if (!globalThis.crypto?.subtle || typeof createImageBitmap !== 'function') throw new GalleryError('unsupported_environment');
  const asset = entry.thumbnail;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 30_000);
  try {
    const url = assetURL(asset, MAX_THUMBNAIL_BYTES);
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal, referrerPolicy: 'no-referrer' });
    if (!response.ok || response.redirected || (response.url && response.url !== url) || response.headers.get('content-type')?.split(';')[0].trim() !== asset.mimeType) throw new GalleryError('integrity');
    const length = response.headers.get('content-length');
    if (length && Number(length) !== asset.sizeBytes) throw new GalleryError('integrity');
    if (!response.body) throw new GalleryError('download_failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > asset.sizeBytes || size > MAX_THUMBNAIL_BYTES) throw new GalleryError('integrity');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (size !== asset.sizeBytes) throw new GalleryError('integrity');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const blob = new Blob([bytes], { type: asset.mimeType });
    await validateImage(blob, asset, crypto.subtle, undefined, MAX_THUMBNAIL_BYTES);
    if (controller.signal.aborted) throw new GalleryError('canceled');
    return URL.createObjectURL(blob);
  } catch (error) {
    if (controller.signal.aborted) throw new GalleryError('canceled');
    throw error instanceof GalleryError ? error : new GalleryError('download_failed');
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
