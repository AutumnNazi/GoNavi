import { describe, expect, it } from 'vitest';

import { buildSqlRiskSnapshot } from './aiSqlRiskInsights';

const connections = [{
  id: 'conn-1',
  name: '主库',
  config: {
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
  },
}];

describe('aiSqlRiskInsights', () => {
  it('classifies multi-statement destructive SQL as critical', () => {
    const snapshot = buildSqlRiskSnapshot({
      sql: 'DELETE FROM accounts; SELECT * FROM accounts;',
      connections,
    });

    expect(snapshot.hasSql).toBe(true);
    expect(snapshot.source).toBe('argument');
    expect(snapshot.statementCount).toBe(2);
    expect(snapshot.riskLevel).toBe('critical');
    expect(snapshot.requiresUserConfirmation).toBe(true);
    expect(snapshot.activityKinds).toContain('write');
    expect(snapshot.activityKinds).toContain('read');
    expect(snapshot.warnings).toContain('DELETE is missing a WHERE clause and may delete the entire table.');
    expect(snapshot.warnings.join('\n')).toContain('Confirm the impact scope of each statement before batch execution');
  });

  it('uses the provided translator for SQL risk warnings and guidance', () => {
    const snapshot = buildSqlRiskSnapshot({
      sql: 'DELETE FROM accounts; SELECT * FROM accounts;',
      connections,
      safetyCheck: {
        allowed: false,
        operationType: 'DELETE',
      },
      translate: (key, params) => ({
        'ai_chat.inspection.sql_risk.warning.multi_statement': `translated multi statement ${params?.count}`,
        'ai_chat.inspection.sql_risk.warning.data_change': 'translated data change',
        'ai_chat.inspection.sql_risk.warning.delete_missing_where': 'translated delete missing where',
        'ai_chat.inspection.sql_risk.warning.safety_blocked': `translated safety blocked ${params?.operationType}`,
        'ai_chat.inspection.sql_risk.next_action.explain_and_confirm': 'translated explain and confirm',
        'ai_chat.inspection.sql_risk.next_action.confirm_write_scope': 'translated confirm write scope',
      })[key] || key,
    });

    expect(snapshot.warnings).toContain('translated multi statement 2');
    expect(snapshot.warnings).toContain('translated data change');
    expect(snapshot.warnings).toContain('translated delete missing where');
    expect(snapshot.warnings).toContain('translated safety blocked DELETE');
    expect(snapshot.nextActions).toEqual([
      'translated explain and confirm',
      'translated confirm write scope',
    ]);
    expect(snapshot.sqlPreview).toBe('DELETE FROM accounts; SELECT * FROM accounts;');
  });

  it('uses the provided translator for empty SQL state', () => {
    const snapshot = buildSqlRiskSnapshot({
      connections,
      translate: (key) => ({
        'ai_chat.inspection.sql_risk.message.no_sql': 'translated no SQL message',
        'ai_chat.inspection.sql_risk.next_action.provide_sql': 'translated provide SQL',
      })[key] || key,
    });

    expect(snapshot.hasSql).toBe(false);
    expect(snapshot.message).toBe('translated no SQL message');
    expect(snapshot.nextActions).toEqual(['translated provide SQL']);
  });

  it('reads SQL from the active query tab and includes safety check result', () => {
    const snapshot = buildSqlRiskSnapshot({
      tabs: [{
        id: 'tab-1',
        title: '用户更新',
        type: 'query',
        connectionId: 'conn-1',
        dbName: 'crm',
        query: 'UPDATE users SET status = 0',
      }],
      activeTabId: 'tab-1',
      connections,
      safetyCheck: {
        allowed: false,
        operationType: 'UPDATE',
      },
    });

    expect(snapshot.hasSql).toBe(true);
    expect(snapshot.source).toBe('active_tab');
    expect(snapshot.activeTab).toMatchObject({
      id: 'tab-1',
      title: '用户更新',
      connectionName: '主库',
      connectionType: 'mysql',
      dbName: 'crm',
    });
    expect(snapshot.riskLevel).toBe('critical');
    expect(snapshot.safetyCheck).toMatchObject({ allowed: false, operationType: 'UPDATE' });
    expect(snapshot.warnings).toContain('UPDATE is missing a WHERE clause and may update the entire table.');
    expect(snapshot.warnings).toContain('The current AI safety policy does not allow UPDATE SQL.');
  });

  it('uses the active connection dialect when splitting SQL comments', () => {
    const snapshot = buildSqlRiskSnapshot({
      tabs: [{
        id: 'tab-1',
        title: '用户删除',
        type: 'query',
        connectionId: 'conn-1',
        dbName: 'crm',
        query: 'DELETE FROM users WHERE id = 1;--compact',
      }],
      activeTabId: 'tab-1',
      connections,
    });

    expect(snapshot.statementCount).toBe(2);
    expect(snapshot.warnings.join('\n')).toContain('Confirm the impact scope of each statement');
  });
});
