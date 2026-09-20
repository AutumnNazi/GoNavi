const escapeSqlLiteral = (value: string): string => String(value || '').replace(/'/g, "''");

const quoteOracleIdent = (value: string): string => `"${String(value || '').replace(/"/g, '""')}"`;

const IDENTIFIED_BY_CLAUSE = /\s+IDENTIFIED\s+BY\s+(?:VALUES\s+)?(?:'(?:''|[^'])*'|"(?:""|[^"])*"|\S+)/gi;
const CLOB_PREVIEW_PREFIX = /^\[CLOB preview:\s*\d+\/\d+\s*bytes\]\s*/i;

const unwrapSqlValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.replace(CLOB_PREVIEW_PREFIX, '').trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(unwrapSqlValue).filter(Boolean).join('');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.String === 'string') return unwrapSqlValue(record.String);
    if (typeof record.string === 'string') return unwrapSqlValue(record.string);
    if (typeof record.Value === 'string') return unwrapSqlValue(record.Value);
    if (typeof record.value === 'string') return unwrapSqlValue(record.value);
  }
  return '';
};

const readRowValue = (row: Record<string, unknown>, keys: readonly string[]): string => {
  const values = new Map(Object.entries(row || {}).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = values.get(key.toLowerCase());
    const normalized = unwrapSqlValue(value);
    if (normalized) return normalized;
  }
  return '';
};

export const buildOracleDatabaseLinkDefinitionQueries = (
  databaseLinkName: string,
  schemaName: string,
): string[] => {
  const linkName = String(databaseLinkName || '').trim();
  const owner = String(schemaName || '').trim();
  if (!linkName) return [];

  const safeLinkName = escapeSqlLiteral(linkName);
  const safeLinkNameUpper = escapeSqlLiteral(linkName.toUpperCase());
  const ownerPredicate = owner
    ? `OWNER = '${escapeSqlLiteral(owner).toUpperCase()}'`
    : 'OWNER = USER';
  const ddlOwnerArg = owner
    ? `'${escapeSqlLiteral(owner).toUpperCase()}'`
    : 'USER';
  const catalogColumns = 'OWNER AS schema_name, DB_LINK AS database_link_name, USERNAME AS username, HOST AS host, CREATED AS created';

  return [
    `SELECT ${catalogColumns} FROM ALL_DB_LINKS WHERE ${ownerPredicate} AND DB_LINK = '${safeLinkName}'`,
    `SELECT ${catalogColumns} FROM ALL_DB_LINKS WHERE ${ownerPredicate} AND UPPER(DB_LINK) = '${safeLinkNameUpper}'`,
    `SELECT USER AS schema_name, DB_LINK AS database_link_name, USERNAME AS username, HOST AS host, CREATED AS created FROM USER_DB_LINKS WHERE DB_LINK = '${safeLinkName}'`,
    `SELECT DBMS_METADATA.GET_DDL('DB_LINK', '${safeLinkNameUpper}', ${ddlOwnerArg}) AS ddl FROM DUAL`,
  ];
};

const sanitizeDatabaseLinkDdl = (ddl: string, passwordUnavailableComment: string): string => {
  const normalized = String(ddl || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  IDENTIFIED_BY_CLAUSE.lastIndex = 0;
  if (!IDENTIFIED_BY_CLAUSE.test(normalized)) {
    return normalized;
  }
  IDENTIFIED_BY_CLAUSE.lastIndex = 0;
  const sanitized = normalized.replace(IDENTIFIED_BY_CLAUSE, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!sanitized) return '';
  if (passwordUnavailableComment && !sanitized.includes(passwordUnavailableComment)) {
    return `-- ${passwordUnavailableComment}\n${sanitized}`;
  }
  return sanitized;
};

const formatCatalogDatabaseLinkDefinition = (
  row: Record<string, unknown>,
  fallbackLinkName: string,
  _fallbackSchemaName: string,
  passwordUnavailableComment: string,
): string => {
  const catalogLinkName = readRowValue(row, ['database_link_name', 'db_link']);
  const username = readRowValue(row, ['username', 'user']);
  const host = readRowValue(row, ['host']);
  const created = readRowValue(row, ['created']);
  const linkName = catalogLinkName || ((username || host || created) ? fallbackLinkName : '');
  if (!linkName) return '';

  const lines: string[] = [];
  if (created) {
    lines.push(`-- Created: ${created}`);
  }
  if (passwordUnavailableComment) {
    lines.push(`-- ${passwordUnavailableComment}`);
  }
  lines.push(`CREATE DATABASE LINK ${quoteOracleIdent(linkName)}`);
  if (username) {
    lines.push(`   CONNECT TO ${quoteOracleIdent(username)}`);
  }
  if (host) {
    lines.push(`   USING '${escapeSqlLiteral(host)}'`);
  }
  return `${lines.join('\n')};`;
};

export const extractOracleDatabaseLinkDefinition = (
  rows: unknown,
  fallbackLinkName: string,
  fallbackSchemaName: string,
  copy: {
    notFoundComment: string;
    passwordUnavailableComment: string;
  },
): string => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `-- ${copy.notFoundComment}`;
  }

  const row = rows[0];
  if (!row || typeof row !== 'object') {
    return `-- ${copy.notFoundComment}`;
  }

  const reconstructed = formatCatalogDatabaseLinkDefinition(
    row as Record<string, unknown>,
    fallbackLinkName,
    fallbackSchemaName,
    copy.passwordUnavailableComment,
  );
  if (reconstructed) {
    return reconstructed;
  }

  const ddl = sanitizeDatabaseLinkDdl(
    readRowValue(row as Record<string, unknown>, ['ddl', 'GET_DDL']),
    copy.passwordUnavailableComment,
  );
  return ddl || `-- ${copy.notFoundComment}`;
};
