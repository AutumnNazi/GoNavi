import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QueryEditorResultsPanel, { type QueryEditorResultSet } from './QueryEditorResultsPanel';
import type { QueryResultPaginationState } from '../utils/queryResultPagination';

// Behavioural replacement for the previous source-text guard: render the results
// panel and observe the props it hands to each grid, plus whether the compact
// execution banner is mounted. That exercises the real code path instead of
// asserting that a particular line of the component still reads a certain way.

const gridProps = new Map<string, { loading: boolean }>();
const compactStatusRenders: number[] = [];

vi.mock('./DataGrid', () => ({
  default: (props: any) => {
    const label = String(props.resultSql || 'unknown');
    gridProps.set(label, { loading: props.loading === true });
    return React.createElement('div', { 'data-grid': 'true', 'data-sql': label });
  },
  GONAVI_ROW_KEY: '__gonavi_row_key__',
}));

vi.mock('./queryEditor/QueryEditorExecutionStatus', () => ({
  QueryEditorExecutionStatus: (props: any) => {
    if (props.compact) compactStatusRenders.push(1);
    return React.createElement('div', { 'data-execution-status': String(props.compact) });
  },
}));

vi.mock('./resultDiff/ResultDiffWizard', () => ({ default: () => null }));
vi.mock('./resultDiff/ViewDataVerifyWizard', () => ({ default: () => null }));
vi.mock('./LogPanel', () => ({ default: () => React.createElement('div', { 'data-log-panel': 'true' }) }));
vi.mock('./DetachDragPreview', () => ({
  default: () => null,
  buildDetachDragPreviewState: () => null,
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<any>('antd');
  return {
    ...actual,
    Tabs: ({ items, activeKey }: any) => (
      <div data-tabs="true" data-active-key={activeKey}>
        {(items || []).map((item: any) => (
          <div key={item.key} data-pane={item.key}>{item.children}</div>
        ))}
      </div>
    ),
    Dropdown: ({ children }: any) => <div>{children}</div>,
    Tooltip: ({ children }: any) => <div>{children}</div>,
    Segmented: () => null,
    Button: () => null,
    Tag: () => null,
    message: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

const buildResultSet = (
  key: string,
  sql: string,
  page?: Partial<QueryResultPaginationState> & { loading?: boolean },
): QueryEditorResultSet => ({
  key,
  sql,
  rows: [{ a: 1 }],
  columns: ['a'],
  resultType: 'grid' as const,
  readOnly: true,
  pkColumns: [],
  page: page ? {
    current: 1,
    pageSize: 100,
    total: 1,
    baseSql: sql,
    ...page,
  } : undefined,
});

const buildProps = (overrides: Record<string, unknown> = {}) => ({
  resultSets: [buildResultSet('r1', 'SELECT 1')],
  activeResultKey: 'r1',
  sqlLogs: [],
  loading: false,
  executionError: '',
  sqlLogCount: 0,
  maxRows: 5000,
  toggleShortcutLabel: '',
  onActiveResultKeyChange: vi.fn(),
  onHide: vi.fn(),
  onCloseResult: vi.fn(),
  onCloseOtherResultTabs: vi.fn(),
  onCloseResultTabsToLeft: vi.fn(),
  onCloseResultTabsToRight: vi.fn(),
  onCloseAllResultTabs: vi.fn(),
  onResultPinnedChange: vi.fn(),
  onOpenResultInWindow: vi.fn(),
  onReloadResult: vi.fn(),
  onResultPageChange: vi.fn(),
  onResultSort: vi.fn(),
  onRequestResultTotalCount: vi.fn(),
  onCancelResultTotalCount: vi.fn(),
  onDiagnoseExecutionError: vi.fn(),
  onCompareResult: vi.fn(),
  isActive: true,
  darkMode: false,
  currentDb: 'demo',
  currentConnectionId: 'conn-1',
  workbenchTabId: 'tab-1',
  ...overrides,
});

describe('QueryEditorResultTabContent loading updates', () => {
  let tree: ReturnType<typeof create> | null = null;

  afterEach(() => {
    act(() => tree?.unmount());
    tree = null;
    gridProps.clear();
    compactStatusRenders.length = 0;
  });

  it('keeps an existing result grid stable while another query runs', async () => {
    await act(async () => {
      tree = create(<QueryEditorResultsPanel {...buildProps({ loading: false })} />);
    });
    expect(gridProps.get('SELECT 1')).toEqual({ loading: false });

    // A second run starts while the previous result is still on screen.
    await act(async () => {
      tree?.update(<QueryEditorResultsPanel {...buildProps({ loading: true })} />);
    });

    // The visible grid must not be pushed back into its loading state, and the
    // compact banner above the tabs must not appear for an existing result.
    expect(gridProps.get('SELECT 1')).toEqual({ loading: false });
    expect(compactStatusRenders).toEqual([]);
  });

  it('shows the loading skeleton only for the result set that is paging itself', async () => {
    await act(async () => {
      tree = create(<QueryEditorResultsPanel {...buildProps({
        resultSets: [
          buildResultSet('r1', 'SELECT 1'),
          buildResultSet('r2', 'SELECT 2', { loading: true }),
        ],
        // The editor-level flag stays false: only the paging result is loading.
        loading: false,
      })} />);
    });

    expect(gridProps.get('SELECT 1')).toEqual({ loading: false });
    expect(gridProps.get('SELECT 2')).toEqual({ loading: true });
  });
});
