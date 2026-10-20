import { useCallback, useMemo } from 'react';
import type { MenuProps } from 'antd';
import type { DataGridClipboardPayload } from '../../dataGridClipboardPayload';
import { GONAVI_ROW_KEY, splitCellKey } from '../core/dataGridCellKeys';
import { formatClipboardCellText } from '../core/dataGridCellDisplay';
import {
  buildDataGridCopyContent, canCopyDataGridContent, resolveDataGridCopyMatrix, resolveDataGridCopyTarget,
  type DataGridCopyContent, type DataGridCopyScope, type DataGridCopySelection,
} from './dataGridCopyContent';

export interface DataGridCopyMenuGroup {
  scope: DataGridCopyScope;
  label: string;
  items: Array<{ content: DataGridCopyContent; label: string; disabled: boolean; onClick: () => void }>;
}

export interface UseDataGridCopyContentInput {
  rows: DataGridCopySelection['rows'];
  columnNames: readonly string[];
  selectedRowKeys: readonly unknown[];
  selectedCells: ReadonlySet<string>;
  currentSelectionRef?: { readonly current: ReadonlySet<string> };
  copyToClipboard: (payload: DataGridClipboardPayload) => void;
  translate: (key: string) => string;
  columnMetaMap?: Record<string, { type?: string }>;
  columnMetaMapByLowerName?: Record<string, { type?: string }>;
  connectionConfig?: Parameters<typeof formatClipboardCellText>[2];
}

const contentKeys: Array<[DataGridCopyContent, string]> = [
  ['headers', 'data_grid.copy_content.headers'],
  ['data', 'data_grid.copy_content.data'],
  ['headersAndData', 'data_grid.copy_content.headers_and_data'],
];
const scopeKeys: Array<[DataGridCopyScope, string]> = [
  ['selected', 'data_grid.copy_scope.selected'],
  ['allLoaded', 'data_grid.copy_scope.all_loaded'],
];

export const useDataGridCopyContent = (input: UseDataGridCopyContentInput) => {
  const getSelection = useCallback((): DataGridCopySelection => {
    const activeCells = input.currentSelectionRef?.current.size
      ? input.currentSelectionRef.current : input.selectedCells;
    const selectedCells = Array.from(activeCells).flatMap((key) => {
      const cell = splitCellKey(key);
      return cell ? [cell] : [];
    });
    return {
      rows: input.rows,
      columnNames: input.columnNames,
      selectedRowKeys: input.selectedRowKeys,
      selectedCells,
      hasCellSelection: activeCells.size > 0,
      rowKeyField: GONAVI_ROW_KEY,
      formatCell: (value, column) => formatClipboardCellText(
        value,
        (input.columnMetaMap?.[column] ?? input.columnMetaMapByLowerName?.[column.toLowerCase()])?.type,
        input.connectionConfig,
      ),
    };
  }, [input.rows, input.columnNames, input.selectedRowKeys, input.selectedCells, input.currentSelectionRef,
    input.columnMetaMap, input.columnMetaMapByLowerName, input.connectionConfig]);
  const copy = useCallback((scope: DataGridCopyScope, content: DataGridCopyContent) => {
    const payload = buildDataGridCopyContent(resolveDataGridCopyMatrix(getSelection(), scope, content), content);
    if (payload) input.copyToClipboard(payload);
  }, [input.copyToClipboard, getSelection]);
  const groups = useMemo<DataGridCopyMenuGroup[]>(() => scopeKeys.map(([scope, key]) => {
    const matrix = resolveDataGridCopyTarget(getSelection(), scope);
    return {
      scope,
      label: input.translate(key),
      items: contentKeys.map(([content, contentKey]) => ({
        content,
        label: input.translate(contentKey),
        disabled: !canCopyDataGridContent(matrix, content),
        onClick: () => copy(scope, content),
      })),
    };
  }), [copy, input.translate, getSelection]);
  const menuItems: MenuProps['items'] = groups.map((group) => ({
    key: `copy-${group.scope}`,
    label: group.label,
    disabled: group.items.every((item) => item.disabled),
    children: group.items.map((item) => ({ ...item, key: `copy-${group.scope}-${item.content}` })),
  }));
  return { groups, menuItems, copy, canCopy: groups.some((group) => group.items.some((item) => !item.disabled)) };
};

export type DataGridCopyContentApi = ReturnType<typeof useDataGridCopyContent>;
