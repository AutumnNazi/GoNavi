import type { SavedConnection } from '../../types';
import { buildPaginatedSelectSQL, quoteQualifiedIdent } from '../../utils/sql';
import { normalizeTableNamesFromMetadataRows } from '../../utils/tableMetadataRows';

export const normalizeTableList = (rows: any[]): string[] =>
  normalizeTableNamesFromMetadataRows(rows);

export const normalizeColumns = (rows: any[]) =>
  rows.map((column) => {
    const keys = Object.keys(column);
    return {
      field: column.Field || column.field || column.COLUMN_NAME || column.column_name || column.Name || column.name || (keys.length > 0 ? column[keys[0]] : ''),
      type: column.Type || column.type || column.DATA_TYPE || column.data_type || (keys.length > 1 ? column[keys[1]] : ''),
      nullable: column.Null || column.null || column.IS_NULLABLE || column.is_nullable || column.Nullable || column.nullable || '',
      default: column.Default || column.default || column.COLUMN_DEFAULT || column.column_default || column.DefaultValue || '',
      comment: column.Comment || column.comment || column.COLUMN_COMMENT || column.column_comment || column.Description || '',
    };
  });

export const normalizeColumnsWithTable = (rows: any[]) =>
  rows.map((column) => {
    const keys = Object.keys(column);
    return {
      tableName: column.TableName || column.tableName || column.TABLE_NAME || column.table_name || (keys.length > 0 ? column[keys[0]] : ''),
      name: column.Name || column.name || column.COLUMN_NAME || column.column_name || (keys.length > 1 ? column[keys[1]] : ''),
      type: column.Type || column.type || column.DATA_TYPE || column.data_type || (keys.length > 2 ? column[keys[2]] : ''),
      comment: column.Comment || column.comment || column.COLUMN_COMMENT || column.column_comment || '',
    };
  });

export const normalizePreviewLimit = (input: unknown): number => {
  const value = Math.floor(Number(input) || 20);
  if (value < 1) return 1;
  if (value > 100) return 100;
  return value;
};

export const normalizeTableLimit = (input: unknown): number => {
  const value = Math.floor(Number(input) || 80);
  if (value < 1) return 1;
  if (value > 200) return 200;
  return value;
};

export const normalizePerTableColumnLimit = (input: unknown): number => {
  const value = Math.floor(Number(input) || 8);
  if (value < 1) return 1;
  if (value > 30) return 30;
  return value;
};

export const buildPreviewSQLForTable = (connection: SavedConnection, tableName: string, limit: number): string => {
  const dbType = String(connection.config?.type || '').trim();
  return buildPaginatedSelectSQL(
    dbType,
    `SELECT * FROM ${quoteQualifiedIdent(dbType, tableName)}`,
    '',
    limit,
    0,
  );
};
