import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLanguage, t } from '../i18n';
import {
  buildSettingsCenterWorkbenchTab,
  pinSettingsCenterTabFirst,
  SETTINGS_CENTER_WORKBENCH_TAB_ID,
} from './settingsCenterTab';

describe('settingsCenterTab', () => {
  afterEach(() => setCurrentLanguage('zh-CN'));

  it('builds one global settings-center workbench tab with a stable id/type', () => {
    expect(buildSettingsCenterWorkbenchTab()).toEqual({
      id: SETTINGS_CENTER_WORKBENCH_TAB_ID,
      title: t('app.settings.title'),
      type: 'settings-center',
      connectionId: '',
    });
  });

  it('localizes the workbench tab title', () => {
    setCurrentLanguage('en-US');
    expect(buildSettingsCenterWorkbenchTab().title).toBe(t('app.settings.title'));
  });

  it('moves the settings-center tab to the front and keeps the others in order', () => {
    const tabs = [{ id: 'a' }, { id: 'b' }, { id: SETTINGS_CENTER_WORKBENCH_TAB_ID }, { id: 'c' }];
    expect(pinSettingsCenterTabFirst(tabs).map((tab) => tab.id)).toEqual([SETTINGS_CENTER_WORKBENCH_TAB_ID, 'a', 'b', 'c']);
  });

  it('returns the same array when the settings center is already first or not open', () => {
    const pinned = [{ id: SETTINGS_CENTER_WORKBENCH_TAB_ID }, { id: 'a' }];
    const without = [{ id: 'a' }, { id: 'b' }];
    expect(pinSettingsCenterTabFirst(pinned)).toBe(pinned);
    expect(pinSettingsCenterTabFirst(without)).toBe(without);
  });
});
