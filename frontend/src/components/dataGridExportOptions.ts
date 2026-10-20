import {
  type DataExportFileOptions,
  resolveDataExportColumns,
  resolveDataExportFileOptions,
} from './dataExportOptions';

type ColumnCommentMetadata = { comment?: string };

type DataGridExportMetadata = {
  columnMetaMap: Record<string, ColumnCommentMetadata>;
  columnMetaMapByLowerName: Record<string, ColumnCommentMetadata>;
  displayOutputColumnNames: string[];
  dbType: string;
  hasResolvedInsertSQLTarget: boolean;
  tableName?: string;
  insertSQLColumnTypes: Record<string, string>;
  insertSQLTargetColumns: Record<string, string>;
};

export function buildDataGridBackendExportOptions(
  input: DataExportFileOptions,
  metadata: DataGridExportMetadata,
): DataExportFileOptions {
  const options = resolveDataExportFileOptions(input);
  if (options.format === 'sql') {
    return {
      ...options,
      insertSQLDialect: metadata.dbType,
      insertSQLTargetTable: metadata.hasResolvedInsertSQLTarget ? String(metadata.tableName || '').trim() : '',
      insertSQLColumnTypes: metadata.insertSQLColumnTypes,
      insertSQLTargetColumns: metadata.hasResolvedInsertSQLTarget ? metadata.insertSQLTargetColumns : {},
      insertSQLAllowEmptyTargetTable: !metadata.hasResolvedInsertSQLTarget,
    };
  }
  if (!options.useColumnComments || !['xlsx', 'csv', 'md', 'html'].includes(options.format)) return options;
  const columnComments: Record<string, string> = {};
  for (const column of resolveDataExportColumns(options.columns, metadata.displayOutputColumnNames) || []) {
    const meta = metadata.columnMetaMap[column] || metadata.columnMetaMapByLowerName[column.toLowerCase()];
    const comment = String(meta?.comment || '').trim();
    if (comment) columnComments[column] = comment;
  }
  return { ...options, columnComments };
}
