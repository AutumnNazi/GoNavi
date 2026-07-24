import { t } from '../i18n';
import type { TabData } from '../types';

export const SQL_AUDIT_WORKBENCH_TAB_ID = 'sql-audit-center';

type BuildSqlAuditWorkbenchTabInput = {
  connectionId?: string;
  transactionId?: string;
  requestKey?: string;
};

export const buildSqlAuditWorkbenchTab = (
  input: BuildSqlAuditWorkbenchTabInput = {},
): TabData => ({
  id: SQL_AUDIT_WORKBENCH_TAB_ID,
  title: t('sql_audit.workbench.tab_title'),
  type: 'sql-audit',
  connectionId: String(input.connectionId || '').trim(),
  sqlAuditTransactionId: String(input.transactionId || '').trim() || undefined,
  sqlAuditRequestKey: input.requestKey || `sql-audit-${Date.now()}`,
});
