import {
  BackgroundGalleryStatus, BackgroundGalleryRefresh, BackgroundGalleryResolve,
  BackgroundGalleryDownload, BackgroundGalleryCancel, BackgroundGalleryRemove,
} from '../../wailsjs/go/app/App';
import { EventsOn } from '../../wailsjs/runtime';
import { GalleryError, type GalleryAdapter, type GalleryInstalled, type GalleryProgress, type GalleryState } from './types';
import { validateCatalog, validateEntry, validateSelection } from './validation';
import { fetchGalleryThumbnail } from './thumbnail';

// Historical installed versions have a separate bound from the 64-entry catalog.
const MAX_INSTALLED_ENTRIES = 256;
interface Result { success: boolean; data?: unknown; message?: string }
function unwrap(result: Result): unknown {
  if (!result?.success) {
    const code = result?.data && typeof result.data === 'object' && 'code' in result.data ? String(result.data.code) : 'download_failed';
    throw Object.assign(new Error(code), { code });
  }
  return result.data;
}
function installed(value: unknown): GalleryInstalled {
  if (!value || typeof value !== 'object' || !('entry' in value) || !('url' in value)) throw new GalleryError('integrity');
  const entry = validateEntry(value.entry);
  const expectedURL = '/__gonavi/background-gallery/' + entry.image.path;
  if (value.url !== expectedURL) throw new GalleryError('integrity');
  return { entry, url: expectedURL };
}
function state(value: unknown): GalleryState {
  if (!value || typeof value !== 'object' || !('catalog' in value) || !('installed' in value)
      || !Array.isArray(value.installed) || value.installed.length > MAX_INSTALLED_ENTRIES) throw new GalleryError('invalid_catalog');
  return {
    catalog: value.catalog === null ? null : validateCatalog(value.catalog),
    installed: value.installed.map(installed),
    stale: 'stale' in value && value.stale === true,
    ...('warningCode' in value && typeof value.warningCode === 'string' ? { warningCode: value.warningCode } : {}),
  };
}
function progress(value: unknown, requestId: string): value is GalleryProgress {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<GalleryProgress>;
  return p.requestId === requestId && Number.isFinite(p.downloaded) && Number.isFinite(p.total)
    && (p.downloaded ?? -1) >= 0 && (p.total ?? -1) > 0 && (p.downloaded ?? 0) <= (p.total ?? 0) && typeof p.phase === 'string';
}

export function createDesktopGalleryAdapter(): GalleryAdapter {
  const requests = new Map<string, () => void>();
  const thumbnails = new Map<string, string>();
  const thumbnailRequests = new Set<AbortController>();
  let disposed = false;
  return {
    status: async () => state(unwrap(await BackgroundGalleryStatus())),
    refresh: async () => state(unwrap(await BackgroundGalleryRefresh())),
    resolve: async (id, version) => { validateSelection(id, version, true); return installed(unwrap(await BackgroundGalleryResolve(id, version))); },
    download: async (id, version, requestId, onProgress) => {
      validateSelection(id, version);
      if (disposed || requests.has(requestId)) throw new GalleryError('canceled');
      let canceled = false;
      const off = EventsOn('background-gallery:progress', (value: unknown) => {
        if (!canceled && progress(value, requestId)) onProgress?.(value);
      });
      requests.set(requestId, () => { canceled = true; off(); });
      try {
        const value = installed(unwrap(await BackgroundGalleryDownload(id, version, requestId)));
        if (canceled || disposed) throw new GalleryError('canceled');
        return value;
      } finally { off(); requests.delete(requestId); }
    },
    cancel: async (requestId) => { requests.get(requestId)?.(); unwrap(await BackgroundGalleryCancel(requestId)); },
    remove: async (id, version) => { validateSelection(id, version); unwrap(await BackgroundGalleryRemove(id, version)); },
    thumbnail: async (entry, signal) => {
      validateEntry(entry);
      if (disposed || signal?.aborted) throw new GalleryError('canceled');
      const cached = thumbnails.get(entry.thumbnail.sha256);
      if (cached) return cached;
      if (thumbnailRequests.size >= 6) throw new GalleryError('unavailable');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true }); thumbnailRequests.add(controller);
      try {
        const url = await fetchGalleryThumbnail(entry, controller.signal);
        if (disposed || controller.signal.aborted) { URL.revokeObjectURL(url); throw new GalleryError('canceled'); }
        const previous = thumbnails.get(entry.thumbnail.sha256);
        if (previous) { URL.revokeObjectURL(url); return previous; }
        if (thumbnails.size >= 64) {
          const oldest = thumbnails.entries().next().value;
          if (oldest) { URL.revokeObjectURL(oldest[1]); thumbnails.delete(oldest[0]); }
        }
        thumbnails.set(entry.thumbnail.sha256, url); return url;
      } finally { signal?.removeEventListener('abort', abort); thumbnailRequests.delete(controller); }
    },
    dispose: () => {
      disposed = true;
      for (const [id, off] of requests) { off(); void BackgroundGalleryCancel(id).catch(() => undefined); }
      requests.clear(); thumbnailRequests.forEach(controller => controller.abort()); thumbnailRequests.clear();
      thumbnails.forEach(url => URL.revokeObjectURL(url)); thumbnails.clear();
    },
  };
}
