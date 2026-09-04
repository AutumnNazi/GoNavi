import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLanguage, t } from '../i18n';
import {
  buildDriverManagerWorkbenchTab,
  DRIVER_MANAGER_WORKBENCH_TAB_ID,
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
});
