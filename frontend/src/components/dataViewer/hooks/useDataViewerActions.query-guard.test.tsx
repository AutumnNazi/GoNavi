import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkbenchTabCloseGuard } from '../../../utils/workbenchTabCloseProtection';
import {
  useDataViewerActions,
  type DataViewerActionsApi,
  type UseDataViewerActionsInput,
} from './useDataViewerActions';

const messageApi = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('antd', () => ({ message: messageApi }));

const createInput = () => ({
  deferredInitialFetchRef: { current: true },
  initialLoadRef: { current: false },
  fetchData: vi.fn(async () => undefined),
  pagination: {
    current: 3, pageSize: 20, total: 80, totalKnown: true,
    totalApprox: false, totalCountLoading: false, totalCountCancelled: false,
  },
  countSeqRef: { current: 2 },
  manualCountSeqRef: { current: 2 },
  duckdbApproxSeqRef: { current: 2 },
  oracleApproxSeqRef: { current: 2 },
  countKeyRef: { current: 'count-key' },
  autoCountKeyRef: { current: 'auto-count-key' },
  manualCountKeyRef: { current: 'manual-count-key' },
  duckdbApproxKeyRef: { current: 'duckdb-count-key' },
  oracleApproxKeyRef: { current: 'oracle-count-key' },
  setPagination: vi.fn(),
  setSortInfo: vi.fn(),
  rocketMQTagTotalCountUnavailable: false,
  tr: vi.fn((key: string) => key),
  setShowFilter: vi.fn(),
  skipNextAutoFetchRef: { current: true },
  setFilterConditions: vi.fn(),
  setQuickWhereCondition: vi.fn(),
  tab: { id: 'guard-tab', title: 'users', type: 'table', tableName: 'users', connectionId: 'conn-1' },
  currentConnConfig: undefined,
  filterConditions: [{ id: 1, column: 'id', op: '=', value: '2', enabled: true }],
  quickWhereCondition: 'id = 2',
  sortInfo: [{ columnKey: 'id', order: 'ascend', enabled: true }],
  editLocator: undefined,
  pkColumns: ['id'],
} satisfies UseDataViewerActionsInput);

type TestInput = ReturnType<typeof createInput>;
type QueryAction = {
  name: string;
  invoke: (actions: DataViewerActionsApi) => unknown;
  output: 'fetchData' | 'setSortInfo' | 'setFilterConditions' | 'setQuickWhereCondition';
  expectedArgs: unknown[];
};

const queryActions: QueryAction[] = [
  { name: 'reload', invoke: a => a.handleReload(), output: 'fetchData', expectedArgs: [3, 20, { refreshTotal: true }] },
  { name: 'change page', invoke: a => a.handlePageChange(4, 20), output: 'fetchData', expectedArgs: [4, 20] },
  { name: 'change page size', invoke: a => a.handlePageChange(1, 50), output: 'fetchData', expectedArgs: [1, 50] },
  { name: 'last page', invoke: a => a.handleLastPage(20), output: 'fetchData', expectedArgs: [1, 20, { navigateToLastPage: true }] },
  { name: 'sort', invoke: a => a.handleSort('name', 'descend'), output: 'setSortInfo', expectedArgs: [[{ columnKey: 'name', order: 'descend', enabled: true }]] },
  { name: 'clear sort', invoke: a => a.handleSort('', ''), output: 'setSortInfo', expectedArgs: [[]] },
  { name: 'multiple sorts', invoke: a => a.handleSort('[{"columnKey":"name","order":"ascend"}]', ''), output: 'setSortInfo', expectedArgs: [[{ columnKey: 'name', order: 'ascend' }]] },
  { name: 'clear filters', invoke: a => a.handleApplyFilter([]), output: 'setFilterConditions', expectedArgs: [[]] },
  {
    name: 'apply or enable filters',
    invoke: a => a.handleApplyFilter([{ id: 1, column: 'id', op: '=', value: '2', enabled: true }]),
    output: 'setFilterConditions',
    expectedArgs: [[expect.objectContaining({ column: 'id', value: '2', enabled: true })]],
  },
  {
    name: 'disable filters',
    invoke: a => a.handleApplyFilter([{ id: 1, column: 'id', op: '=', value: '2', enabled: false }]),
    output: 'setFilterConditions',
    expectedArgs: [[expect.objectContaining({ column: 'id', value: '2', enabled: false })]],
  },
  { name: 'quick WHERE', invoke: a => a.handleApplyQuickWhereCondition(' WHERE id = 1; '), output: 'setQuickWhereCondition', expectedArgs: ['id = 1'] },
  { name: 'clear quick WHERE', invoke: a => a.handleApplyQuickWhereCondition(''), output: 'setQuickWhereCondition', expectedArgs: [''] },
];

const takeRefSnapshot = (input: TestInput) => [
  input.initialLoadRef.current,
  input.skipNextAutoFetchRef.current,
  input.countSeqRef.current,
  input.manualCountSeqRef.current,
  input.duckdbApproxSeqRef.current,
  input.oracleApproxSeqRef.current,
  input.countKeyRef.current,
  input.autoCountKeyRef.current,
  input.manualCountKeyRef.current,
  input.duckdbApproxKeyRef.current,
  input.oracleApproxKeyRef.current,
];

describe('useDataViewerActions protects pending edits before changing queries', () => {
  let renderer: ReactTestRenderer | null;
  let actions: DataViewerActionsApi;
  let unregister: (() => void) | undefined;
  let input: TestInput;

  function Harness({ params }: { params: UseDataViewerActionsInput }) {
    actions = useDataViewerActions(params);
    return null;
  }

  const mount = async () => {
    await act(async () => { renderer = create(<Harness params={input} />); });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    renderer = null;
    unregister = undefined;
    input = createInput();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    unregister?.();
  });

  it.each(queryActions)('blocks $name without changing query state or dropping pending edits', async (action) => {
    const guard = { isDirty: () => true, save: vi.fn(async () => false), discard: vi.fn() };
    unregister = registerWorkbenchTabCloseGuard(input.tab.id, guard);
    await mount();
    const previousRefs = takeRefSnapshot(input);
    await act(async () => { await action.invoke(actions); });
    expect(input.fetchData).not.toHaveBeenCalled();
    expect(input.setPagination).not.toHaveBeenCalled();
    expect(input.setSortInfo).not.toHaveBeenCalled();
    expect(input.setFilterConditions).not.toHaveBeenCalled();
    expect(input.setQuickWhereCondition).not.toHaveBeenCalled();
    expect(takeRefSnapshot(input)).toEqual(previousRefs);
    expect(guard.save).not.toHaveBeenCalled();
    expect(guard.discard).not.toHaveBeenCalled();
    expect(messageApi.warning).toHaveBeenCalledWith(expect.objectContaining({
      content: 'data_grid.message.query_change_with_pending_edits',
    }));
  });

  it.each(queryActions)('allows $name without pending edits', async (action) => {
    await mount();
    await act(async () => { await action.invoke(actions); });

    expect(input[action.output]).toHaveBeenCalledExactlyOnceWith(...action.expectedArgs);
    expect(messageApi.warning).not.toHaveBeenCalled();
  });

  it.each(queryActions)('allows $name again after the user rolls back pending edits', async (action) => {
    let dirty = true;
    const guard = {
      isDirty: () => dirty,
      save: vi.fn(async () => false),
      discard: vi.fn(() => { dirty = false; }),
    };
    unregister = registerWorkbenchTabCloseGuard(input.tab.id, guard);
    await mount();
    await act(async () => { await action.invoke(actions); });
    expect(input[action.output]).not.toHaveBeenCalled();
    expect(dirty).toBe(true);

    guard.discard();
    messageApi.warning.mockClear();
    await act(async () => { await action.invoke(actions); });
    expect(input[action.output]).toHaveBeenCalledExactlyOnceWith(...action.expectedArgs);
    expect(messageApi.warning).not.toHaveBeenCalled();
  });

  it('validates quick WHERE before checking pending edits', async () => {
    unregister = registerWorkbenchTabCloseGuard(input.tab.id, {
      isDirty: () => true, save: vi.fn(async () => false), discard: vi.fn(),
    });
    await mount();
    await act(async () => { actions.handleApplyQuickWhereCondition('id = 1; DELETE FROM users'); });

    expect(messageApi.error).toHaveBeenCalledOnce();
    expect(messageApi.warning).not.toHaveBeenCalled();
    expect(input.setQuickWhereCondition).not.toHaveBeenCalled();
    expect(input.setPagination).not.toHaveBeenCalled();
  });

  it('keeps showing or hiding the filter panel available while edits are pending', async () => {
    unregister = registerWorkbenchTabCloseGuard(input.tab.id, {
      isDirty: () => true, save: vi.fn(async () => false), discard: vi.fn(),
    });
    await mount();
    act(() => { actions.handleToggleFilter(); });

    expect(input.setShowFilter).toHaveBeenCalledOnce();
    expect(input.fetchData).not.toHaveBeenCalled();
    expect(messageApi.warning).not.toHaveBeenCalled();
  });

  it('uses the current tab when callbacks are reused across tab changes', async () => {
    unregister = registerWorkbenchTabCloseGuard(input.tab.id, {
      isDirty: () => true, save: vi.fn(async () => false), discard: vi.fn(),
    });
    await mount();
    input.tab = { ...input.tab, id: 'other-tab' };
    await act(async () => { renderer!.update(<Harness params={input} />); });
    await act(async () => { actions.handleApplyFilter([]); actions.handleSort('', ''); });

    expect(input.setFilterConditions).toHaveBeenCalledWith([]);
    expect(input.setSortInfo).toHaveBeenCalledWith([]);
    expect(messageApi.warning).not.toHaveBeenCalled();
  });
});
