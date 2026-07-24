import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const actionsSource = readFileSync(new URL('./useDataGridV2Actions.ts', import.meta.url), 'utf8');
const gridSource = readFileSync(new URL('./DataGrid.tsx', import.meta.url), 'utf8');

describe('DataGrid export columns', () => {
  it('offers result columns in the export dialog and forwards the selected order', () => {
    expect(actionsSource).toContain('availableColumns: displayOutputColumnNames');
    expect(actionsSource).toContain('columns: values.columns');
  });

  it('uses selected columns for local row projection and backend ExportData arguments', () => {
    expect(gridSource).toContain('resolveDataExportColumns(options.columns, displayOutputColumnNames)');
    expect(gridSource).toContain('pickDataGridOutputRows(rows, exportColumns)');
    expect(gridSource).toMatch(/ExportDataWithOptions\(\s*cleanRows,\s*exportColumns,/);
  });
});
