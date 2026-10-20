// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDataGridV2ColumnActions, type UseDataGridV2ColumnActionsInput, type DataGridV2ColumnActionsApi } from './useDataGridV2ColumnActions';
import { buildSelectedCellClipboardPayload } from '../../dataGridSelectionCopy';
import { GONAVI_ROW_KEY, makeCellKey, splitCellKey } from '../core/dataGridCellKeys';

vi.mock('antd', () => ({ message: { info: vi.fn(), success: vi.fn() } }));

describe('legacy copy hook compatibility', () => {
  let renderer: ReactTestRenderer;
  let api: DataGridV2ColumnActionsApi;
  const copyToClipboard = vi.fn();
  const rows = [{ [GONAVI_ROW_KEY]: 'a', name: 'Alice', id: 1 }];
  const cells = new Set([makeCellKey('a', 'name')]);
  const createInput = (): UseDataGridV2ColumnActionsInput => ({
    resolveContextMenuFieldName: () => 'name', cellContextMenu: {}, translateDataGrid: (key: string) => key,
    setCellContextMenu: vi.fn(), copyToClipboard, columnMetaMap: {}, columnMetaMapByLowerName: {},
    handleCopyColumnData: vi.fn(), applyColumnSort: vi.fn(), autoFitColumnWidth: vi.fn(),
    connectionId: 'connection', dbName: 'db', pinnedLeftColumnScope: '', pinnedLeftColumnNames: [],
    setTablePinnedLeftColumns: vi.fn(), displayColumnNames: ['name', 'id'], toggleColumnVisibility: vi.fn(),
    setQueryOptions: vi.fn(), pickRowsForClipboard: () => rows, mergedDisplayData: rows,
    selectedRowKeys: [], displayOutputColumnNames: ['name', 'id'], GONAVI_ROW_KEY,
    rowKeyStr: String, buildClipboardCsv: vi.fn(() => 'legacy-csv'), buildClipboardJson: vi.fn(() => 'legacy-json'),
    buildClipboardMarkdown: vi.fn(() => 'legacy-markdown'), ddlText: '', navigator,
    currentSelectionRef: { current: cells }, selectedCells: cells, splitCellKey, buildSelectedCellClipboardPayload,
    isActive: true, isTableSurfaceActive: true, cellEditMode: false, closeCellEditMode: vi.fn(),
    resetCellSelection: vi.fn(), rootRef: { current: document.body }, selectedRowKeysRef: { current: [] },
    displayDataRef: { current: rows },
  });
  function Harness({ input }: { input: UseDataGridV2ColumnActionsInput }) {
    api = useDataGridV2ColumnActions(input);
    return null;
  }
  afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });

  it('retains data-only cell copy event behavior without implicit headers', () => {
    act(() => { renderer = create(<Harness input={createInput()} />); });
    const setData = vi.fn();
    const event = new Event('copy', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData, clearData: vi.fn() } });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith('text/plain', 'Alice');
    const html = setData.mock.calls.find(([mime]) => mime === 'text/html')?.[1];
    expect(html).toContain('<td>Alice</td>');
    expect(html).not.toContain('<thead>');
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('does not intercept text-field native copy shortcuts', () => {
    act(() => { renderer = create(<Harness input={createInput()} />); });
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    const setData = vi.fn();
    Object.defineProperty(event, 'clipboardData', { value: { setData, clearData: vi.fn() } });
    act(() => { input.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(setData).not.toHaveBeenCalled();
    input.remove();
  });

  it('retains explicit legacy cell copy and dedicated formats', () => {
    const input = createInput();
    act(() => { renderer = create(<Harness input={input} />); });
    act(() => api.handleCopySelectedCellsToClipboard());
    expect(copyToClipboard.mock.lastCall?.[0].plainText).toBe('Alice');
    act(() => api.handleCopyQueryResultCsv());
    expect(copyToClipboard).toHaveBeenLastCalledWith('legacy-csv');
    act(() => api.handleCopyQueryResultJson());
    expect(copyToClipboard).toHaveBeenLastCalledWith('legacy-json');
    act(() => api.handleCopyQueryResultMarkdown());
    expect(copyToClipboard).toHaveBeenLastCalledWith('legacy-markdown');
  });

  it('keeps the box selection when mousedown lands inside the custom context menu portal', () => {
    const input = createInput();
    input.rootRef = { current: document.createElement('div') };
    act(() => { renderer = create(<Harness input={input} />); });
    const portal = document.createElement('div');
    portal.className = 'gn-v2-table-context-menu-portal';
    const button = document.createElement('button');
    portal.append(button);
    document.body.append(portal);
    act(() => { button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(input.resetCellSelection).not.toHaveBeenCalled();
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(input.resetCellSelection).toHaveBeenCalledOnce();
    portal.remove();
  });
});
