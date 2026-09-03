import { parseCLIModelCatalog, type CLIModelCatalog } from '../../utils/aiProviderManagement';

// CLI model enumeration shells out to the local tool, so the settings page does
// not repeat it on every visit. The last usable catalog per API format is kept
// here and reused until the user asks for a refresh from the enabled-count button.
// Stale, empty or failed results are never cached, so those retry on their own.
export const CLI_MODEL_CATALOG_CACHE_KEY = 'gonavi.ai.providers.modelCatalog.v1';

interface CachedCatalogEntry { catalog: CLIModelCatalog; fetchedAt: number }

const readStore = (): Record<string, CachedCatalogEntry> => {
  try {
    const raw = window.localStorage.getItem(CLI_MODEL_CATALOG_CACHE_KEY);
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};

export const readCachedCLIModelCatalog = (apiFormat: string): CLIModelCatalog | null => {
  const entry = readStore()[apiFormat];
  const catalog = entry ? parseCLIModelCatalog(entry.catalog) : null;
  return catalog && !catalog.stale && catalog.models.length ? catalog : null;
};

export const writeCachedCLIModelCatalog = (apiFormat: string, catalog: CLIModelCatalog, now = Date.now()): void => {
  if (!apiFormat || catalog.stale || !catalog.models.length) return;
  try {
    const store = readStore();
    store[apiFormat] = { catalog, fetchedAt: now };
    window.localStorage.setItem(CLI_MODEL_CATALOG_CACHE_KEY, JSON.stringify(store));
  } catch { /* Private storage may be unavailable. */ }
};
