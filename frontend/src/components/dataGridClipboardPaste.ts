export type DataGridClipboardValue = string | null;

export interface DataGridClipboardPasteRow {
  rowKey: string;
  values: Record<string, DataGridClipboardValue>;
  modifiedValues: Record<string, any>;
  modifiedColumnNames: string[];
  isAdded: boolean;
}

export const parseDataGridClipboardText = (text: string): DataGridClipboardValue[][] => {
  const normalized = text.replace(/\r\n?/g, '\n');
  const content = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;

  return content.split('\n').map((line) => (
    line.split('\t').map((value) => value === 'NULL' ? null : value)
  ));
};

export const buildDataGridClipboardPasteRows = ({
  matrix,
  rows,
  columnNames,
  startRowIndex,
  startColumnIndex,
  rowKeyField,
  addedRowKeys,
  modifiedRows,
  deletedRowKeys,
  isWritableColumn,
  isValueEqual,
}: {
  matrix: DataGridClipboardValue[][];
  rows: Array<Record<string, any>>;
  columnNames: string[];
  startRowIndex: number;
  startColumnIndex: number;
  rowKeyField: string;
  addedRowKeys: Set<string>;
  modifiedRows: Record<string, any>;
  deletedRowKeys: Set<string>;
  isWritableColumn: (columnName: string) => boolean;
  isValueEqual: (left: any, right: any) => boolean;
}): { rows: DataGridClipboardPasteRow[]; updatedCellCount: number } => {
  if (!matrix.length || startRowIndex < 0 || startColumnIndex < 0) {
    return { rows: [], updatedCellCount: 0 };
  }

  const pasteRows: DataGridClipboardPasteRow[] = [];
  let updatedCellCount = 0;

  matrix.forEach((sourceValues, sourceRowIndex) => {
    const baseRow = rows[startRowIndex + sourceRowIndex];
    const rowKeyValue = baseRow?.[rowKeyField];
    if (rowKeyValue === undefined || rowKeyValue === null) return;

    const rowKey = String(rowKeyValue);
    if (deletedRowKeys.has(rowKey)) return;

    const existing = modifiedRows[rowKey] || {};
    const currentRow = addedRowKeys.has(rowKey) ? baseRow : { ...baseRow, ...existing };
    const values: Record<string, DataGridClipboardValue> = {};

    sourceValues.forEach((nextValue, sourceColumnIndex) => {
      const columnName = columnNames[startColumnIndex + sourceColumnIndex];
      if (!columnName || !isWritableColumn(columnName)) return;
      if (isValueEqual(currentRow?.[columnName], nextValue)) return;
      values[columnName] = nextValue;
      updatedCellCount += 1;
    });

    if (Object.keys(values).length === 0) return;

    const modifiedValues: Record<string, any> = {};
    const modifiedColumnNames: string[] = [];
    if (!addedRowKeys.has(rowKey)) {
      const candidateValues = { ...existing, ...values };
      Object.keys(candidateValues).forEach((columnName) => {
        if (!isValueEqual(baseRow?.[columnName], candidateValues[columnName])) {
          modifiedValues[columnName] = candidateValues[columnName];
          modifiedColumnNames.push(columnName);
        }
      });
    }

    pasteRows.push({
      rowKey,
      values,
      modifiedValues,
      modifiedColumnNames,
      isAdded: addedRowKeys.has(rowKey),
    });
  });

  return { rows: pasteRows, updatedCellCount };
};
