import { t } from '../i18n';
import type { TabData } from '../types';

export const DRIVER_MANAGER_WORKBENCH_TAB_ID = 'driver-manager';
export const DOWNLOAD_SOURCE_CHANGED_EVENT = 'gonavi:download-source-changed';
export const OPEN_GLOBAL_PROXY_SETTINGS_EVENT = 'gonavi:open-global-proxy-settings';
export const OPEN_DOWNLOAD_SOURCE_SETTINGS_EVENT = 'gonavi:open-download-source-settings';

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

export const requestDownloadSourceSettings = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_DOWNLOAD_SOURCE_SETTINGS_EVENT));
};

export const notifyDownloadSourceChanged = (source: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOWNLOAD_SOURCE_CHANGED_EVENT, { detail: { source } }));
};
