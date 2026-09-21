import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import DataGrid from './DataGrid';
import { I18nProvider } from '../i18n/provider';
import { type LanguagePreference } from '../i18n';
import { cloneShortcutOptions, DEFAULT_SHORTCUT_OPTIONS } from '../utils/shortcuts';

/**
 * Issue #1302 end-to-end wiring guard.
 *
 * The highlight verdict itself is unit-tested in dataGridFilterActivity.test.ts, and the
 * button's rendering in DataGridToolbarFrame.test.tsx. What neither covers is the hop in
 * between: DataGrid -> DataGridShell -> DataGridToolbarFrame. DataGridShell declares
 * `type DataGridShellProps = Record<string, any>` (DataGridShell.tsx:25), so a dropped or
 * misspelled prop name is silently accepted by TypeScript and only shows up as the entry
 * never lighting up. These cases drive the real DataGrid with an applied filter and assert
 * the toolbar markup, which is the only thing that fails when that hop breaks.
 */

vi.mock('../store', () => ({
  useStore: (selector: (state: any) => any) => selector({
    connections: [],
    addSqlLog: vi.fn(),
    theme: 'light',
    appearance: {
      enabled: true,
      opacity: 1,
      blur: 0,
      showDataTableVerticalBorders: false,
      showDataTableRowNumber: true,
      dataTableDensity: 'comfortable',
    },
    setAppearance: vi.fn(),
    queryOptions: {
      showColumnComment: false,
      showColumnType: false,
    },
    setQueryOptions: vi.fn(),
    dataEditTransactionOptions: {
      commitMode: 'manual',
      autoCommitDelayMs: 5000,
    },
    setDataEditTransactionOptions: vi.fn(),
    addTab: vi.fn(),
    setActiveContext: vi.fn(),
    tableColumnOrders: {},
    tablePinnedLeftColumns: {},
    enableColumnOrderMemory: false,
    setTableColumnOrder: vi.fn(),
    setEnableColumnOrderMemory: vi.fn(),
    clearTableColumnOrder: vi.fn(),
    tableHiddenColumns: {},
    enableHiddenColumnMemory: false,
    setTableHiddenColumns: vi.fn(),
    setEnableHiddenColumnMemory: vi.fn(),
    clearTableHiddenColumns: vi.fn(),
    shortcutOptions: cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS),
    languagePreference: 'zh-CN' as LanguagePreference,
    aiPanelVisible: false,
    setAIPanelVisible: vi.fn(),
  }),
}));

vi.mock('../../wailsjs/go/app/App', () => ({
  ImportData: vi.fn(),
  PreviewImportFileWithOptions: vi.fn(),
  CancelImportJob: vi.fn(),
  ExportTable: vi.fn(),
  ExportData: vi.fn(),
  ExportQuery: vi.fn(),
  ApplyChanges: vi.fn(),
  DBGetColumns: vi.fn(),
  DBGetIndexes: vi.fn(),
  DBGetForeignKeys: vi.fn(),
  DBShowCreateTable: vi.fn(),
}));

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string }) => <pre data-monaco-editor="true">{props.value ?? ''}</pre>,
}));

const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
  callback(0);
  return 1;
});
vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
vi.stubGlobal('cancelAnimationFrame', vi.fn());
vi.stubGlobal('window', {
  requestAnimationFrame: requestAnimationFrameMock,
  cancelAnimationFrame: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

const renderDataGrid = (element: React.ReactElement) => renderToStaticMarkup(
  <I18nProvider preference="zh-CN" systemLanguages={['zh-CN']} onPreferenceChange={() => {}}>
    {element}
  </I18nProvider>,
);

const baseProps = {
  data: [{ __gonavi_row_key__: 'row-1', id: 1, code: '3551' }],
  columnNames: ['id', 'code'],
  loading: false,
  tableName: 'users',
  dbName: 'main',
  connectionId: 'conn-1',
  readOnly: true,
  pagination: { current: 1, pageSize: 100, total: 1 },
  onPageChange: () => {},
  onToggleFilter: () => {},
};

/**
 * Extracts the filter entry button's opening tag. `data-grid-action="filter"` is unique to
 * it, so this cannot accidentally match another toolbar action.
 */
const extractFilterButtonTag = (markup: string): string => {
  const match = markup.match(/<button(?=[^>]*data-grid-action="filter")[^>]*>/);
  expect(match, 'toolbar filter entry button was not rendered').not.toBeNull();
  return match?.[0] ?? '';
};

describe('DataGrid filter entry highlight end-to-end (issue #1302)', () => {
  it('lights the toolbar entry when an applied filter reaches it through the shell', () => {
    const markup = renderDataGrid(
      <DataGrid
        {...baseProps}
        showFilter={false}
        appliedFilterConditions={[{ id: 1, enabled: true, column: 'code', op: '=', value: '3551' }]}
      />,
    );

    const tag = extractFilterButtonTag(markup);
    expect(tag).toContain('aria-pressed="true"');
    expect(tag).not.toContain('ant-btn-default');
  });

  it('leaves the toolbar entry unlit when nothing is applied', () => {
    const markup = renderDataGrid(
      <DataGrid {...baseProps} showFilter={false} appliedFilterConditions={[]} />,
    );

    expect(extractFilterButtonTag(markup)).toContain('aria-pressed="false"');
  });

  it('does not light the entry for the blank condition injected by opening the panel', () => {
    const markup = renderDataGrid(
      <DataGrid
        {...baseProps}
        showFilter
        appliedFilterConditions={[{ id: 1, enabled: true, column: 'code', op: '=', value: '', value2: '' }]}
      />,
    );

    expect(extractFilterButtonTag(markup)).toContain('aria-pressed="false"');
  });

  it('lights the entry from a quick-where condition alone', () => {
    const markup = renderDataGrid(
      <DataGrid
        {...baseProps}
        showFilter={false}
        appliedFilterConditions={[]}
        quickWhereCondition="code = '3551'"
      />,
    );

    expect(extractFilterButtonTag(markup)).toContain('aria-pressed="true"');
  });

  it('leaves the entry unlit when every applied condition is disabled', () => {
    const markup = renderDataGrid(
      <DataGrid
        {...baseProps}
        showFilter={false}
        appliedFilterConditions={[{ id: 1, enabled: false, column: 'code', op: '=', value: '3551' }]}
      />,
    );

    expect(extractFilterButtonTag(markup)).toContain('aria-pressed="false"');
  });
});
