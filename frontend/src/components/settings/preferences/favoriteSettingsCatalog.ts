import { QUICK_PREFERENCE_KEYS, type QuickPreference } from '../../../utils/favoriteSettings';
import { PREFERENCES_SEARCH_ENTRIES } from '../settingsSearchEntries/preferences';
import { SERVICES_SEARCH_ENTRIES } from '../settingsSearchEntries/services';
import { AI_SEARCH_ENTRIES } from '../settingsSearchEntries/ai';
import { TOOLS_SEARCH_ENTRIES } from '../settingsSearchEntries/tools';
import { SETTINGS_CENTER_MENU_CATALOG, findSettingsCenterNavigationTarget, type SettingsCenterNavigationTarget } from '../settingsCenterMenuCatalog';
import { routePreferenceSearchEntry } from './preferenceSearchRouting';

export type FavoriteSetting = { id: string; labelKey: string; descriptionKey?: string; categoryKey?: string; control?: QuickPreference; target?: SettingsCenterNavigationTarget };
const quickSettings: FavoriteSetting[] = Object.entries(QUICK_PREFERENCE_KEYS).map(([id, labelKey]) => ({ id, labelKey, control: id as QuickPreference }));
const quickLabels = new Set(quickSettings.map(setting => setting.labelKey));
const indexedSettings: FavoriteSetting[] = [...PREFERENCES_SEARCH_ENTRIES, ...SERVICES_SEARCH_ENTRIES, ...AI_SEARCH_ENTRIES, ...TOOLS_SEARCH_ENTRIES].flatMap(source => {
  const entry = routePreferenceSearchEntry(source);
  if (!('labelKey' in entry) || quickLabels.has(entry.labelKey)) return [];
  const target = findSettingsCenterNavigationTarget(entry.group, entry.item);
  return target ? [{ id: `entry:${entry.group}/${entry.item}/${entry.labelKey}`, labelKey: entry.labelKey, descriptionKey: entry.descriptionKey, categoryKey: SETTINGS_CENTER_MENU_CATALOG.find(page => page.group === entry.group && page.item === entry.item)?.titleKey, target }] : [];
});
export const FAVORITE_SETTINGS_CATALOG = [...quickSettings, ...indexedSettings];
export const findFavoriteSetting = (id: string) => FAVORITE_SETTINGS_CATALOG.find(setting => setting.id === id);
export const OPEN_FAVORITE_SETTING = 'gonavi:open-favorite-setting';
export function openFavoriteSetting(id: string) { window.dispatchEvent(new CustomEvent(OPEN_FAVORITE_SETTING, { detail: id })); }
