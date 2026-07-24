import React, { useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';

import './App.css';
import './v2-theme.css';

import NativeDetachedWindowApp from './components/NativeDetachedWindowApp';
import { setCurrentLanguage } from './i18n';
import { I18nProvider } from './i18n/provider';
import { applyDayjsLocale } from './i18n/runtime';
import { useStore } from './store';
import { configureAntdStaticOverlayLayer } from './utils/overlayZIndex';

configureAntdStaticOverlayLayer();

const readBrowserLanguages = (): string[] => {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
};

const serializeBrowserLanguages = (languages: readonly string[]) => languages.join('\n');

const deserializeBrowserLanguages = (snapshot: string) =>
  snapshot ? snapshot.split('\n').filter(Boolean) : [];

const getBrowserLanguageSnapshot = () => serializeBrowserLanguages(readBrowserLanguages());

const subscribeBrowserLanguageChange = (listener: () => void) => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener('languagechange', listener);
  return () => window.removeEventListener('languagechange', listener);
};

const disableDetachedPersistence = (): void => {
  useStore.persist.setOptions({
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
};

const NativeDetachedRoot = () => {
  const languagePreference = useStore((state) => state.languagePreference);
  const setLanguagePreference = useStore((state) => state.setLanguagePreference);
  const browserLanguageSnapshot = useSyncExternalStore(
    subscribeBrowserLanguageChange,
    getBrowserLanguageSnapshot,
    getBrowserLanguageSnapshot,
  );
  const systemLanguages = deserializeBrowserLanguages(browserLanguageSnapshot);
  const resolvedLanguage = setCurrentLanguage(languagePreference, systemLanguages);
  applyDayjsLocale(resolvedLanguage);

  return (
    <I18nProvider
      preference={languagePreference}
      onPreferenceChange={setLanguagePreference}
      systemLanguages={systemLanguages}
    >
      <NativeDetachedWindowApp />
    </I18nProvider>
  );
};

disableDetachedPersistence();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NativeDetachedRoot />
  </React.StrictMode>,
);
