import type { BackgroundImageState } from './backgroundImageStore';
import type { GalleryInstalled, GalleryProgress } from './backgroundGallery/types';
import { getGalleryAdapter } from './backgroundGallery/adapter';
import { BackgroundImageError } from './utils/backgroundImage';
import { getBuiltinBackground } from './utils/builtinBackgrounds';
import { persistSnapshot, snapshotOf, validGalleryId, validGalleryVersion } from './backgroundImageStorePersistence';

type SetState = (value: Partial<BackgroundImageState>) => void;
let requestSequence = 0;
export function createSelectionGate() {
  let revision = 0;
  let cancel: (() => void) | undefined;
  return {
    current: () => revision,
    invalidate: () => { revision += 1; const previous = cancel; cancel = undefined; previous?.(); return revision; },
    onCancel: (callback?: () => void) => { cancel = callback; },
  };
}

export function createGallerySelectionActions(get: () => BackgroundImageState, set: SetState, gate: ReturnType<typeof createSelectionGate>) {
  let resolving: Promise<void> | undefined;
  const selectBuiltin = async (id: string, version = '', onProgress?: (value: GalleryProgress) => void) => {
    if (!validGalleryId(id) || (version ? !validGalleryVersion(version) : !getBuiltinBackground(id))) {
      throw new BackgroundImageError('invalid-image');
    }
    const revision = gate.invalidate();
    const requestId = 'gallery-' + Date.now().toString(36) + '-' + (++requestSequence).toString(36);
    const adapter = await getGalleryAdapter();
    if (gate.current() !== revision) return;
    gate.onCancel(() => { void adapter.cancel(requestId).catch(() => undefined); });
    try {
      let installed: GalleryInstalled;
      try { installed = await adapter.resolve(id, version); }
      catch {
        if (gate.current() !== revision) return;
        // Empty version is a legacy local-only resolution, never an implicit remote refresh.
        if (!version) throw new BackgroundImageError('invalid-image');
        installed = await adapter.download(id, version, requestId, (progress) => {
          if (gate.current() === revision) onProgress?.(progress);
        });
      }
      if (gate.current() !== revision) return;
      if (installed.entry.id !== id || (version && installed.entry.version !== version)) throw new BackgroundImageError('invalid-image');
      const next = { ...snapshotOf(get()), image: null, builtinId: id, builtinVersion: installed.entry.version, enabled: true };
      persistSnapshot(next);
      set({ ...next, resolvedGallery: installed, galleryError: null, previewPosition: null });
    } finally { if (gate.current() === revision) gate.onCancel(undefined); }
  };
  const resolveSelected = (): Promise<void> => {
    const { builtinId, builtinVersion, resolvedGallery, resolutionRevision } = get();
    if (!builtinId || resolvedGallery) return Promise.resolve();
    if (resolving) return resolving;
    const isCurrent = () => get().builtinId === builtinId && get().builtinVersion === builtinVersion
      && get().resolutionRevision === resolutionRevision;
    const task = (async () => {
      try {
        const installed = await (await getGalleryAdapter()).resolve(builtinId, builtinVersion);
        if (installed.entry.id !== builtinId || (builtinVersion && installed.entry.version !== builtinVersion)) throw new BackgroundImageError('invalid-image');
        if (isCurrent()) set({ resolvedGallery: installed, galleryError: null });
      } catch (error) {
        if (isCurrent()) {
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unavailable';
          set({ galleryError: code });
        }
      }
    })();
    resolving = task;
    void task.finally(() => { if (resolving === task) resolving = undefined; });
    return task;
  };
  return { selectBuiltin, resolveSelected, cancelGallerySelection: () => { gate.invalidate(); resolving = undefined; } };
}
