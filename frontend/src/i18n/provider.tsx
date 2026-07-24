import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { hasCatalog, loadCatalog, type I18nKey } from "./catalog";
import { t as translate } from "./index";
import { resolveLanguage } from "./resolveLanguage";
import { syncLanguageRuntime } from "./runtime";
import type { I18nParams, LanguagePreference, SupportedLanguage } from "./types";

interface I18nContextValue {
  language: SupportedLanguage;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: I18nKey | string, params?: I18nParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const readBrowserLanguages = (): string[] => {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
};

export const I18nProvider: React.FC<{
  children: React.ReactNode;
  preference: LanguagePreference;
  systemLanguages?: readonly string[];
  onPreferenceChange: (preference: LanguagePreference) => void;
}> = ({ children, preference, systemLanguages, onPreferenceChange }) => {
  const language = resolveLanguage(preference, systemLanguages ?? readBrowserLanguages());
  const [readyLanguage, setReadyLanguage] = useState<SupportedLanguage | null>(() =>
    hasCatalog(language) ? language : null,
  );

  useEffect(() => {
    let active = true;
    if (hasCatalog(language)) {
      setReadyLanguage(language);
      return () => {
        active = false;
      };
    }
    void loadCatalog(language).then(() => {
      if (active) setReadyLanguage(language);
    });
    return () => {
      active = false;
    };
  }, [language]);

  useEffect(() => {
    if (readyLanguage === language) {
      void syncLanguageRuntime(language);
    }
  }, [language, readyLanguage]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      preference,
      setPreference: onPreferenceChange,
      t: (key, params) => translate(key, params, language),
    }),
    [language, onPreferenceChange, preference],
  );

  if (readyLanguage !== language) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useOptionalI18n(): I18nContextValue | null {
  return useContext(I18nContext);
}

export function useI18n(): I18nContextValue {
  const value = useOptionalI18n();
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
