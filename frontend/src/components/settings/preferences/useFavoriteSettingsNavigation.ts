import { useEffect } from 'react';
import { t } from '../../../i18n';
import type { SettingsCenterNavigationTarget } from '../settingsCenterMenuCatalog';
import { requestSettingsCenterEntryFocus } from '../settingsCenterEntryFocus';
import { OPEN_FAVORITE_SETTING, findFavoriteSetting } from './favoriteSettingsCatalog';

export function useFavoriteSettingsNavigation(open: (target: SettingsCenterNavigationTarget) => unknown) {
  useEffect(() => {
    const handleOpen = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id !== 'string') return;
      const setting = findFavoriteSetting(id);
      if (!setting?.target) return;
      void Promise.resolve(open(setting.target)).then(() => requestSettingsCenterEntryFocus({ text: t(setting.labelKey) }));
    };
    window.addEventListener(OPEN_FAVORITE_SETTING, handleOpen);
    return () => window.removeEventListener(OPEN_FAVORITE_SETTING, handleOpen);
  }, [open]);
}
