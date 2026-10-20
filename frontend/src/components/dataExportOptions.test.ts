import { describe, expect, it } from 'vitest';
import {
  DATA_EXPORT_CSV_ENCODINGS,
  DATA_EXPORT_FORMAT_OPTIONS,
  normalizeDataExportDialogValues,
  resolveDataExportFileOptions,
  validateDataExportDialogValues,
  type DataExportCSVEncoding,
} from './dataExportOptions';
import { buildDataGridBackendExportOptions } from './dataGridExportOptions';
import { createTableExportFormatOptions } from './tableExport/tableExportWorkbenchOptions';

const scopes = [
  { value: 'selected', label: 'Selected', disabled: true },
  { value: 'page', label: 'Page' },
  { value: 'all', label: 'All' },
];
const metadata = {
  columnMetaMap: { id: { comment: 'Identifier' } },
  columnMetaMapByLowerName: { name: { comment: 'Display name' } },
  displayOutputColumnNames: ['id', 'NAME'],
  dbType: 'mysql', hasResolvedInsertSQLTarget: true, tableName: 'users',
  insertSQLColumnTypes: { id: 'int', NAME: 'varchar' },
  insertSQLTargetColumns: { id: 'id', NAME: 'name' },
};

describe('query result export options', () => {
  it('keeps XLSX default, enabled scope fallback and CSV BOM default', () => {
    expect(normalizeDataExportDialogValues(scopes, { scope: 'selected' })).toMatchObject({
      format: 'xlsx', scope: 'page', csvEncoding: 'utf-8-bom', xlsxMaxRowsPerSheet: 1048575,
    });
    expect(normalizeDataExportDialogValues(scopes, { scope: 'all' }).scope).toBe('all');
  });

  it('offers Parquet without enabling the separate table workbench format', () => {
    expect(DATA_EXPORT_FORMAT_OPTIONS.some(({ value }) => value === 'parquet')).toBe(true);
    expect(createTableExportFormatOptions().some(({ value }) => value === 'parquet')).toBe(false);
    const values = normalizeDataExportDialogValues(scopes, { format: 'parquet' });
    expect(values.format).toBe('parquet');
    expect(validateDataExportDialogValues(values, scopes)).toBeNull();
  });

  it.each(DATA_EXPORT_CSV_ENCODINGS)('preserves %s through normalization and metadata mapping', (csvEncoding) => {
    const values = normalizeDataExportDialogValues(scopes, {
      format: 'csv', csvEncoding, columns: ['NAME', 'id'], useColumnComments: true,
    }, false, ['id', 'NAME']);
    expect(validateDataExportDialogValues(values, scopes)).toBeNull();
    expect(buildDataGridBackendExportOptions(values, metadata)).toMatchObject({
      format: 'csv', csvEncoding, columns: ['id', 'NAME'], scope: 'page',
      columnComments: { id: 'Identifier', NAME: 'Display name' },
    });
  });

  it('defaults legacy CSV options and rejects explicitly unsupported encodings', () => {
    expect(buildDataGridBackendExportOptions({ format: 'csv' }, metadata).csvEncoding).toBe('utf-8-bom');
    const values = normalizeDataExportDialogValues(scopes, {
      format: 'csv', csvEncoding: 'latin-1' as DataExportCSVEncoding,
    });
    expect(validateDataExportDialogValues(values, scopes)).toBeTruthy();
    expect(validateDataExportDialogValues({ ...values, format: 'parquet' }, scopes)).toBeNull();
  });

  it.each(['xlsx', 'parquet', 'json', 'md', 'html', 'sql'] as const)(
    'does not leak CSV encoding into %s submissions or backend options', (format) => {
      const values = { format, csvEncoding: 'gbk' as const, scope: 'all' };
      expect(resolveDataExportFileOptions(values)).not.toHaveProperty('csvEncoding');
      expect(buildDataGridBackendExportOptions(values, metadata)).not.toHaveProperty('csvEncoding');
      expect(values.csvEncoding).toBe('gbk');
    },
  );

  it('keeps SQL metadata and comment header behavior intact', () => {
    expect(buildDataGridBackendExportOptions({ format: 'sql' }, metadata)).toMatchObject({
      insertSQLDialect: 'mysql', insertSQLTargetTable: 'users',
      insertSQLColumnTypes: metadata.insertSQLColumnTypes,
      insertSQLTargetColumns: metadata.insertSQLTargetColumns,
      insertSQLAllowEmptyTargetTable: false,
    });
    expect(buildDataGridBackendExportOptions({ format: 'parquet', useColumnComments: true }, metadata))
      .not.toHaveProperty('columnComments');
    expect(buildDataGridBackendExportOptions({ format: 'csv', columns: ['id'], useColumnComments: true }, metadata))
      .toMatchObject({ columnComments: { id: 'Identifier' } });
  });
});
