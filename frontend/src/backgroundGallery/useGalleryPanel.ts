import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackgroundImageStore } from '../backgroundImageStore';
import { getGalleryAdapter } from './adapter';
import { galleryErrorKey } from './errors';
import type { GalleryEntry, GalleryProgress, GalleryState } from './types';

export const galleryEntryKey = (entry: GalleryEntry): string => `${entry.id}:${entry.version}`;

export function useGalleryPanel() {
  const [state, setState] = useState<GalleryState>({ catalog: null, installed: [], stale: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [progress, setProgress] = useState<GalleryProgress | null>(null);
  const active = useRef(false);
  const operation = useRef(0);
  const refreshRevision = useRef(0);
  const cancel = useCallback(() => {
    operation.current += 1;
    useBackgroundImageStore.getState().cancelGallerySelection();
    if (active.current) { setPending(null); setProgress(null); }
  }, []);
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    setLoading(true); setError(null);
    try {
      const adapter = await getGalleryAdapter();
      const local = await adapter.status();
      if (active.current && revision === refreshRevision.current) setState(local);
      const next = await adapter.refresh();
      if (active.current && revision === refreshRevision.current) setState(next);
    } catch (failure) {
      if (active.current && revision === refreshRevision.current) setError(galleryErrorKey(failure));
    } finally { if (active.current && revision === refreshRevision.current) setLoading(false); }
  }, []);
  useEffect(() => {
    active.current = true; void refresh();
    return () => { active.current = false; refreshRevision.current += 1; cancel(); };
  }, [refresh, cancel]);
  const select = async (entry: GalleryEntry) => {
    cancel(); const revision = operation.current;
    setPending(galleryEntryKey(entry)); setFailed(null); setProgress(null); setError(null);
    try {
      await useBackgroundImageStore.getState().selectBuiltin(entry.id, entry.version, value => {
        if (active.current && operation.current === revision) setProgress(value);
      });
      if (!active.current || operation.current !== revision) return;
      const next = await (await getGalleryAdapter()).status();
      if (active.current && operation.current === revision) setState(next);
    } catch (failure) {
      if (active.current && operation.current === revision) { setFailed(galleryEntryKey(entry)); setError(galleryErrorKey(failure)); }
    } finally { if (active.current && operation.current === revision) { setPending(null); setProgress(null); } }
  };
  const remove = async (entry: GalleryEntry) => {
    const current = useBackgroundImageStore.getState();
    const version = current.builtinVersion || current.resolvedGallery?.entry.version;
    if (current.builtinId === entry.id && (!version || version === entry.version)) return;
    cancel(); const revision = operation.current;
    setError(null);
    try {
      const adapter = await getGalleryAdapter();
      await adapter.remove(entry.id, entry.version);
      const next = await adapter.status();
      if (active.current && operation.current === revision) setState(next);
    } catch (failure) { if (active.current && operation.current === revision) setError(galleryErrorKey(failure)); }
  };
  // Keep exact installed versions available offline even when the catalog advances.
  const entries = [...(state.catalog?.entries ?? [])];
  for (const value of state.installed) if (!entries.some(entry => galleryEntryKey(entry) === galleryEntryKey(value.entry))) entries.push(value.entry);
  return { state, entries, loading, error, pending, failed, progress, refresh, select, cancel, remove };
}
