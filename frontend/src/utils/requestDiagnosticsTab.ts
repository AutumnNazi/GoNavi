import { t } from '../i18n';
import type { TabData } from '../types';

export const REQUEST_DIAGNOSTICS_WORKBENCH_TAB_ID = 'request-diagnostics-center';

export const buildRequestDiagnosticsWorkbenchTab = (): TabData => ({
  id: REQUEST_DIAGNOSTICS_WORKBENCH_TAB_ID,
  title: t('app.tools.entry.request_diagnostics.title'),
  type: 'request-diagnostics',
  connectionId: '',
});
