import { useEffect, useRef, type MutableRefObject } from 'react';
import { ListInstalledFontFamilies } from '../../../wailsjs/go/app/App';
import { sanitizeFontFamilyInput, type InstalledFontFamily } from '../../utils/fontFamilies';
import type { SettingsCenterPaneKey } from '../settingsCenterPanes';

interface Input {
  activePane?: SettingsCenterPaneKey;
  runtimePlatform: string;
  isThemeModalOpen: boolean;
  themeModalSection: string;
  hasLoadedInstalledFontsRef: MutableRefObject<boolean>;
  setIsFontFamiliesLoading: (loading: boolean) => void;
  setFontFamiliesLoadError: (error: string | null) => void;
  setInstalledFontFamilies: (fonts: InstalledFontFamily[]) => void;
  t: (key: string) => string;
}

const normalizeFonts = (data: unknown): InstalledFontFamily[] => {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || !('family' in item)) return [];
    const family = sanitizeFontFamilyInput(item.family);
    if (!family) return [];
    return [{ family, path: 'path' in item && typeof item.path === 'string' ? item.path : undefined }];
  });
};

export function useInstalledFontFamilies({
  activePane, runtimePlatform, isThemeModalOpen, themeModalSection,
  hasLoadedInstalledFontsRef, setIsFontFamiliesLoading, setFontFamiliesLoadError,
  setInstalledFontFamilies, t,
}: Input) {
  const pending = useRef<ReturnType<typeof ListInstalledFontFamilies> | null>(null);
  const enabled = runtimePlatform === 'linux' || activePane === 'fonts-settings'
    || ((isThemeModalOpen || activePane === 'theme') && themeModalSection === 'appearance');

  useEffect(() => {
    if (!enabled || hasLoadedInstalledFontsRef.current) return;
    let cancelled = false;
    setIsFontFamiliesLoading(true);
    setFontFamiliesLoadError(null);
    // StrictMode 或快速切页时复用在途请求；仅成功接收结果后标记已加载。
    const request = pending.current ?? Promise.resolve().then(() => ListInstalledFontFamilies());
    pending.current = request;
    void request.then(result => {
      if (cancelled) return;
      if (!result?.success) throw new Error(result?.message || t('app.theme.font_family.load_failed'));
      setInstalledFontFamilies(normalizeFonts(result.data));
      hasLoadedInstalledFontsRef.current = true;
    }).catch((error: unknown) => {
      if (cancelled) return;
      hasLoadedInstalledFontsRef.current = false;
      setFontFamiliesLoadError(error instanceof Error ? error.message : t('app.theme.font_family.load_failed'));
    }).finally(() => {
      if (pending.current === request) pending.current = null;
      if (!cancelled) setIsFontFamiliesLoading(false);
    });
    return () => {
      cancelled = true;
      setIsFontFamiliesLoading(false);
    };
  }, [enabled, hasLoadedInstalledFontsRef, setIsFontFamiliesLoading, setFontFamiliesLoadError, setInstalledFontFamilies, t]);
}
