import { EventsOn } from '../../wailsjs/runtime';
import { FontGalleryStatus, FontGalleryRefresh, FontGalleryResolve, FontGalleryDownload, FontGalleryPreview, FontGalleryCancel, FontGalleryRemove } from '../../wailsjs/go/app/App';
import { FontGalleryError, type FontGalleryAdapter, type FontInstalled, type FontPreviewed, type FontProgress, type FontGalleryState } from './types';
import { validateCatalog, validateEntry, validateSelection } from './validation';

const MAX_INSTALLED = 256;
interface Result { success: boolean; data?: unknown; message?: string }

function invoke(name: string, call: () => Promise<Result>): Promise<Result> {
  const go = (window as unknown as { go?: { app?: { App?: Record<string, unknown> } } }).go?.app?.App;
  const fn = go?.[name];
  if (typeof fn !== 'function') throw new FontGalleryError('unsupported_environment');
  return call();
}
function unwrap(result: Result): unknown {
  if (!result?.success) {
    const code = result?.data && typeof result.data === 'object' && 'code' in result.data ? String(result.data.code) : 'download_failed';
    throw Object.assign(new Error(code), { code });
  }
  return result.data;
}
function installed(value: unknown): FontInstalled {
  if (!value || typeof value !== 'object' || !('entry' in value) || !('url' in value) || !('family' in value)) throw new FontGalleryError('integrity');
  const entry = validateEntry(value.entry);
  const expectedURL = '/__gonavi/font-gallery/' + entry.font.path;
  if (value.url !== expectedURL || value.family !== 'GoNaviFont-' + entry.id) throw new FontGalleryError('integrity');
  return { entry, family: String(value.family), url: expectedURL };
}
function previewed(value: unknown): FontPreviewed {
  if (!value || typeof value !== 'object' || !('entry' in value) || !('url' in value) || !('family' in value)) throw new FontGalleryError('integrity');
  const entry = validateEntry(value.entry);
  const expectedURL = '/__gonavi/font-gallery/' + entry.preview.path;
  if (value.url !== expectedURL || value.family !== 'GoNaviFontPreview-' + entry.id) throw new FontGalleryError('preview_failed');
  return { entry, family: String(value.family), url: expectedURL };
}
function state(value: unknown): FontGalleryState {
  if (!value || typeof value !== 'object' || !('catalog' in value) || !('installed' in value)
      || !Array.isArray(value.installed) || value.installed.length > MAX_INSTALLED) throw new FontGalleryError('invalid_catalog');
  return {
    catalog: value.catalog === null ? null : validateCatalog(value.catalog),
    installed: value.installed.map(installed),
    stale: 'stale' in value && value.stale === true,
    ...('warningCode' in value && typeof value.warningCode === 'string' ? { warningCode: value.warningCode } : {}),
  };
}
function progress(value: unknown, requestId: string): value is FontProgress {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<FontProgress>;
  return p.requestId === requestId && Number.isFinite(p.downloaded) && Number.isFinite(p.total)
    && (p.downloaded ?? -1) >= 0 && (p.total ?? -1) > 0 && (p.downloaded ?? 0) <= (p.total ?? 0) && typeof p.phase === 'string';
}

export function createDesktopFontGalleryAdapter(): FontGalleryAdapter {
  const requests = new Map<string, () => void>();
  let disposed = false;
  const listen = (requestId: string, onProgress?: (value: FontProgress) => void) => {
    let canceled = false;
    const off = EventsOn('font-gallery:progress', (value: unknown) => {
      if (!canceled && progress(value, requestId)) onProgress?.(value);
    });
    requests.set(requestId, () => { canceled = true; off(); });
    return () => { off(); requests.delete(requestId); };
  };
  return {
    status: async () => state(unwrap(await invoke('FontGalleryStatus', FontGalleryStatus))),
    refresh: async () => state(unwrap(await invoke('FontGalleryRefresh', FontGalleryRefresh))),
    resolve: async (id, version) => { validateSelection(id, version, true); return installed(unwrap(await invoke('FontGalleryResolve', () => FontGalleryResolve(id, version)))); },
    download: async (id, version, requestId, onProgress) => {
      validateSelection(id, version);
      if (disposed || requests.has(requestId)) throw new FontGalleryError('canceled');
      const done = listen(requestId, onProgress);
      try {
        const value = installed(unwrap(await invoke('FontGalleryDownload', () => FontGalleryDownload(id, version, requestId))));
        if (disposed) throw new FontGalleryError('canceled');
        return value;
      } finally { done(); }
    },
    preview: async (id, version, requestId, onProgress) => {
      validateSelection(id, version);
      if (disposed || requests.has(requestId)) throw new FontGalleryError('canceled');
      const done = listen(requestId, onProgress);
      try {
        const value = previewed(unwrap(await invoke('FontGalleryPreview', () => FontGalleryPreview(id, version, requestId))));
        if (disposed) throw new FontGalleryError('canceled');
        return value;
      } finally { done(); }
    },
    cancel: async (requestId) => { requests.get(requestId)?.(); unwrap(await invoke('FontGalleryCancel', () => FontGalleryCancel(requestId))); },
    remove: async (id, version) => { validateSelection(id, version); unwrap(await invoke('FontGalleryRemove', () => FontGalleryRemove(id, version))); },
    dispose: () => {
      disposed = true;
      for (const [id, off] of requests) { off(); void invoke('FontGalleryCancel', () => FontGalleryCancel(id)).catch(() => undefined); }
      requests.clear();
    },
  };
}

let adapter: FontGalleryAdapter | undefined;
export function getFontGalleryAdapter(): FontGalleryAdapter {
  if (!adapter) adapter = createDesktopFontGalleryAdapter();
  return adapter;
}
