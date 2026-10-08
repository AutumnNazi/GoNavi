import { t } from '../i18n';
import type { TabData } from '../types';

export const SETTINGS_CENTER_WORKBENCH_TAB_ID = 'settings-center';

export const buildSettingsCenterWorkbenchTab = (): TabData => ({
  id: SETTINGS_CENTER_WORKBENCH_TAB_ID,
  title: t('app.settings.title'),
  type: 'settings-center',
  connectionId: '',
});

/**
 * 设置中心在工作台 tab 栏里固定排第一：新开、拖拽、会话恢复之后都把它放回首位。
 * 已经在首位或没打开时原样返回，调用方可以靠引用相等判断顺序没变。
 */
export const pinSettingsCenterTabFirst = <T extends Pick<TabData, 'id'>>(tabs: T[]): T[] => {
  const index = tabs.findIndex((tab) => tab.id === SETTINGS_CENTER_WORKBENCH_TAB_ID);
  if (index <= 0) return tabs;
  return [tabs[index], ...tabs.slice(0, index), ...tabs.slice(index + 1)];
};
