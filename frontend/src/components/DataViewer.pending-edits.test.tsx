import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataViewer from './DataViewer';
import DataGrid from './DataGrid';
import DataGridShell from './DataGridShell';
import DataGridToolbarFrame from './DataGridToolbarFrame';
import DataGridPreviewPanel from './DataGridPreviewPanel';
import { backendApp, messageApi, testRenderState } from './dataGridDdlTestState';
import { waitForEffects, createRenderedCellTarget } from './dataGridDdlTestHelpers';
import { setUpDataGridDdlTest, tearDownDataGridDdlTest } from './dataGridDdlTestHooks';
import type { TabData } from '../types';
import { getViewerFilterSnapshot, setViewerFilterSnapshot } from './dataViewer/dataViewerFilterSnapshots';

vi.mock('../store', async () => (await import('./dataGridDdlTestState')).mockModule1());
vi.mock('../../wailsjs/go/app/App', async () => (await import('./dataGridDdlTestState')).mockModule2());
vi.mock('../../wailsjs/runtime/runtime', async () => (await import('./dataGridDdlTestState')).mockModule3());
vi.mock('react-dom', async () => (await import('./dataGridDdlTestState')).mockModule4());
vi.mock('@monaco-editor/react', async () => (await import('./dataGridDdlTestState')).mockModule5());
vi.mock('./ImportPreviewModal', async () => (await import('./dataGridDdlTestState')).mockModule6());
vi.mock('./TableDesigner', async () => (await import('./dataGridDdlTestState')).mockModule7());
vi.mock('@ant-design/icons', async () => ({
  ...(await import('./dataGridDdlTestState')).mockModule8(),
  ExperimentOutlined: () => null,
  CheckOutlined: () => null,
  VerticalLeftOutlined: () => null,
  VerticalRightOutlined: () => null,
}));
vi.mock('@dnd-kit/core', async () => (await import('./dataGridDdlTestState')).mockModule9());
vi.mock('@dnd-kit/sortable', async () => (await import('./dataGridDdlTestState')).mockModule10());
vi.mock('@dnd-kit/utilities', async () => (await import('./dataGridDdlTestState')).mockModule11());
vi.mock('antd', async () => (await import('./dataGridDdlTestState')).mockModule12());

type Row = { id: number; name: string; __gonavi_row_key__?: string };
let renderer: ReactTestRenderer | undefined;
let storedRows: Row[];
let tab: TabData;
let sequence = 0;
const shell = () => renderer!.root.findByType(DataGridShell).props;
const toolbar = () => renderer!.root.findByType(DataGridToolbarFrame).props;

const editName = async (name: string) => {
  const row = shell().mergedDisplayData[0] as Row;
  const column = testRenderState.latestColumns.find((item) => item.key === 'name');
  const target = createRenderedCellTarget(row.__gonavi_row_key__!, 'name');
  await act(async () => {
    column.onCell(row).onContextMenu({
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
      clientX: 100, clientY: 100, currentTarget: target, target,
    });
  });
  await act(async () => shell().handleOpenContextMenuCellEditor());
  await act(async () => shell().handleCellEditorValueChange(name));
  await act(async () => shell().handleCellEditorSave());
  await waitForEffects();
};

beforeEach(() => {
  setUpDataGridDdlTest();
  messageApi.warning.mockClear();
  storedRows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
  tab = { id: `pending-edits-${++sequence}`, title: 'users', type: 'table',
    connectionId: 'conn-1', dbName: 'main', tableName: 'users' };
  setViewerFilterSnapshot(tab.id, {
    ...getViewerFilterSnapshot(tab.id), showFilter: true,
    conditions: [{ id: 1, column: 'id', op: '=', value: '2', enabled: true }],
  });
  backendApp.DBGetColumns.mockResolvedValue({ success: true, data: [
    { name: 'id', key: 'PRI', type: 'int' }, { name: 'name', type: 'varchar(100)' },
  ] });
  backendApp.DBQuery.mockImplementation(async (_config: unknown, _db: string, sql: string) => {
    const filtered = /WHERE/.test(sql);
    return { success: true, fields: ['id', 'name'],
      data: storedRows.filter((row) => !filtered || row.id === 2).map((row) => ({ ...row })) };
  });
  backendApp.ApplyChanges.mockImplementation(async (_config: unknown, _db: string, _table: string,
    changes: { updates: { keys: { id: number }; values: Partial<Row> }[] }) => {
    for (const update of changes.updates) {
      const row = storedRows.find((item) => item.id === update.keys.id)!;
      Object.assign(row, update.values);
    }
    return { success: true, data: { inserts: [], updates: [], deletes: [] } };
  });
});

afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  tearDownDataGridDdlTest();
});

const mount = async () => {
  await act(async () => { renderer = create(<DataViewer tab={tab} />); });
  await waitForEffects();
  expect(shell().mergedDisplayData).toMatchObject([{ id: 2, name: 'Bob' }]);
};

describe('table queries with pending edits', () => {
  it('keeps filtered edits until commit, then clears the filter without a primary-key conflict', async () => {
    await mount();
    await editName('Bob edited');
    const queryCount = backendApp.DBQuery.mock.calls.length;
    await act(async () => shell().clearAllFiltersAndSorts());
    await waitForEffects();
    expect(backendApp.DBQuery).toHaveBeenCalledTimes(queryCount);
    expect(shell().filterConditions).toMatchObject([{ column: 'id', value: '2' }]);
    expect(shell().mergedDisplayData).toMatchObject([{ id: 2, name: 'Bob edited' }]);
    expect(shell().hasChanges).toBe(true);
    expect(messageApi.warning).toHaveBeenCalledTimes(1);

    await act(async () => { expect(await shell().handleCommit()).toBe(true); });
    await waitForEffects();
    expect(backendApp.ApplyChanges).toHaveBeenCalledTimes(1);
    expect(backendApp.ApplyChanges.mock.calls[0][3].updates).toEqual([{
      keys: { id: 2 }, values: { name: 'Bob edited' }, previousValues: { name: 'Bob' },
    }]);
    expect(backendApp.DBQuery.mock.calls.length).toBeGreaterThan(queryCount);
    expect(shell().hasChanges).toBe(false);
    await act(async () => shell().clearAllFiltersAndSorts());
    await waitForEffects();
    expect(shell().mergedDisplayData).toMatchObject([
      { id: 1, name: 'Alice' }, { id: 2, name: 'Bob edited' },
    ]);
    await act(async () => { await shell().handleCommit(); });
    expect(backendApp.ApplyChanges).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed edit retryable and allows querying after explicit rollback', async () => {
    await mount();
    await editName('Bob edited');
    backendApp.ApplyChanges.mockResolvedValueOnce({ success: false, message: 'constraint rejected' });
    await act(async () => { expect(await shell().handleCommit()).toBe(false); });
    const queryCount = backendApp.DBQuery.mock.calls.length;
    await act(async () => shell().clearAllFiltersAndSorts());
    expect(shell().hasChanges).toBe(true);
    expect(backendApp.DBQuery).toHaveBeenCalledTimes(queryCount);
    await act(async () => toolbar().onResetPendingChanges());
    expect(shell().hasChanges).toBe(false);
    await act(async () => shell().clearAllFiltersAndSorts());
    await waitForEffects();
    expect(shell().mergedDisplayData).toMatchObject(storedRows);
    await act(async () => { await shell().handleCommit(); });
    expect(backendApp.ApplyChanges).toHaveBeenCalledTimes(1);
  });

  it('still reloads authoritative data after an unknown commit outcome without replaying edits', async () => {
    await mount();
    await editName('Bob edited');
    const queryCount = backendApp.DBQuery.mock.calls.length;
    backendApp.ApplyChanges.mockResolvedValueOnce({
      success: false, outcomeUnknown: true, message: 'response lost',
      data: { inserts: [], updates: [], deletes: [] },
    });
    await act(async () => { expect(await shell().handleCommit()).toBe(false); });
    await waitForEffects();
    expect(backendApp.DBQuery.mock.calls.length).toBeGreaterThan(queryCount);
    expect(shell().hasChanges).toBe(false);
    expect(shell().mergedDisplayData).toMatchObject([{ id: 2, name: 'Bob' }]);
    await act(async () => { await shell().handleCommit(); });
    expect(backendApp.ApplyChanges).toHaveBeenCalledTimes(1);
  });

  it('rejects local filter and sort changes while preserving their applied state', async () => {
    await mount();
    await editName('Bob edited');
    const initialFilters = shell().filterConditions;
    const queryCount = backendApp.DBQuery.mock.calls.length;
    await act(async () => shell().applyAllFiltersDisabled());
    await act(async () => shell().applyFilters());
    await act(async () => shell().applySortInfo([{ columnKey: 'name', order: 'ascend' }]));
    await waitForEffects();
    expect(shell().filterConditions).toEqual(initialFilters);
    expect(shell().sortInfo).toEqual([]);
    expect(backendApp.DBQuery).toHaveBeenCalledTimes(queryCount);
    expect(shell().hasChanges).toBe(true);
  });

  it('preserves the old row baseline if edits are made while a reload is in flight', async () => {
    await mount();
    let finish!: (result: { success: boolean; fields: string[]; data: Row[] }) => void;
    backendApp.DBQuery.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let reload!: Promise<void>;
    await act(async () => { reload = renderer!.root.findByType(DataGrid).props.onReload(); });
    await editName('Bob edited');
    await act(async () => {
      finish({ success: true, fields: ['id', 'name'], data: [{ id: 1, name: 'Alice' }] });
      await reload;
    });
    await waitForEffects();
    expect(shell().loading).toBe(false);
    expect(shell().hasChanges).toBe(true);
    expect(shell().mergedDisplayData).toMatchObject([{ id: 2, name: 'Bob edited' }]);
    await act(async () => { await shell().handleCommit(); });
    expect(backendApp.ApplyChanges.mock.calls[0][3].updates[0]).toMatchObject({
      keys: { id: 2 }, values: { name: 'Bob edited' },
    });
  });

  it('invalidates a clean preview when a new query reuses the previous row key', async () => {
    await mount();
    await act(async () => shell().toggleDataPanel());
    await act(async () => shell().handleVirtualTableClickCapture({
      target: createRenderedCellTarget('row-0', 'name'),
    }));
    expect(shell().focusedCellInfo.record.id).toBe(2);
    const staleSave = shell().handleDataPanelSave;
    await act(async () => shell().clearAllFiltersAndSorts());
    await waitForEffects();
    expect(shell().mergedDisplayData[0].id).toBe(1);
    expect(shell().focusedCellInfo).toBeNull();
    expect(shell().dataPanelOpen).toBe(false);
    await act(async () => { expect(staleSave()).toBe(false); });
    expect(shell().hasChanges).toBe(false);
    expect(backendApp.ApplyChanges).not.toHaveBeenCalled();
  });

  it('keeps unsaved preview input when filtering is rejected', async () => {
    await mount();
    await act(async () => shell().toggleDataPanel());
    await act(async () => shell().handleVirtualTableClickCapture({
      target: createRenderedCellTarget('row-0', 'name'),
    }));
    await act(async () => {
      const panel = renderer!.root.findByType(DataGridPreviewPanel);
      panel.props.onValueChange('Bob edited');
      panel.props.onDirtyChange(true);
    });
    const queryCount = backendApp.DBQuery.mock.calls.length;
    await act(async () => shell().clearAllFiltersAndSorts());
    expect(backendApp.DBQuery).toHaveBeenCalledTimes(queryCount);
    expect(shell().dataPanelOpen).toBe(true);
    expect(shell().dataPanelValue).toBe('Bob edited');
    await act(async () => { expect(shell().handleDataPanelSave()).toBe(true); });
    await act(async () => { await shell().handleCommit(); });
    expect(backendApp.ApplyChanges.mock.calls[0][3].updates[0]).toMatchObject({
      keys: { id: 2 }, values: { name: 'Bob edited' },
    });
  });
});
