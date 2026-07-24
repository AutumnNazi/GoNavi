import type { SavedConnection, TabData } from '../../types';
import type { I18nParams } from '../../i18n';
import { resolveSqlDialect } from '../../utils/sqlDialect';
import { findSqlStatementRanges } from '../../utils/sqlStatementSelection';
import type { AIInspectionTranslator } from './aiInspectionI18n';
import { translateInspectionCopy } from './aiInspectionI18n';

type SqlRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
type SqlActivityKind = 'read' | 'write' | 'ddl' | 'transaction' | 'session' | 'routine' | 'other';

interface SqlSafetyCheckResult {
  allowed?: boolean;
  operationType?: string;
}

interface LocalizableText {
  key: string;
  fallback: string;
}

const SQL_PREVIEW_LIMIT = 12000;

const READ_TOKENS = new Set(['select', 'show', 'describe', 'desc', 'explain', 'with']);
const WRITE_TOKENS = new Set(['insert', 'update', 'delete', 'merge', 'replace', 'upsert']);
const DDL_TOKENS = new Set(['create', 'alter', 'drop', 'truncate', 'rename']);
const TRANSACTION_TOKENS = new Set(['begin', 'start', 'commit', 'rollback', 'savepoint', 'release']);
const SESSION_TOKENS = new Set(['set', 'use', 'reset']);
const ROUTINE_TOKENS = new Set(['call', 'exec', 'execute']);

const stripCommentsAndLiterals = (sql: string): string => {
  const text = String(sql || '');
  let result = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = index + 1 < text.length ? text[index + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        index += 1;
        inBlockComment = false;
      }
      result += ' ';
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === '-' && next === '-') {
      inLineComment = true;
      result += '  ';
      index += 1;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === '/' && next === '*') {
      inBlockComment = true;
      result += '  ';
      index += 1;
      continue;
    }
    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      result += ' ';
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      result += ' ';
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      result += ' ';
      continue;
    }
    result += (inSingle || inDouble || inBacktick) ? ' ' : ch;
  }

  return result;
};

const resolveFirstToken = (sql: string): string => {
  const stripped = stripCommentsAndLiterals(sql).trim();
  const match = stripped.match(/^[A-Za-z_][A-Za-z0-9_$#]*/);
  return match?.[0]?.toLowerCase() || '';
};

const classifySqlActivity = (token: string): SqlActivityKind => {
  if (READ_TOKENS.has(token)) return 'read';
  if (WRITE_TOKENS.has(token)) return 'write';
  if (DDL_TOKENS.has(token)) return 'ddl';
  if (TRANSACTION_TOKENS.has(token)) return 'transaction';
  if (SESSION_TOKENS.has(token)) return 'session';
  if (ROUTINE_TOKENS.has(token)) return 'routine';
  return 'other';
};

const escalateRisk = (current: SqlRiskLevel, next: SqlRiskLevel): SqlRiskLevel => {
  const order: SqlRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
};

const hasWhereClause = (statement: string): boolean =>
  /\bwhere\b/i.test(stripCommentsAndLiterals(statement));

const translateText = (
  translate: AIInspectionTranslator | undefined,
  { key, fallback }: LocalizableText,
  params?: I18nParams,
): string => translateInspectionCopy(translate, key, fallback, params);

const normalizeLimit = (limit: unknown): number => {
  const value = Math.floor(Number(limit) || SQL_PREVIEW_LIMIT);
  if (value < 200) return 200;
  if (value > 40000) return 40000;
  return value;
};

const buildStatementRisk = (statement: string, translate?: AIInspectionTranslator) => {
  const token = resolveFirstToken(statement);
  const activityKind = classifySqlActivity(token);
  const normalized = stripCommentsAndLiterals(statement);
  const warnings: string[] = [];
  let riskLevel: SqlRiskLevel = 'low';

  if (!token) {
    riskLevel = 'none';
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.unrecognized_operation',
      fallback: 'No valid SQL operation keyword was recognized.',
    }));
  }
  if (activityKind === 'write') {
    riskLevel = escalateRisk(riskLevel, 'high');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.data_change',
      fallback: 'This statement modifies data. Confirm the target database, conditions, and impact scope before execution.',
    }));
  }
  if (activityKind === 'ddl') {
    riskLevel = escalateRisk(riskLevel, 'high');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.ddl_change',
      fallback: 'This statement modifies database structures or objects. Back up first and confirm the rollback plan.',
    }));
  }
  if (activityKind === 'routine') {
    riskLevel = escalateRisk(riskLevel, 'medium');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.routine_side_effect',
      fallback: 'This statement calls a routine or procedure and may have implicit writes or side effects.',
    }));
  }
  if (/^\s*delete\b/i.test(normalized) && !hasWhereClause(statement)) {
    riskLevel = escalateRisk(riskLevel, 'critical');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.delete_missing_where',
      fallback: 'DELETE is missing a WHERE clause and may delete the entire table.',
    }));
  }
  if (/^\s*update\b/i.test(normalized) && !hasWhereClause(statement)) {
    riskLevel = escalateRisk(riskLevel, 'critical');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.update_missing_where',
      fallback: 'UPDATE is missing a WHERE clause and may update the entire table.',
    }));
  }
  if (/\btruncate\s+(?:table\s+)?[A-Za-z0-9_`"[\].]+/i.test(normalized)) {
    riskLevel = escalateRisk(riskLevel, 'critical');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.truncate',
      fallback: 'TRUNCATE quickly clears table data and usually cannot be rolled back row by row.',
    }));
  }
  if (/\bdrop\s+(database|schema|table|view|materialized\s+view)\b/i.test(normalized)) {
    riskLevel = escalateRisk(riskLevel, 'critical');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.drop_object',
      fallback: 'DROP deletes database objects. Confirm the object and backup before execution.',
    }));
  }
  if (/\bgrant\b|\brevoke\b/i.test(normalized)) {
    riskLevel = escalateRisk(riskLevel, 'high');
    warnings.push(translateText(translate, {
      key: 'ai_chat.inspection.sql_risk.warning.permission_change',
      fallback: 'GRANT / REVOKE changes permission boundaries. Confirm the grantee and scope.',
    }));
  }

  return {
    token,
    activityKind,
    riskLevel,
    warnings,
    preview: statement.trim().slice(0, 1000),
    charCount: statement.trim().length,
  };
};

const resolveActiveSqlSource = (params: {
  sql?: string;
  tabs?: TabData[];
  activeTabId?: string | null;
}) => {
  const explicitSql = String(params.sql || '').trim();
  if (explicitSql) {
    return {
      source: 'argument' as const,
      sql: explicitSql,
      activeTab: null as TabData | null,
    };
  }

  const activeTab = (params.tabs || []).find((tab) => tab.id === params.activeTabId) || null;
  const tabSql = activeTab?.type === 'query' ? String(activeTab.query || '').trim() : '';
  return {
    source: activeTab ? 'active_tab' as const : 'none' as const,
    sql: tabSql,
    activeTab,
  };
};

export const buildSqlRiskSnapshot = (params: {
  sql?: string;
  previewCharLimit?: unknown;
  tabs?: TabData[];
  activeTabId?: string | null;
  connections: SavedConnection[];
  safetyCheck?: SqlSafetyCheckResult;
  translate?: AIInspectionTranslator;
}) => {
  const { source, sql, activeTab } = resolveActiveSqlSource({
    sql: params.sql,
    tabs: params.tabs,
    activeTabId: params.activeTabId,
  });
  const previewLimit = normalizeLimit(params.previewCharLimit);
  const connection = activeTab
    ? params.connections.find((item) => item.id === activeTab.connectionId)
    : undefined;

  if (!sql) {
    return {
      hasSql: false,
      source,
      message: activeTab
        ? translateText(params.translate, {
            key: 'ai_chat.inspection.sql_risk.message.no_active_query_sql',
            fallback: 'The current active tab is not a SQL query tab, or the editor has no SQL content.',
          })
        : translateText(params.translate, {
            key: 'ai_chat.inspection.sql_risk.message.no_sql',
            fallback: 'No SQL was provided, and there is no readable active SQL query tab.',
          }),
      activeTab: activeTab ? {
        id: activeTab.id,
        title: activeTab.title,
        type: activeTab.type,
      } : null,
      safetyCheck: params.safetyCheck || null,
      riskLevel: 'none' as SqlRiskLevel,
      warnings: [],
      nextActions: [translateText(params.translate, {
        key: 'ai_chat.inspection.sql_risk.next_action.provide_sql',
        fallback: 'Pass the sql argument first, or switch to a query tab that contains a SQL draft.',
      })],
    };
  }

  const dbType = connection
    ? resolveSqlDialect(
        String(connection.config?.type || ''),
        String(connection.config?.driver || ''),
        { oceanBaseProtocol: connection.config?.oceanBaseProtocol },
      )
    : '';
  const statements = findSqlStatementRanges(sql, dbType).map((range) => range.text.trim()).filter(Boolean);
  const statementRisks = statements.map((statement) => buildStatementRisk(statement, params.translate));
  let riskLevel: SqlRiskLevel = statements.length > 0 ? 'low' : 'none';
  const warnings: string[] = [];

  if (statements.length > 1) {
    riskLevel = escalateRisk(riskLevel, 'medium');
    warnings.push(translateText(params.translate, {
      key: 'ai_chat.inspection.sql_risk.warning.multi_statement',
      fallback: '{{count}} SQL statements were detected. Confirm the impact scope of each statement before batch execution.',
    }, { count: statements.length }));
  }

  for (const statementRisk of statementRisks) {
    riskLevel = escalateRisk(riskLevel, statementRisk.riskLevel);
    for (const warning of statementRisk.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }

  if (params.safetyCheck?.allowed === false) {
    riskLevel = escalateRisk(riskLevel, 'high');
    const operationType = String(params.safetyCheck.operationType || '').trim();
    warnings.push(operationType
      ? translateText(params.translate, {
          key: 'ai_chat.inspection.sql_risk.warning.safety_blocked',
          fallback: 'The current AI safety policy does not allow {{operationType}} SQL.',
        }, { operationType })
      : translateText(params.translate, {
          key: 'ai_chat.inspection.sql_risk.warning.safety_blocked_unknown',
          fallback: 'The current AI safety policy does not allow this SQL operation type.',
        }));
  }

  const activityKinds = Array.from(new Set(statementRisks.map((item) => item.activityKind)));
  const requiresUserConfirmation = activityKinds.some((kind) => kind === 'write' || kind === 'ddl' || kind === 'routine')
    || riskLevel === 'critical';

  return {
    hasSql: true,
    source,
    sqlPreview: sql.slice(0, previewLimit),
    sqlCharCount: sql.length,
    sqlTruncated: sql.length > previewLimit,
    statementCount: statements.length,
    activityKinds,
    riskLevel,
    requiresUserConfirmation,
    safetyCheck: params.safetyCheck || null,
    activeTab: activeTab ? {
      id: activeTab.id,
      title: activeTab.title,
      type: activeTab.type,
      connectionId: activeTab.connectionId,
      connectionName: connection?.name || '',
      connectionType: connection?.config?.type || '',
      dbName: activeTab.dbName || '',
      filePath: activeTab.filePath || '',
      readOnly: activeTab.readOnly === true,
    } : null,
    statements: statementRisks,
    warnings,
    nextActions: warnings.length > 0
      ? [
          translateText(params.translate, {
            key: 'ai_chat.inspection.sql_risk.next_action.explain_and_confirm',
            fallback: 'Explain the risk points to the user first, then ask the user to confirm whether to continue.',
          }),
          translateText(params.translate, {
            key: 'ai_chat.inspection.sql_risk.next_action.confirm_write_scope',
            fallback: 'For write or DDL statements, confirm WHERE clauses, backups, target database, and impact scope first.',
          }),
        ]
      : [translateText(params.translate, {
          key: 'ai_chat.inspection.sql_risk.next_action.read_only_check_target',
          fallback: 'Read-only queries are lower risk, but still confirm the target connection and database name first.',
        })],
  };
};
