import { buildTabularClipboardPayload, type DataGridClipboardCell, type DataGridClipboardPayload } from '../../dataGridClipboardPayload';
import type { SelectedGridCell } from '../../dataGridSelectionCopy';

export type DataGridCopyScope = 'selected' | 'allLoaded';
export type DataGridCopyContent = 'headers' | 'data' | 'headersAndData';
export interface DataGridCopyMatrix {
  columns: string[];
  rows: DataGridClipboardCell[][];
}
export interface DataGridCopySelection {
  rows: ReadonlyArray<Record<string, unknown>>;
  columnNames: readonly string[];
  selectedRowKeys: readonly unknown[];
  selectedCells: readonly SelectedGridCell[];
  hasCellSelection?: boolean;
  rowKeyField: string;
  formatCell?: (value: unknown, column: string) => string;
}

const formatValue = (value: unknown): string => {
  if (typeof value !== 'object') return String(value);
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};

export const resolveDataGridCopyTarget = (
  input: DataGridCopySelection,
  scope: DataGridCopyScope,
) => {
  const { rows, selectedCells, rowKeyField } = input;
  let columns = input.columnNames.filter((column) => column !== rowKeyField);
  let selectedRows = rows;
  let cellsByRow: Map<string, Set<string>> | undefined;
  if (scope === 'selected') {
    if (input.hasCellSelection || selectedCells.length > 0) {
      cellsByRow = new Map();
      const displayedKeys = new Set(rows.map((row) => String(row[rowKeyField])));
      const selectedColumns = new Set<string>();
      selectedCells.forEach(({ rowKey, colName }) => {
        if (!displayedKeys.has(rowKey) || !columns.includes(colName)) return;
        const cells = cellsByRow!.get(rowKey) ?? new Set<string>();
        cells.add(colName);
        cellsByRow!.set(rowKey, cells);
        selectedColumns.add(colName);
      });
      columns = columns.filter((column) => selectedColumns.has(column));
      selectedRows = rows.filter((row) => cellsByRow!.has(String(row[rowKeyField])));
    } else {
      const keys = new Set(input.selectedRowKeys.map(String));
      selectedRows = rows.filter((row) => row[rowKeyField] != null && keys.has(String(row[rowKeyField])));
    }
    if (selectedRows.length === 0) return { columns: [], rows: [] };
  }
  return { columns, rows: selectedRows, cellsByRow };
};

export const resolveDataGridCopyMatrix = (
  input: DataGridCopySelection,
  scope: DataGridCopyScope,
  content: DataGridCopyContent = 'headersAndData',
): DataGridCopyMatrix => {
  const { columns, rows, cellsByRow } = resolveDataGridCopyTarget(input, scope);
  const format = input.formatCell ?? formatValue;
  return {
    columns,
    rows: content === 'headers' ? [] : rows.map((row) => columns.map((column) => {
      if (cellsByRow && !cellsByRow.get(String(row[input.rowKeyField]))?.has(column)) return '';
      const value = row[column];
      return value == null ? null : format(value, column);
    })),
  };
};

export const canCopyDataGridContent = (
  matrix: { columns: readonly string[]; rows: readonly unknown[] },
  content: DataGridCopyContent,
): boolean => (
  matrix.columns.length > 0 && (content === 'headers' || matrix.rows.length > 0)
);

const escapeTsvCell = (value: DataGridClipboardCell): string => {
  if (value === null) return 'NULL';
  if (value === '' || value === 'NULL' || /[\t\r\n"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

export const buildDataGridCopyContent = (
  matrix: DataGridCopyMatrix,
  content: DataGridCopyContent,
): DataGridClipboardPayload | null => {
  if (!canCopyDataGridContent(matrix, content)) return null;
  const columns = content === 'data' ? undefined : matrix.columns;
  const rows = content === 'headers' ? [] : matrix.rows;
  const payload = buildTabularClipboardPayload({ columns, rows, preserveCellTypes: true });
  // Keep TSV quoting lossless while using the existing typed HTML/JSON clipboard contract.
  const textRows = columns ? [columns, ...rows] : rows;
  return { ...payload, plainText: textRows.map((row) => row.map(escapeTsvCell).join('\t')).join('\n') };
};
