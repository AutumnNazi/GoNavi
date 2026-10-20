import { useCallback, useEffect, useRef, useState } from 'react';
import { getFontGalleryAdapter } from './adapter';
import { fontGalleryErrorKey } from './errors';
import { FontGalleryError, type FontEntry, type FontInstalled } from './types';

let sequence = 0;
export function useFontGalleryPreview(open: boolean) {
  const [state, setState] = useState<{ key: string; family?: string; error?: string; loading?: boolean } | null>(null);
  const revision = useRef(0);
  const request = useRef<string | null>(null);
  const face = useRef<FontFace | null>(null);
  const clear = useCallback(() => {
    revision.current += 1;
    if (request.current) void getFontGalleryAdapter().cancel(request.current).catch(() => undefined);
    request.current = null;
    if (face.current) document.fonts.delete(face.current);
    face.current = null;
    setState(null);
  }, []);
  useEffect(() => clear, [open, clear]);
  const preview = async (entry: FontEntry, installed?: FontInstalled) => {
    clear();
    const current = revision.current;
    const key = entry.id + ':' + entry.version;
    const id = 'font-preview-' + Date.now().toString(36) + '-' + (++sequence);
    request.current = id;
    setState({ key, loading: true });
    try {
      const result = installed
        ? { family: 'GoNaviFontPreview-' + installed.entry.id, url: installed.url }
        : await getFontGalleryAdapter().preview(entry.id, entry.version, id);
      if (current !== revision.current) return;
      const next = new FontFace(result.family, 'url("' + result.url + '")');
      await next.load();
      if (current !== revision.current) return;
      if (next.status !== 'loaded') throw new FontGalleryError('preview_failed');
      document.fonts.add(next);
      face.current = next;
      setState({ key, family: result.family });
    } catch (error) {
      if (current === revision.current) setState({ key, error: fontGalleryErrorKey(error) });
    } finally {
      if (request.current === id) request.current = null;
    }
  };
  return { preview, clear, previewState: state };
}
