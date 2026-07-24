import type { I18nParams, SupportedLanguage } from "./types";

export type I18nKey = keyof typeof import("../../../shared/i18n/en-US.json");
export type Catalog = Record<I18nKey, string>;

type CatalogRegistry = Partial<Record<SupportedLanguage, Catalog>>;

const TEST_CATALOG_CACHE_KEY = "__GONAVI_TEST_I18N_CATALOGS__";
const testGlobal = globalThis as typeof globalThis & {
  [TEST_CATALOG_CACHE_KEY]?: CatalogRegistry;
};
const registry: CatalogRegistry = import.meta.env.MODE === "test"
  ? (testGlobal[TEST_CATALOG_CACHE_KEY] ??= {})
  : {};

export const catalogs = registry as Record<SupportedLanguage, Catalog>;

const catalogLoaders: Record<SupportedLanguage, () => Promise<Catalog>> = {
  "zh-CN": () => import("../../../shared/i18n/zh-CN.json").then((module) => module.default as Catalog),
  "zh-TW": () => import("../../../shared/i18n/zh-TW.json").then((module) => module.default as Catalog),
  "en-US": () => import("../../../shared/i18n/en-US.json").then((module) => module.default as Catalog),
  "ja-JP": () => import("../../../shared/i18n/ja-JP.json").then((module) => module.default as Catalog),
  "de-DE": () => import("../../../shared/i18n/de-DE.json").then((module) => module.default as Catalog),
  "ru-RU": () => import("../../../shared/i18n/ru-RU.json").then((module) => module.default as Catalog),
};

const catalogLoads: Partial<Record<SupportedLanguage, Promise<Catalog>>> = {};

export const hasCatalog = (language: SupportedLanguage): boolean => Boolean(registry[language]);

export const loadCatalog = async (language: SupportedLanguage): Promise<Catalog> => {
  const loaded = registry[language];
  if (loaded) return loaded;
  const pending = catalogLoads[language] ?? catalogLoaders[language]();
  catalogLoads[language] = pending;
  try {
    const catalog = await pending;
    registry[language] = catalog;
    return catalog;
  } finally {
    delete catalogLoads[language];
  }
};

export const loadAllCatalogs = async (): Promise<void> => {
  await Promise.all((Object.keys(catalogLoaders) as SupportedLanguage[]).map(loadCatalog));
};

export function getCatalogKeys(language: SupportedLanguage): string[] {
  return Object.keys(registry[language] ?? {}).sort();
}

export function t(
  language: SupportedLanguage,
  key: I18nKey | string,
  params: I18nParams = {},
): string {
  const catalog = registry[language] as Record<string, string> | undefined;
  const fallbackCatalog = registry["en-US"] as Record<string, string> | undefined;
  let template = catalog?.[key] || fallbackCatalog?.[key] || key;
  Object.entries(params).forEach(([name, value]) => {
    template = template.split(`{{${name}}}`).join(value == null ? "" : String(value));
  });
  return template;
}
