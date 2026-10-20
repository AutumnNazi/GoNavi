import { useEffect, useRef, useState } from 'react';
import { getPrimaryFontFamily } from '../utils/fontFamilyDisplay';
import { fontFamilyKey } from './options';
import { loadDownloadedFont } from './faces';
import { fontGalleryErrorKey } from './errors';
import type { FontInstalled } from './types';

export function useDownloadedFontSelection(installed: FontInstalled[], onSelect: (kind: 'ui' | 'mono', value: string | null) => void) {
  const revision = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { revision.current += 1; }, []);
  const selectFont = async (kind: 'ui' | 'mono', value: string | null) => {
    const current = ++revision.current;
    setError(null); setLoading(true);
    try {
      const family = value ? fontFamilyKey(getPrimaryFontFamily(value)) : '';
      const downloaded = installed.find(item => fontFamilyKey(item.family) === family);
      if (downloaded) await loadDownloadedFont(downloaded);
      if (current === revision.current) onSelect(kind, value);
    } catch (failure) {
      if (current === revision.current) setError(fontGalleryErrorKey(failure));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  };
  return { selectFont, loading, error };
}
