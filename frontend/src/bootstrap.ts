import { loadCatalog } from './i18n/catalog';
import { resolveLanguage } from './i18n/resolveLanguage';
import { isNativeDetachedWindowRoute } from './utils/nativeDetachedWindowRoute';

type DetachedBootstrapRuntime = {
  loadBootstrap?: () => Promise<{
    payload?: { storeState?: { languagePreference?: string } };
  }>;
};

const readBrowserLanguages = (): string[] => {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
};

const readDetachedLanguagePreference = async (): Promise<string | undefined> => {
  if (typeof window === 'undefined') return undefined;
  const runtime = (window as typeof window & {
    __GONAVI_DETACHED__?: DetachedBootstrapRuntime;
  }).__GONAVI_DETACHED__;
  if (typeof runtime?.loadBootstrap !== 'function') return undefined;
  try {
    const bootstrap = await runtime.loadBootstrap();
    return bootstrap.payload?.storeState?.languagePreference;
  } catch {
    return undefined;
  }
};

const loadEntry = async (): Promise<void> => {
  const detached = isNativeDetachedWindowRoute();
  const preference = detached ? await readDetachedLanguagePreference() : undefined;
  const language = resolveLanguage(preference, readBrowserLanguages());
  await loadCatalog(language);
  if (detached) {
    await import('./nativeDetachedMain');
  } else {
    await import('./main');
  }
};

void loadEntry().catch((error) => {
  console.error('[GoNavi] Failed to load frontend entry', error);
});
