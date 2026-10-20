import { useEffect } from 'react';
import { getFontGalleryAdapter } from './adapter';
import { injectDownloadedFontFaces } from './faces';
import { FONT_GALLERY_CHANGED } from './types';

export function useFontGalleryFaces(): void {
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const apply = async () => {
      const current = ++revision;
      try {
        const state = await getFontGalleryAdapter().status();
        if (!cancelled && revision === current) injectDownloadedFontFaces(state.installed);
      } catch {
        if (!cancelled && revision === current) injectDownloadedFontFaces([]);
      }
    };
    void apply();
    const onChange = () => { void apply(); };
    window.addEventListener(FONT_GALLERY_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(FONT_GALLERY_CHANGED, onChange);
    };
  }, []);
}
