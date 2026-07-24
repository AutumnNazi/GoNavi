import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLanguage, t } from '../i18n';
import { buildSqlAuditWorkbenchTab, SQL_AUDIT_WORKBENCH_TAB_ID } from './sqlAuditTab';

describe('sqlAuditTab', () => {
  afterEach(() => setCurrentLanguage('zh-CN'));

  it('uses one stable global workbench tab for every entry point', () => {
    const first = buildSqlAuditWorkbenchTab();
    const scoped = buildSqlAuditWorkbenchTab({ connectionId: 'conn-1', transactionId: 'tx-1' });

    expect(first.id).toBe(SQL_AUDIT_WORKBENCH_TAB_ID);
    expect(scoped.id).toBe(SQL_AUDIT_WORKBENCH_TAB_ID);
    expect(scoped).toMatchObject({
      type: 'sql-audit',
      connectionId: 'conn-1',
      sqlAuditTransactionId: 'tx-1',
    });
  });

  it('localizes the workbench tab title', () => {
    setCurrentLanguage('en-US');
    expect(buildSqlAuditWorkbenchTab().title).toBe(t('sql_audit.workbench.tab_title'));
  });
});
