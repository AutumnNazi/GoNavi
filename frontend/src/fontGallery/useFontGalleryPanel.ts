import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFontGalleryAdapter } from './adapter';
import { injectDownloadedFontFaces, loadDownloadedFont, notifyFontGalleryChanged } from './faces';
import { fontGalleryErrorKey } from './errors';
import { useFontGalleryPreview } from './useFontGalleryPreview';
import type { FontEntry, FontGalleryState, FontInstalled, FontProgress } from './types';

export const fontEntryKey = (entry: FontEntry): string => entry.id + ':' + entry.version;
let requestSequence = 0;

export function useFontGalleryPanel(open: boolean) {
  const [state, setState] = useState<FontGalleryState>({ catalog: null, installed: [], stale: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState<FontProgress | null>(null);
  const [selectedId, select] = useState<string | null>(null);
  const active = useRef(false);
  const revision = useRef(0);
  const refreshRevision = useRef(0);
  const request = useRef<string | null>(null);
  const preview = useFontGalleryPreview(open);
  const setSelectedId = (id: string) => { preview.clear(); select(id); };
  const refresh = useCallback(async () => {
    const current = ++refreshRevision.current;
    setLoading(true); setError(null);
    try {
      const adapter = getFontGalleryAdapter();
      const local = await adapter.status();
      if (active.current && current === refreshRevision.current) setState(local);
      const next = await adapter.refresh();
      if (active.current && current === refreshRevision.current) setState(next);
    } catch (failure) {
      if (active.current && current === refreshRevision.current) setError(fontGalleryErrorKey(failure));
    } finally {
      if (active.current && current === refreshRevision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = open;
    setPending(null); setProgress(null); setLoading(false);
    if (open) void refresh();
    return () => {
      active.current = false;
      revision.current += 1;
      refreshRevision.current += 1;
      if (request.current) void getFontGalleryAdapter().cancel(request.current).catch(() => undefined);
      request.current = null;
    };
  }, [open, refresh]);
  const download = async (entry: FontEntry): Promise<FontInstalled | null> => {
    const current = ++revision.current;
    refreshRevision.current += 1; setLoading(false);
    const id = 'font-' + Date.now().toString(36) + '-' + (++requestSequence);
    request.current = id;
    setPending(fontEntryKey(entry)); setProgress(null); setError(null);
    try {
      const installed = await getFontGalleryAdapter().download(entry.id, entry.version, id, value => {
        if (active.current && revision.current === current) setProgress(value);
      });
      if (!active.current || revision.current !== current) return null;
      const next = await getFontGalleryAdapter().status();
      await loadDownloadedFont(installed);
      if (!active.current || revision.current !== current) return null;
      setState(next); injectDownloadedFontFaces(next.installed); notifyFontGalleryChanged();
      return installed;
    } catch (failure) {
      if (active.current && revision.current === current) setError(fontGalleryErrorKey(failure));
      return null;
    } finally {
      if (request.current === id) request.current = null;
      if (active.current && revision.current === current) { setPending(null); setProgress(null); }
    }
  };
  const remove = async (entry: FontEntry) => {
    const current = ++revision.current;
    refreshRevision.current += 1; setLoading(false);
    setPending(fontEntryKey(entry)); setError(null);
    try {
      await getFontGalleryAdapter().remove(entry.id, entry.version);
      const next = await getFontGalleryAdapter().status();
      if (active.current && revision.current === current) {
        setState(next); injectDownloadedFontFaces(next.installed); notifyFontGalleryChanged();
      }
    } catch (failure) {
      if (active.current && revision.current === current) setError(fontGalleryErrorKey(failure));
    } finally {
      if (active.current && revision.current === current) setPending(null);
    }
  };
  const entries = useMemo(() => {
    const list = [...(state.catalog?.entries ?? [])];
    for (const value of state.installed) {
      if (!list.some(entry => fontEntryKey(entry) === fontEntryKey(value.entry))) list.push(value.entry);
    }
    return list;
  }, [state]);
  return { state, entries, installed: state.installed, loading, error, pending, progress,
    selectedId, setSelectedId, refresh, download, remove, ...preview };
}
