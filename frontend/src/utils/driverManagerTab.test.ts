import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentLanguage, t } from '../i18n';
import {
  buildDriverManagerWorkbenchTab,
  DOWNLOAD_SOURCE_CHANGED_EVENT,
  DRIVER_MANAGER_WORKBENCH_TAB_ID,
  notifyDownloadSourceChanged,
  OPEN_DOWNLOAD_SOURCE_SETTINGS_EVENT,
  requestDownloadSourceSettings,
} from './driverManagerTab';

describe('driverManagerTab', () => {
  afterEach(() => setCurrentLanguage('zh-CN'));

  it('builds one global driver manager workbench tab', () => {
    expect(buildDriverManagerWorkbenchTab()).toEqual({
      id: DRIVER_MANAGER_WORKBENCH_TAB_ID,
      title: t('app.tools.entry.drivers.title'),
      type: 'driver-manager',
      connectionId: '',
    });
  });

  it('localizes the workbench tab title', () => {
    setCurrentLanguage('en-US');
    expect(buildDriverManagerWorkbenchTab().title).toBe(t('app.tools.entry.drivers.title'));
  });

  it('requests download source settings from the workbench host', () => {
    const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const eventTarget = new EventTarget();
    const listener = vi.fn();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: eventTarget });
    try {
      window.addEventListener(OPEN_DOWNLOAD_SOURCE_SETTINGS_EVENT, listener);
      requestDownloadSourceSettings();
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
    }
  });

  it('notifies the workbench when the download source changes', () => {
    const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const eventTarget = new EventTarget();
    const listener = vi.fn();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: eventTarget });
    try {
      window.addEventListener(DOWNLOAD_SOURCE_CHANGED_EVENT, listener);
      notifyDownloadSourceChanged('github');
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { source: 'github' } }));
    } finally {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'window');
      }
    }
  });
});
