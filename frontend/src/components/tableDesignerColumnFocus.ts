/** React 给单元格 key 加上 ".$ " 前缀，不能用裸的 "sort" 比较。 */
export const isTableDesignerSortCellKey = (reactKey: string | null | undefined): boolean => {
  const key = String(reactKey || '');
  return key === 'sort' || key.endsWith('$sort');
};

export const tableDesignerRowSelector = (rowKey: string): string => {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(rowKey)
    : rowKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tr[data-row-key="${escaped}"]`;
};

/** 新行自动聚焦应落到字段名输入框，而不是行首勾选框。 */
export const findDesignerColumnNameInput = (row: ParentNode): HTMLInputElement | null => {
  const named = row.querySelector(
    '.table-designer-cell-field input:not([type="checkbox"]):not([type="radio"])',
  );
  if (named instanceof HTMLInputElement) return named;
  const fallback = row.querySelector('input:not([type="checkbox"]):not([type="radio"])');
  return fallback instanceof HTMLInputElement ? fallback : null;
};
