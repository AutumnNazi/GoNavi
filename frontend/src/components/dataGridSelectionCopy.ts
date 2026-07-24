export interface SelectedGridCell {
  rowKey: string;
  colName: string;
}

export const canSelectGridCellForClipboard = ({
  canModifyData,
  isDisplayedColumn,
  isWritableColumn,
}: {
  canModifyData: boolean;
  isDisplayedColumn: boolean;
  isWritableColumn: boolean;
}): boolean => isDisplayedColumn && (!canModifyData || isWritableColumn);

const normalizeClipboardCellValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    return value.replace(/\r\n/g, '\n').replace(/[\t\n\r]+/g, ' ').trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value).replace(/[\t\n\r]+/g, ' ').trim();
  } catch {
    return String(value).replace(/[\t\n\r]+/g, ' ').trim();
  }
};

export const buildSelectedCellClipboardText = ({
  selectedCells,
  rows,
  columnOrder,
  rowKeyField,
}: {
  selectedCells: SelectedGridCell[];
  rows: Array<Record<string, any>>;
  columnOrder: string[];
  rowKeyField: string;
}): string => {
  if (!selectedCells.length || !rows.length || !columnOrder.length || !rowKeyField) {
    return '';
  }

  const selectedRowKeys = new Set(selectedCells.map((cell) => cell.rowKey));
  const selectedColumnKeys = new Set(selectedCells.map((cell) => cell.colName));
  const orderedRows = rows.filter((row) => selectedRowKeys.has(String(row?.[rowKeyField] ?? '')));
  const orderedColumns = columnOrder.filter((columnName) => selectedColumnKeys.has(columnName));

  if (!orderedRows.length || !orderedColumns.length) {
    return '';
  }

  const selectedCellKeySet = new Set(selectedCells.map((cell) => `${cell.rowKey}::${cell.colName}`));

  return orderedRows
    .map((row) => {
      const rowKey = String(row?.[rowKeyField] ?? '');
      return orderedColumns
        .map((columnName) => {
          if (!selectedCellKeySet.has(`${rowKey}::${columnName}`)) {
            return '';
          }
          return normalizeClipboardCellValue(row?.[columnName]);
        })
        .join('\t');
    })
    .join('\n');
};
