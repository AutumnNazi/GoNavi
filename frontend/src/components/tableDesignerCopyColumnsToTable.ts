import { DBGetColumns, DBGetTables } from '../../wailsjs/go/app/App';
import type { RpcConnectionConfig } from '../utils/connectionRpcConfig';
import {
  getColumnDefinitionExtra,
  normalizeColumnDefinitions,
} from '../utils/columnDefinition';
import { splitQualifiedNameLast, stripIdentifierQuotes } from '../utils/qualifiedName';
import { normalizeTableNamesFromMetadataRows } from '../utils/tableMetadataRows';
import { qualifyTableDesignerCreateName } from './tableDesignerSchemaContext';
import {
  applyTableDesignerColumnPaste,
  clipboardColumnsHavePrimaryKey,
  stripPrimaryKeyFromClipboardColumns,
  type TableDesignerClipboardColumn,
} from './tableDesignerColumnClipboard';
import {
  buildAlterTablePreviewSql,
  type EditableColumnSnapshot,
  type SchemaSqlTranslator,
} from './tableDesignerSchemaSql';

export const isSameTableDesignerTable = (left: string, right: string, dbType = ''): boolean => {
  const normalize = (value: string) => {
    const raw = String(value || '').trim();
    const parsed = splitQualifiedNameLast(raw, dbType);
    return {
      full: stripIdentifierQuotes(raw, dbType).toLowerCase(),
      name: stripIdentifierQuotes(parsed.objectName || raw, dbType).toLowerCase(),
      qualified: Boolean(parsed.parentPath),
    };
  };
  const source = normalize(left);
  const target = normalize(right);
  if (!source.name || !target.name) return false;
  if (source.full === target.full) return true;
  if (!source.qualified || !target.qualified) return source.name === target.name;
  return false;
};

export const mapMetadataRowsToDesignerColumns = (data: unknown): EditableColumnSnapshot[] => (
  normalizeColumnDefinitions(data).map((column, index) => ({
    ...column,
    _key: `target-${index}-${column.name || 'col'}`,
    isAutoIncrement: getColumnDefinitionExtra(column).toLowerCase().includes('auto_increment'),
  }))
);

export const targetTableHasPrimaryKey = (
  columns: Array<Pick<EditableColumnSnapshot, 'key'>>,
): boolean => clipboardColumnsHavePrimaryKey(columns);

export const stripPrimaryKeyFromCopiedColumns = (
  columns: EditableColumnSnapshot[],
): EditableColumnSnapshot[] => stripPrimaryKeyFromClipboardColumns(columns);

const toClipboardColumn = (column: EditableColumnSnapshot): TableDesignerClipboardColumn => ({
  _key: column._key,
  name: column.name,
  type: column.type,
  nullable: column.nullable,
  key: String(column.key || ''),
  extra: String(column.extra || ''),
  comment: String(column.comment || ''),
  default: column.default ?? undefined,
  hasDefault: column.hasDefault,
  charset: column.charset,
  collation: column.collation,
  isAutoIncrement: column.isAutoIncrement,
});

const toColumnSnapshot = (
  column: TableDesignerClipboardColumn,
  index: number,
): EditableColumnSnapshot => ({
  _key: column._key || `copied-${index}-${column.name || 'col'}`,
  name: column.name,
  type: column.type,
  nullable: column.nullable,
  extra: column.extra,
  comment: column.comment,
  key: column.key,
  default: column.default,
  hasDefault: column.hasDefault,
  charset: column.charset,
  collation: column.collation,
  isAutoIncrement: column.isAutoIncrement,
});

export type CopyColumnsToExistingTablePlan = {
  sql: string;
  pastedColumns: EditableColumnSnapshot[];
  renamedCount: number;
  strippedPrimaryKey: boolean;
};

export const buildCopyColumnsToExistingTablePlan = (input: {
  dbType: string;
  tableName: string;
  targetColumns: EditableColumnSnapshot[];
  copiedColumns: TableDesignerClipboardColumn[];
  translate?: SchemaSqlTranslator;
}): CopyColumnsToExistingTablePlan => {
  const pasted = applyTableDesignerColumnPaste(
    input.copiedColumns,
    input.targetColumns.map(toClipboardColumn),
  );
  const pastedColumns = pasted.columns.map(toColumnSnapshot);
  return {
    sql: buildAlterTablePreviewSql({
      dbType: input.dbType,
      tableName: input.tableName,
      originalColumns: input.targetColumns,
      columns: [...input.targetColumns, ...pastedColumns],
      translate: input.translate,
    }),
    pastedColumns,
    renamedCount: pasted.renamedCount,
    strippedPrimaryKey: pasted.strippedPrimaryKey,
  };
};

const readQueryError = (result: { success?: boolean; message?: string }): string => (
  String(result.message || '').trim()
);

export const loadCopyTargetTableNames = async (input: {
  rpcConfig: RpcConnectionConfig;
  dbName: string;
  currentTableName: string;
  dbType: string;
  selectedSchema: string;
}): Promise<{ tables: string[]; error?: string }> => {
  const result = await DBGetTables(input.rpcConfig, input.dbName);
  if (!result.success) {
    return { tables: [], error: readQueryError(result) };
  }
  const tables = normalizeTableNamesFromMetadataRows(result.data)
    .map((name) => qualifyTableDesignerCreateName(name, input.selectedSchema, input.dbType))
    .filter((name) => !isSameTableDesignerTable(name, input.currentTableName, input.dbType));
  return { tables };
};

export const loadCopyTargetTableColumns = async (input: {
  rpcConfig: RpcConnectionConfig;
  dbName: string;
  tableName: string;
}): Promise<{ columns: EditableColumnSnapshot[]; error?: string }> => {
  const result = await DBGetColumns(input.rpcConfig, input.dbName, input.tableName);
  if (!result.success) {
    return { columns: [], error: readQueryError(result) };
  }
  return { columns: mapMetadataRowsToDesignerColumns(result.data) };
};
