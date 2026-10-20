import { describe, expect, it } from 'vitest';

import { t } from '../../i18n';
import { SETTINGS_CENTER_MENU_CATALOG } from './settingsCenterMenuCatalog';

describe('settings center and native menu labels', () => {
  it.each([
    { language: 'zh-CN', settingsGroup: '更多偏好', nativeMenu: '偏好设置' },
    { language: 'en-US', settingsGroup: 'Other preferences', nativeMenu: 'Preferences' },
  ])('keeps native Preferences separate from the $language settings group', ({ language, settingsGroup, nativeMenu }) => {
    const preferences = SETTINGS_CENTER_MENU_CATALOG.find(
      (node) => node.group === 'preferences' && !node.item,
    );

    expect(preferences).toBeDefined();
    expect(t(preferences!.titleKey, undefined, language)).toBe(settingsGroup);
    expect(t('app.settings.group.preferences.title', undefined, language)).toBe(nativeMenu);
    expect(preferences!.titleKey).not.toBe('app.settings.group.preferences.title');
  });
});
