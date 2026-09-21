import { DBQuery } from '../../../wailsjs/go/app/App';
import type { SavedConnection } from '../../types';
import { resolveSidebarMetadataDialect } from '../../utils/sidebarMetadata';
import { buildSidebarRuntimeConfig } from './sidebarMetadataLoaders';

export type OracleDatabaseLinkEntry = {
  schemaName: string;
  databaseLinkName: string;
};

export type OracleDatabaseLinksResult = {
  databaseLinks: OracleDatabaseLinkEntry[];
  supported: boolean;
  failureMessage?: string;
};

const DATABASE_LINK_QUERY_FAILED = 'database link metadata query failed';

const readRowValue = (row: Record<string, unknown>, keys: readonly string[]): string => {
  const values = new Map(Object.entries(row || {}).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = values.get(key.toLowerCase());
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
};

const escapeSqlLiteral = (value: string): string => value.replace(/'/g, "''");

/**
 * Only the link name and its owner are read. USERNAME / HOST and other
 * connection details stay in the catalog so the tree never exposes them.
 */
export const buildOracleDatabaseLinksSQL = (schemaName: string): string => {
  const requestedSchema = String(schemaName || '').trim();
  const ownerPredicate = requestedSchema
    ? `OWNER = '${escapeSqlLiteral(requestedSchema).toUpperCase()}'`
    : 'OWNER = USER';
  return `SELECT OWNER AS schema_name, DB_LINK AS database_link_name FROM ALL_DB_LINKS WHERE ${ownerPredicate} ORDER BY DB_LINK`;
};

export const normalizeOracleDatabaseLinks = (
  rows: unknown,
  requestedSchema: string,
): OracleDatabaseLinkEntry[] => {
  if (!Array.isArray(rows)) return [];
  const normalizedSchema = String(requestedSchema || '').trim();
  const seen = new Set<string>();
  const entries: OracleDatabaseLinkEntry[] = [];

  rows.forEach((rawRow) => {
    if (!rawRow || typeof rawRow !== 'object') return;
    const row = rawRow as Record<string, unknown>;
    const schemaName = readRowValue(row, ['schema_name', 'owner']) || normalizedSchema;
    // DB link names may legitimately contain dots (FCCS.WORLD); never split them.
    const databaseLinkName = readRowValue(row, ['database_link_name', 'db_link']);
    if (!databaseLinkName || (normalizedSchema && schemaName.toLocaleUpperCase() !== normalizedSchema.toLocaleUpperCase())) {
      return;
    }
    const identity = `${schemaName.toLocaleUpperCase()}\u0000${databaseLinkName.toLocaleUpperCase()}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    entries.push({ schemaName, databaseLinkName });
  });

  return entries.sort((left, right) => (
    left.databaseLinkName.toLocaleLowerCase().localeCompare(right.databaseLinkName.toLocaleLowerCase())
    || left.databaseLinkName.localeCompare(right.databaseLinkName)
  ));
};

export const loadOracleDatabaseLinks = async (
  conn: SavedConnection,
  dbName: string,
): Promise<OracleDatabaseLinksResult> => {
  const dialect = resolveSidebarMetadataDialect(
    conn?.config?.type || '',
    conn?.config?.driver || '',
    conn?.config?.oceanBaseProtocol,
  );
  if (dialect !== 'oracle') {
    return { databaseLinks: [], supported: false };
  }

  const requestedSchema = String(dbName || '').trim();
  try {
    const result = await DBQuery(
      buildSidebarRuntimeConfig(conn, dbName),
      dbName,
      buildOracleDatabaseLinksSQL(requestedSchema),
    );
    if (!result.success || !Array.isArray(result.data)) {
      return {
        databaseLinks: [],
        supported: false,
        failureMessage: String(result.message || DATABASE_LINK_QUERY_FAILED).trim(),
      };
    }
    return {
      databaseLinks: normalizeOracleDatabaseLinks(result.data, requestedSchema),
      supported: true,
    };
  } catch (error) {
    return {
      databaseLinks: [],
      supported: false,
      failureMessage: error instanceof Error ? error.message : String(error || DATABASE_LINK_QUERY_FAILED),
    };
  }
};
