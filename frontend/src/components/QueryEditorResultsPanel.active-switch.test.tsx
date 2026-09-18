import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// Switching the active result must not re-render grids whose contents did not
// change. Before the memoized extraction, all three mounted grids re-rendered.
const renderCounts = new Map<string, number>();

vi.mock('./DataGrid', () => ({
  default: (props: any) => {
    const label = String(props.resultSql || 'unknown');
    renderCounts.set(label, (renderCounts.get(label) || 0) + 1);
    return React.createElement('div', {
      'data-grid': 'true',
      'data-sql': label,
      'data-active': String(props.isActive),
    });
  },
  GONAVI_ROW_KEY: '__gonavi_row_key__',
}));

vi.mock('./resultDiff/ResultDiffWizard', () => ({ default: () => null }));
vi.mock('./resultDiff/ViewDataVerifyWizard', () => ({ default: () => null }));
vi.mock('./LogPanel', () => ({
  default: () => React.createElement('div', { 'data-log-panel': 'true' }),
}));
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

const buildResultSet = (key: string, sql: string) => ({
  key,
  sql,
  rows: [{ a: 1 }],
  columns: ['a'],
  resultType: 'grid' as const,
  readOnly: true,
  pkColumns: [],
});

describe('result set switching re-render cost', () => {
  it('only re-renders the grids whose active state changed', async () => {
    const { default: QueryEditorResultsPanel } = await import('./QueryEditorResultsPanel');

    const baseProps: any = {
      resultSets: [
        buildResultSet('r1', 'SELECT 1'),
        buildResultSet('r2', 'SELECT 2'),
        buildResultSet('r3', 'SELECT 3'),
      ],
      activeResultKey: 'r1',
      sqlLogs: [],
      loading: false,
      executionLifecycle: { status: 'idle' },
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
    };

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<QueryEditorResultsPanel {...baseProps} />);
    });

    renderCounts.clear();

    await act(async () => {
      tree.update(<QueryEditorResultsPanel {...baseProps} activeResultKey="r2" />);
    });

    const renderedSql = Array.from(renderCounts.keys()).sort();
    // Only the two grids whose `isActive` flipped should have re-rendered.
    expect(renderedSql).toEqual(['SELECT 1', 'SELECT 2']);
    expect(renderCounts.has('SELECT 3')).toBe(false);
  });
});
