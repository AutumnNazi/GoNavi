import { splitQualifiedNameLast } from '../utils/qualifiedName';
import {
  isMysqlFamilyDialect,
  isOracleLikeDialect,
  isPgLikeDialect,
  isSqlServerDialect,
  quoteSqlIdentifierPath,
  resolveSqlDialect,
} from '../utils/sqlDialect';
import { splitSchemaExecutionStatements } from './tableDesignerExecutionSql';

export interface AlterTableCommentTarget {
  dbType: string;
  tableRef: string;
  schema?: string;
  table?: string;
}

const escapeSqlString = (value: string) => String(value || '').replace(/'/g, "''");

const isNonRelationalDialect = (dbType: string): boolean => {
  const dialect = resolveSqlDialect(dbType);
  return dialect === 'redis' || dialect === 'mongodb' || dialect === 'elasticsearch';
};

export const supportsTableDesignerTableComment = (dbType: string): boolean => {
  const dialect = resolveSqlDialect(dbType);
  if (!dialect || dialect === 'unknown') return false;
  if (isNonRelationalDialect(dialect)) return false;
  return dialect !== 'sqlite';
};

const stripTrailingTerminators = (statement: string): string => String(statement || '').replace(/;+\s*$/, '');

const replaceFirstStatement = (sql: string, dbType: string, nextFirst: string): string => {
  const statements = splitSchemaExecutionStatements(sql, dbType);
  if (statements.length === 0) {
    return nextFirst;
  }
  return [nextFirst, ...statements.slice(1)].filter(Boolean).join('\n');
};

const injectBeforeFirstTerminator = (sql: string, dbType: string, clause: string): string => {
  const statements = splitSchemaExecutionStatements(sql, dbType);
  const first = stripTrailingTerminators(statements[0] || sql);
  return replaceFirstStatement(sql, dbType, `${first}${clause};`);
};

const injectAfterFirstMatch = (statement: string, pattern: RegExp, clause: string): string | null => {
  const match = String(statement || '').match(pattern);
  if (!match || match.index == null) return null;
  const at = match.index + match[0].length;
  return `${statement.slice(0, at)}${clause}${statement.slice(at)}`;
};

const injectStarRocksTableComment = (sql: string, dbType: string, comment: string): string => {
  const clause = `\nCOMMENT '${escapeSqlString(comment)}'`;
  const statements = splitSchemaExecutionStatements(sql, dbType);
  const first = statements[0] || sql;
  const injected = injectAfterFirstMatch(first, /\n(?:DUPLICATE|PRIMARY|UNIQUE|AGGREGATE) KEY \([^)]*\)/i, clause)
    || injectAfterFirstMatch(first, /\nENGINE=[^\n;]+/i, clause)
    || `${stripTrailingTerminators(first)}${clause};`;
  return replaceFirstStatement(sql, dbType, injected.endsWith(';') ? injected : `${stripTrailingTerminators(injected)};`);
};

const buildFollowTableCommentSql = (dbType: string, tableName: string, comment: string): string => {
  const dialect = resolveSqlDialect(dbType);
  const escaped = escapeSqlString(comment);
  if (isSqlServerDialect(dialect)) {
    const parsed = splitQualifiedNameLast(tableName, dialect);
    const schema = escapeSqlString(parsed.parentPath || 'dbo');
    const table = escapeSqlString(parsed.objectName || tableName);
    return `EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'${escaped}',
    @level0type = N'SCHEMA', @level0name = N'${schema}',
    @level1type = N'TABLE', @level1name = N'${table}';`;
  }
  const tableRef = quoteSqlIdentifierPath(dialect, tableName);
  return `COMMENT ON TABLE ${tableRef} IS '${escaped}';`;
};

export const buildAlterTableCommentSql = (
  target: AlterTableCommentTarget,
  comment: string,
): string | null => {
  const dbType = resolveSqlDialect(target.dbType);
  const escapedComment = escapeSqlString(comment);
  if (isNonRelationalDialect(dbType)) return null;
  if (isMysqlFamilyDialect(dbType)) {
    return `ALTER TABLE ${target.tableRef} COMMENT = '${escapedComment}';`;
  }
  if (isPgLikeDialect(dbType) || isOracleLikeDialect(dbType) || dbType === 'duckdb') {
    return `COMMENT ON TABLE ${target.tableRef} IS '${escapedComment}';`;
  }
  if (isSqlServerDialect(dbType)) {
    const schemaName = escapeSqlString(target.schema || 'dbo');
    const tableName = escapeSqlString(target.table || '');
    return `IF EXISTS (
    SELECT 1
    FROM sys.extended_properties ep
    JOIN sys.tables t ON ep.major_id = t.object_id AND ep.minor_id = 0
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE ep.name = N'MS_Description'
      AND s.name = N'${schemaName}'
      AND t.name = N'${tableName}'
)
BEGIN
    EXEC sp_updateextendedproperty
        @name = N'MS_Description',
        @value = N'${escapedComment}',
        @level0type = N'SCHEMA', @level0name = N'${schemaName}',
        @level1type = N'TABLE', @level1name = N'${tableName}';
END
ELSE
BEGIN
    EXEC sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'${escapedComment}',
        @level0type = N'SCHEMA', @level0name = N'${schemaName}',
        @level1type = N'TABLE', @level1name = N'${tableName}';
END;`;
  }
  if (dbType === 'sqlite') return null;
  return `COMMENT ON TABLE ${target.tableRef} IS '${escapedComment}';`;
};

export const applyCreateTableCommentSql = (
  sql: string,
  dbType: string,
  tableName: string,
  comment: string,
): string => {
  const trimmedComment = String(comment || '').trim();
  if (!trimmedComment || !String(sql || '').trim()) return sql;
  if (!supportsTableDesignerTableComment(dbType)) return sql;

  const dialect = resolveSqlDialect(dbType);
  if (dialect === 'starrocks') {
    return injectStarRocksTableComment(sql, dbType, trimmedComment);
  }
  if (isMysqlFamilyDialect(dialect)) {
    return injectBeforeFirstTerminator(sql, dbType, ` COMMENT='${escapeSqlString(trimmedComment)}'`);
  }
  if (dialect === 'clickhouse' || dialect === 'tdengine') {
    return injectBeforeFirstTerminator(sql, dbType, `\nCOMMENT '${escapeSqlString(trimmedComment)}'`);
  }

  const followSql = buildFollowTableCommentSql(dialect, tableName, trimmedComment);
  const statements = splitSchemaExecutionStatements(sql, dbType);
  if (statements.length === 0) {
    return `${sql}\n${followSql}`;
  }
  return [statements[0], followSql, ...statements.slice(1)].join('\n');
};
