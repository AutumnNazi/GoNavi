import { t } from '../i18n';
import type { TabData } from '../types';

export const DRIVER_MANAGER_WORKBENCH_TAB_ID = 'driver-manager';
export const OPEN_GLOBAL_PROXY_SETTINGS_EVENT = 'gonavi:open-global-proxy-settings';

export const buildDriverManagerWorkbenchTab = (): TabData => ({
  id: DRIVER_MANAGER_WORKBENCH_TAB_ID,
  title: t('app.tools.entry.drivers.title'),
  type: 'driver-manager',
  connectionId: '',
});

export const requestGlobalProxySettings = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_PROXY_SETTINGS_EVENT));
};
