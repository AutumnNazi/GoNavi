import type { ConnectionConfig } from '../../types';

// DuckDB 保存连接附加语句构造（issue #1270）。
// 语句最终由后端拦截执行（见 internal/app/duckdb_saved_attach.go），
// 这里只负责生成用户可读的语句文本；与后端类型映射保持一致。

/** 后端当前支持附加到 DuckDB 的连接类型（与 buildDuckDBAttachSpec 保持同步）。 */
export const DUCKDB_ATTACHABLE_CONNECTION_TYPES: ReadonlySet<string> = new Set([
  'mysql',
  'mariadb',
  'oceanbase',
  'postgres',
  'kingbase',
  'opengauss',
  'gaussdb',
  'vastbase',
  'highgo',
  'sqlite',
  'duckdb',
]);

export const isDuckDBAttachableConnectionType = (type: string): boolean =>
  DUCKDB_ATTACHABLE_CONNECTION_TYPES.has(String(type || '').trim().toLowerCase());

/** OceanBase 的 oracle 兼容协议后端会拒绝附加，选择器需同步禁用（与 buildDuckDBAttachSpec 对齐）。 */
export const isDuckDBAttachableConnection = (
  config: Pick<ConnectionConfig, 'type' | 'oceanBaseProtocol'> | null | undefined,
): boolean => {
  if (!config) {
    return false;
  }
  if (String(config.type || '').trim().toLowerCase() === 'oceanbase'
    && String(config.oceanBaseProtocol || '').trim().toLowerCase() === 'oracle') {
    return false;
  }
  return isDuckDBAttachableConnectionType(config.type);
};

const DUCKDB_ATTACH_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 从连接名称派生默认别名：非法字符折叠为下划线，全部非法时回退 saved_db_<ID片段>。 */
export const slugifyDuckDBAttachAlias = (name: string, connectionId: string): string => {
  const builder: string[] = [];
  let lastUnderscore = false;
  for (const char of String(name || '').trim()) {
    if (/[A-Za-z0-9]/.test(char)) {
      builder.push(char);
      lastUnderscore = false;
      continue;
    }
    if (char === '_') {
      builder.push('_');
      lastUnderscore = true;
      continue;
    }
    if (!lastUnderscore && builder.length > 0) {
      builder.push('_');
      lastUnderscore = true;
    }
  }
  const slug = builder.join('').replace(/^_+|_+$/g, '');
  if (DUCKDB_ATTACH_IDENTIFIER_PATTERN.test(slug)) {
    return slug;
  }
  const sanitizedID = String(connectionId || '')
    .split('')
    .map((char) => (/[A-Za-z0-9]/.test(char) ? char : '_'))
    .join('')
    .replace(/_+$/, '')
    .slice(0, 8);
  return sanitizedID ? `saved_db_${sanitizedID}` : 'saved_db';
};

/** 单引号字面量：成对单引号转义。 */
export const escapeDuckDBAttachStringLiteral = (value: string): string =>
  String(value || '').replace(/'/g, "''");

export interface BuildDuckDBAttachStatementInput {
  connectionId: string;
  alias?: string;
  readOnly: boolean;
}

/** 生成 ATTACH SAVED CONNECTION 语句文本；不含结尾分号，由用户语句上下文决定。 */
export const buildDuckDBAttachStatementText = (input: BuildDuckDBAttachStatementInput): string => {
  const connectionId = escapeDuckDBAttachStringLiteral(String(input.connectionId || '').trim());
  if (!connectionId) {
    return '';
  }
  const parts = [`ATTACH SAVED CONNECTION '${connectionId}'`];
  const alias = String(input.alias || '').trim();
  if (alias) {
    if (!DUCKDB_ATTACH_IDENTIFIER_PATTERN.test(alias)) {
      return '';
    }
    parts.push(`AS ${alias}`);
  }
  parts.push(input.readOnly ? 'READ ONLY' : 'READ WRITE');
  return parts.join(' ');
};

/** 生成 DETACH SAVED CONNECTION 语句文本。 */
export const buildDuckDBDetachStatementText = (alias: string): string => {
  const trimmed = String(alias || '').trim();
  if (!DUCKDB_ATTACH_IDENTIFIER_PATTERN.test(trimmed)) {
    return '';
  }
  return `DETACH SAVED CONNECTION ${trimmed}`;
};
