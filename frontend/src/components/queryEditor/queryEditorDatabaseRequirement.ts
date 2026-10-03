import {
  collectQueryEditorTableReferences,
  maskQueryEditorSqlLiteralsAndComments,
} from './QueryEditorHelpers';
import {
  isMysqlFamilyDialect,
  resolveSqlDialect,
} from '../../utils/sqlDialect';

// Statement kinds that never touch a default database. Anything not covered
// here (table DML, table DDL, unqualified SHOW variants, ...) keeps the
// previous behaviour of asking the user to pick a database first.
const SHOW_DATABASE_FREE_KINDS = new Set([
  'BINARY LOG STATUS',
  'BINARY LOGS',
  'BINLOG EVENTS',
  'CHARACTER SET',
  'CHARSET',
  'COLLATION',
  'DATABASES',
  'ENGINE',
  'ENGINES',
  'ERRORS',
  'FULL PROCESSLIST',
  'FUNCTION STATUS',
  'GLOBAL STATUS',
  'GLOBAL VARIABLES',
  'GRANTS',
  'MASTER LOGS',
  'MASTER STATUS',
  'PLUGINS',
  'PRIVILEGES',
  'PROCESSLIST',
  'PROCEDURE STATUS',
  'PROFILE',
  'PROFILES',
  'RELAYLOG EVENTS',
  'REPLICAS',
  'REPLICA STATUS',
  'REPLICATION STATUS',
  'SCHEMAS',
  'SESSION STATUS',
  'SESSION VARIABLES',
  'SLAVE HOSTS',
  'SLAVE STATUS',
  'STATUS',
  'VARIABLES',
  'WARNINGS',
]);

// Kinds whose trailing `FROM|IN <name>` clause names a database itself, so the
// statement stays database-free as soon as that qualifier is present.
const SHOW_DATABASE_SCOPED_KINDS = new Set([
  'EVENTS',
  'FULL TABLES',
  'OPEN TABLES',
  'TABLE STATUS',
  'TABLES',
  'TRIGGERS',
]);

// Kinds whose first `FROM` clause names a table; database-free only when a
// second `FROM|IN <db>` qualifier follows.
const SHOW_TABLE_KINDS_PATTERN = /^(?:FULL\s+)?(?:COLUMNS|FIELDS|INDEX|INDEXES|KEYS)\b/;

const SHOW_CREATE_OBJECT_PATTERN = /^CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE|VIEW|TRIGGER|EVENT|PROCEDURE|FUNCTION|SEQUENCE)\s+([\s\S]+)$/i;

const TRANSACTIONS_PATTERN = /^(?:BEGIN|START TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)\b/;
// Verbs whose grammar cannot reference an ordinary table.
const SERVER_VERBS_PATTERN = /^(?:CREATE|ALTER|DROP|RENAME)\s+(?:DATABASE|SCHEMA|USER)\b|^(?:KILL|PURGE|RESET|INSTALL|UNINSTALL|SHUTDOWN)\b|^(?:CHANGE\s+(?:MASTER|REPLICATION)|START\s+(?:SLAVE|REPLICA)|STOP\s+(?:SLAVE|REPLICA))\b/;
// SET/GRANT/REVOKE/FLUSH can carry table operands and get shape checks below.
const SET_PATTERN = /^SET\b/;
const GRANT_REVOKE_PATTERN = /^(?:GRANT|REVOKE)\b/;
const GRANT_ON_TARGET_PATTERN = /\bON\s+(\S+)/;
const FLUSH_TABLES_PATTERN = /^FLUSH\s+TABLES(?:\s+WITH\s+READ\s+LOCK)?\s*$/i;
const FROM_JOIN_KEYWORDS_PATTERN = /\b(?:FROM|JOIN)\b/;
const USE_PATTERN = /^USE\b/;
const SELECT_PATTERN = /^(?:SELECT|WITH)\b/;
const DESC_PATTERN = /^DESC(?:RIBE)?\s+([\s\S]+)$/i;
const EXPLAIN_PATTERN = /^EXPLAIN\b/i;

const stripIdentifierQuotes = (identifier: string): string => (
  identifier.replace(/[`"[\]]/g, '').trim()
);

const isQualifiedObjectName = (identifier: string): boolean => (
  stripIdentifierQuotes(identifier).includes('.')
);

const readShowKindTokens = (rest: string): { kind: string; remainder: string } => {
  const tokens = rest.trim().split(/\s+/);
  const kindTokens: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index].toUpperCase();
    if (['FROM', 'IN', 'WHERE', 'LIKE', 'FOR'].includes(token)) break;
    kindTokens.push(token);
    index += 1;
  }
  return { kind: kindTokens.join(' ').trim(), remainder: tokens.slice(index).join(' ') };
};

const isShowStatementDatabaseFree = (statement: string): boolean => {
  const rest = statement.replace(/^SHOW\s+/i, '').trim();
  if (!rest) return false;
  const { kind, remainder } = readShowKindTokens(rest);
  if (SHOW_DATABASE_FREE_KINDS.has(kind)) return true;
  // `SHOW CREATE DATABASE mydb` — the kind tokens carry the object name.
  if (/^CREATE\s+(?:DATABASE|SCHEMA|USER)\b/.test(kind)) return true;
  // `SHOW ENGINE innodb STATUS` — the kind tokens carry the engine name.
  if (/^ENGINE\b/.test(kind)) return true;
  if (SHOW_DATABASE_SCOPED_KINDS.has(kind)) return /\b(?:FROM|IN)\s+\S+/i.test(remainder);
  if (SHOW_TABLE_KINDS_PATTERN.test(kind)) {
    // `SHOW COLUMNS FROM tbl FROM db` — the first FROM is a table, only the
    // second one names a database. A qualified table (`db.tbl`) is free too.
    const fromMatch = remainder.match(/\bFROM\s+(\S+)/i);
    if (!fromMatch) return false;
    return isQualifiedObjectName(fromMatch[1])
      || /\bFROM\s+\S+\s+(?:FROM|IN)\s+\S+/i.test(remainder);
  }
  const createMatch = kind.match(SHOW_CREATE_OBJECT_PATTERN);
  if (createMatch) {
    const objectName = createMatch[1].trim().split(/\s+/)[0] || '';
    return isQualifiedObjectName(objectName);
  }
  return false;
};

const hasOnlyQualifiedTableReferences = (statement: string, dialect: string): boolean => {
  const references = collectQueryEditorTableReferences(statement, dialect);
  return references.every((reference) => (
    reference.parts.filter((part) => String(part || '').trim()).length >= 2
  ));
};

const isStatementDatabaseFree = (statement: string, dialect: string): boolean => {
  const text = statement.trim();
  if (!text) return true;
  const upper = text.toUpperCase();

  if (USE_PATTERN.test(upper) || TRANSACTIONS_PATTERN.test(upper) || SERVER_VERBS_PATTERN.test(upper)) {
    // 拆分语义依赖：跨 `;` 的 BEGIN...END 过程体会被拆成多段，尾段（END）不命中
    // 任何白名单而整批拒绝——保持保守，不要在这里放行多段过程体。
    return true;
  }
  if (SET_PATTERN.test(upper)) {
    // `SET @x = (SELECT * FROM t)` may hide an unqualified table reference.
    return !FROM_JOIN_KEYWORDS_PATTERN.test(upper)
      || hasOnlyQualifiedTableReferences(text, dialect);
  }
  if (GRANT_REVOKE_PATTERN.test(upper)) {
    // `GRANT ... ON tbl` with an unqualified target needs a default database;
    // `*.*` / `db.*` / `db.t` and role grants (no ON clause) do not.
    const onMatch = upper.match(GRANT_ON_TARGET_PATTERN);
    if (!onMatch) return true;
    const target = stripIdentifierQuotes(onMatch[1]);
    return target === '*' || target.endsWith('.*') || target.includes('.');
  }
  if (/^FLUSH\b/.test(upper)) {
    // Only the TABLES variant carries table operands: `FLUSH TABLES` /
    // `FLUSH TABLES WITH READ LOCK` are global, while a named table list
    // (`FLUSH TABLES t1, t2`) needs a default database.
    if (!/\bTABLES\b/.test(upper)) return true;
    return FLUSH_TABLES_PATTERN.test(text.trim());
  }

  const mysqlLikeShowDialect = isMysqlFamilyDialect(dialect)
    || ['clickhouse', 'tdengine'].includes(dialect);
  if (/^SHOW\b/.test(upper)) {
    // MySQL-family catalog SHOW kinds are classified individually; other
    // dialects stay conservative (a PG connection always carries a database,
    // so its gate is unaffected in practice).
    if (mysqlLikeShowDialect) return isShowStatementDatabaseFree(text);
    return false;
  }

  // EXPLAIN may stack modifiers before the inner statement (`EXPLAIN ANALYZE
  // SELECT ...`); a bare object name after the prefix acts like DESCRIBE.
  if (EXPLAIN_PATTERN.test(upper)) {
    let remainder = text.replace(EXPLAIN_PATTERN, '').trim();
    for (let i = 0; i < 4 && remainder; i += 1) {
      const stripped = remainder
        .replace(/^(?:ANALYZE|EXTENDED|PARTITIONS|VERBOSE|COSTS|SETTINGS|PLAN)\b\s*/i, '')
        .replace(/^FORMAT\s*=?\s*\S+\s*/i, '')
        .trim();
      if (stripped === remainder) break;
      remainder = stripped;
    }
    if (!remainder) return false;
    if (/^[^\s;]+$/.test(remainder)) return isQualifiedObjectName(remainder);
    return isStatementDatabaseFree(remainder, dialect);
  }
  const descMatch = text.match(DESC_PATTERN);
  if (descMatch) {
    return isQualifiedObjectName(descMatch[1].trim().split(/\s+/)[0] || '');
  }

  if (SELECT_PATTERN.test(upper)) {
    return hasOnlyQualifiedTableReferences(text, dialect);
  }
  return false;
};

/**
 * Decide whether the whole statement batch can run without a selected
 * database. Conservative by design: every statement must be database-free,
 * otherwise the caller keeps asking for a database selection.
 */
export const canExecuteQueryEditorSQLWithoutDatabase = (
  source: unknown,
  dialect: unknown,
): boolean => {
  const resolvedDialect = String(resolveSqlDialect(String(dialect || '')) || '');
  const masked = maskQueryEditorSqlLiteralsAndComments(String(source || ''), resolvedDialect);
  const statements = masked
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length === 0) return false;
  return statements.every((statement) => isStatementDatabaseFree(statement, resolvedDialect));
};
