import { message } from 'antd';
import { getDirtyWorkbenchTabCloseGuards } from './workbenchTabCloseProtection';

export const allowDataGridQueryChange = (
  tabId: string | undefined,
  translate: (key: string) => string,
): boolean => {
  if (!tabId || getDirtyWorkbenchTabCloseGuards([tabId]).length === 0) return true;
  void message.warning({
    content: translate('data_grid.message.query_change_with_pending_edits'),
    key: 'gonavi:data-grid-pending-query',
  });
  return false;
};
