/** @vitest-environment jsdom */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QueryEditorResultGrid from './QueryEditorResultGrid';
import type { QueryEditorResultSet } from './QueryEditorResultsPanel';
import { flushQueryEditorResultViewState } from './queryEditor/queryEditorResultViewStateEvents';

const dataGridProps = vi.hoisted(() => ({ current: null as any }));

vi.mock('../utils/globalHiddenColumns', () => ({
  filterColumnNamesByGlobalHiddenColumns: (columns: string[]) => columns,
  useGlobalHiddenColumns: () => [],
}));

vi.mock('../utils/queryResultColumnPinScope', () => ({
  buildQueryResultColumnPinScope: () => 'query-result:test',
}));

vi.mock('./DataGrid', () => ({
  default: (props: any) => {
    dataGridProps.current = props;
    return <div data-query-result-grid="true" />;
  },
}));

describe('QueryEditorResultGrid', () => {
  afterEach(() => vi.useRealTimers());

  it('restores and reports lightweight result view state', () => {
    vi.useFakeTimers();
    const onResultViewStateChange = vi.fn();
    const result: QueryEditorResultSet = {
      key: 'result-1',
      sql: 'select id, name from users',
      rows: [{ id: 1, name: 'Ada' }],
      columns: ['id', 'name'],
      pkColumns: ['id'],
      readOnly: true,
      filterConditions: [{ id: 1, column: 'name', op: '=', value: 'Ada', enabled: true, logic: 'AND' }],
      quickWhereCondition: 'id > 0',
      selectedRowKeys: [1],
      selectedCellKeys: ['0\u0000name'],
      scrollSnapshot: { top: 120, left: 48 },
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <QueryEditorResultGrid
          result={result}
          workbenchTabId="query-1"
          isActive
          loading={false}
          currentDb="main"
          currentConnectionId="conn-1"
          onReloadResult={vi.fn()}
          onResultPageChange={vi.fn()}
          onResultSort={vi.fn()}
          onResultViewStateChange={onResultViewStateChange}
        />,
      );
    });

    expect(dataGridProps.current.appliedFilterConditions).toEqual(result.filterConditions);
    expect(dataGridProps.current.quickWhereCondition).toBe('id > 0');
    expect(dataGridProps.current.scrollSnapshot).toEqual({ top: 120, left: 48 });
    expect(dataGridProps.current.sessionState.selectedRowKeys).toEqual([1]);
    expect(dataGridProps.current.sessionState.selectedCellKeys).toEqual(['0\u0000name']);

    act(() => {
      dataGridProps.current.onApplyFilter([{ id: 2, column: 'id', op: '>', value: '10' }]);
      dataGridProps.current.onApplyQuickWhereCondition('name is not null');
      dataGridProps.current.onScrollSnapshotChange({ top: 200, left: 64 });
      flushQueryEditorResultViewState('query-1');
      dataGridProps.current.sessionState.onSelectedRowKeysChange([2]);
      dataGridProps.current.sessionState.onSelectedCellKeysChange(['1\u0000id']);
      flushQueryEditorResultViewState('query-1');
      dataGridProps.current.sessionState.onPendingChangesChange(true);
    });

    expect(onResultViewStateChange.mock.calls).toEqual([
      ['result-1', { filterConditions: [{ id: 2, column: 'id', op: '>', value: '10' }] }],
      ['result-1', { quickWhereCondition: 'name is not null' }],
      ['result-1', { scrollSnapshot: { top: 200, left: 64 } }],
      ['result-1', { selectedRowKeys: [2] }],
      ['result-1', { selectedCellKeys: ['1\u0000id'] }],
      ['result-1', { hasPendingChanges: true }],
    ]);
    renderer.unmount();
  });

  it('keeps the Elasticsearch result grid read-only without query-table actions', () => {
    const result: QueryEditorResultSet = {
      key: 'result-es',
      sql: 'GET /orders/_search',
      exportSql: 'POST /orders/_search',
      rows: [{ _id: '1' }],
      columns: ['_id'],
      pkColumns: ['_id'],
      readOnly: false,
      tableName: 'orders',
      executionConnectionId: 'conn-executed',
      executionDbName: 'executed-db',
      executionConnectionParams: 'search_path=archive',
      page: {
        current: 2,
        pageSize: 50,
        total: 100,
        baseSql: 'GET /orders/_search',
      },
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <QueryEditorResultGrid
          result={result}
          variant="elasticsearch"
          isActive
          loading={false}
          currentDb="current-db"
          currentConnectionId="conn-current"
          maxRows={5000}
          dataPreviewRequest={{ resultKey: result.key, requestId: 'preview-1' }}
          onReloadResult={vi.fn()}
          onResultPageChange={vi.fn()}
          onResultSort={vi.fn()}
          onRequestResultTotalCount={vi.fn()}
          onCancelResultTotalCount={vi.fn()}
        />,
      );
    });

    expect(dataGridProps.current).toMatchObject({
      tableName: undefined,
      resultSql: result.sql,
      resultExportAllSql: undefined,
      dbName: 'current-db',
      connectionId: 'conn-current',
      connectionParamsOverride: undefined,
      queryMaxRows: undefined,
      initialViewMode: undefined,
      initialViewModeRequestId: undefined,
      initialViewModeScope: undefined,
      pkColumns: [],
      editLocator: undefined,
      onReload: undefined,
      pagination: undefined,
      onPageChange: undefined,
      onSort: undefined,
      sortInfoExternal: undefined,
      onRequestTotalCount: undefined,
      onCancelTotalCount: undefined,
      readOnly: true,
    });
    renderer.unmount();
  });
});
