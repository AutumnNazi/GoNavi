import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readV2ThemeCss } from '../test/readV2ThemeCss';

import DataGrid, {
  buildGridFieldSelectOptions,
  formatCellDisplayText,
  resolveContextMenuFieldName,
  resolveDefaultGridFilterOperator,
  resolveNextGridFilterOperatorForColumnChange,
} from './DataGrid';
import DataGridPageFind from './DataGridPageFind';
import DataGridPaginationBar from './DataGridPaginationBar';
import DataGridPreviewPanel from './DataGridPreviewPanel';
import { DataGridJsonView, DataGridTextView } from './DataGridRecordViews';
import DataGridResultViewSwitcher from './DataGridResultViewSwitcher';
import DataGridSecondaryActions from './DataGridSecondaryActions';
import { DataGridV2DdlSideWorkspace, DataGridV2DdlView } from './DataGridV2DdlWorkspace';
import { DataGridV2ErView, DataGridV2FieldsView } from './DataGridV2MetadataViews';
import { I18nProvider } from '../i18n/provider';
import { getCurrentLanguage, setCurrentLanguage, type LanguagePreference } from '../i18n';
import { V2CellContextMenuView } from './V2TableContextMenu';
import { cloneShortcutOptions, DEFAULT_SHORTCUT_OPTIONS } from '../utils/shortcuts';

const readDataGridSource = () => [
  './useDataGridBatchActions.ts',
  './DataGrid.tsx',
  './useDataGridV2Actions.ts',
  './useDataGridMetadata.ts',
  './useDataGridColumnResize.ts',
  './dataGridStyles.ts',
  './DataGridCore.tsx',
  './DataGridShell.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const readDataViewerSource = (): string =>
  readFileSync(new URL('./DataViewer.tsx', import.meta.url), 'utf8');
const readDataGridSecondaryActionsSource = (): string =>
  readFileSync(new URL('./DataGridSecondaryActions.tsx', import.meta.url), 'utf8');
const readDataGridShellSource = (): string =>
  readFileSync(new URL('./DataGridShell.tsx', import.meta.url), 'utf8');
const readQueryEditorSource = (): string =>
  readFileSync(new URL('./QueryEditor.tsx', import.meta.url), 'utf8');

const mockStoreState = vi.hoisted(() => ({
  languagePreference: 'system' as LanguagePreference,
  uiVersion: 'v2',
}));

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
      uiVersion: mockStoreState.uiVersion,
    },
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
    languagePreference: mockStoreState.languagePreference,
    aiPanelVisible: false,
    setAIPanelVisible: vi.fn(),
  }),
}));

vi.mock('../../wailsjs/go/app/App', () => ({
  ImportData: vi.fn(),
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
  default: (props: { value?: string }) => (
    <pre data-monaco-editor="true">{props.value ?? ''}</pre>
  ),
}));

const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
  callback(0);
  return 1;
});
const cancelAnimationFrameMock = vi.fn();

vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
vi.stubGlobal('window', {
  requestAnimationFrame: requestAnimationFrameMock,
  cancelAnimationFrame: cancelAnimationFrameMock,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

const renderDataGridWithI18n = (
  element: React.ReactElement,
  options: { preference?: LanguagePreference; systemLanguages?: readonly string[] } = {},
) => {
  const preference = options.preference ?? mockStoreState.languagePreference;
  return renderToStaticMarkup(
    <I18nProvider
      preference={preference}
      systemLanguages={options.systemLanguages ?? ['zh-CN']}
      onPreferenceChange={() => {}}
    >
      {element}
    </I18nProvider>,
  );
};

const zhCnCatalog = JSON.parse(
  readFileSync(new URL('../../../shared/i18n/zh-CN.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const enUsCatalog = JSON.parse(
  readFileSync(new URL('../../../shared/i18n/en-US.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const zhObjectDesignLabel = zhCnCatalog['data_grid.secondary.object_design'];
const enUndoCellChangeLabel = enUsCatalog['data_grid.context_menu.undo_cell_change'];

describe('DataGrid layout', () => {
  it('renders without navigator in server-side environments', () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'navigator');

    try {
      expect(() => renderDataGridWithI18n(
        <DataGrid
          data={[]}
          columnNames={[]}
          loading={false}
          tableName="users"
          dbName="main"
          connectionId="conn-1"
          readOnly
          pagination={{
            current: 1,
            pageSize: 100,
            total: 0,
          }}
          onPageChange={() => {}}
        />,
      )).not.toThrow();
    } finally {
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'navigator');
      }
    }
  });

  it('renders a secondary action strip for view switching and auxiliary actions', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        dbName="main"
        connectionId="conn-1"
        readOnly
        pagination={{
          current: 1,
          pageSize: 100,
          total: 1,
        }}
        onPageChange={() => {}}
      />,
    );

    expect(markup).toContain('data-grid-secondary-actions="true"');
    expect(markup).toContain('data-grid-view-switcher="true"');
    expect(markup).toContain('data-grid-column-display-action="true"');
    expect(markup).toContain('data-grid-column-quick-find-action="true"');
    expect(markup).toContain('字段显示');
    expect(markup).toContain('跳列');
    expect(markup).toContain('日志');
    expect(markup).toContain(zhObjectDesignLabel);
    expect(markup).not.toContain('data-grid-page-find="true"');
    expect(markup).not.toContain('data-grid-page-find-prev="true"');
    expect(markup).not.toContain('data-grid-page-find-next="true"');
    expect(markup).toContain('gn-v2-data-grid-status-main');
    expect(markup).toContain('gn-v2-data-grid-status-right');
    expect(markup).toContain('data-grid-v2-pagination="true"');
    expect(markup).toContain('data-grid-v2-page-chip="true"');
    expect(markup).toContain('data-grid-v2-pagination-first="true"');
    expect(markup).toContain('data-grid-v2-pagination-prev="true"');
    expect(markup).toContain('data-grid-v2-pagination-next="true"');
    expect(markup).toContain('data-grid-v2-pagination-last="true"');
    expect(markup).toContain('data-grid-pagination-jump="true"');
    expect(markup).toContain('跳页');
    expect(markup).toContain('跳转页码');
    expect(markup).not.toContain('class="ant-pagination');
    expect(markup).not.toContain('class="data-grid-pagination-kicker"');
    expect(markup).not.toContain('当前页查找...');
  });

  it('opens the embedded SQL log view from the shared V2 SQL log event in table data tabs', () => {
    const source = readDataGridSource();
    const dataViewerSource = readDataViewerSource();
    const secondaryActionsSource = readDataGridSecondaryActionsSource();
    const shellSource = readDataGridShellSource();

    expect(dataViewerSource).toContain('isActive={isActive}');
    expect(dataViewerSource).toContain('enableSqlLogEvent');
    expect(source).toContain("isActive = true");
    expect(source).toContain("enableSqlLogEvent = false");
    expect(source).toContain("'gonavi:show-sql-execution-log'");
    expect(source).toContain("if (!enableSqlLogEvent || !isV2Ui || !isActive) return;");
    expect(source).toContain("handleViewModeChange('sqlLog');");
    expect(source).toContain("'sqlLog'");
    expect(shellSource).toContain('import LogPanel from');
    expect(shellSource).toContain("viewMode === 'sqlLog'");
    expect(shellSource).toContain('<LogPanel variant="embedded" />');
    expect(secondaryActionsSource).toContain("key: 'sqlLog'");
    expect(secondaryActionsSource).toContain("translate('log_panel.short_title')");
  });

  it('localizes DataGrid error boundary, column drag affordances, and legacy row context menu labels through i18n keys', () => {
    const source = readDataGridSource();
    const expectedKeys = [
      'data_grid.error_boundary.title',
      'data_grid.error_boundary.description',
      'data_grid.error_boundary.retry',
      'data_grid.column.resize_tooltip',
      'data_grid.column.drag_tooltip',
      'data_grid.context_menu.copy_as_insert',
      'data_grid.context_menu.copy_as_update',
      'data_grid.context_menu.copy_as_delete',
      'data_grid.context_menu.copy_as_json',
      'data_grid.context_menu.copy_as_csv',
      'data_grid.context_menu.copy_as_markdown',
      'data_grid.context_menu.export_selected',
    ];

    expectedKeys.forEach((key) => {
      expect(source).toMatch(new RegExp(`\\bt\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });

    const legacyRowContextMenuSource = source.slice(
      source.indexOf("const menuItems: MenuProps['items'] = ["),
      source.indexOf('return (', source.indexOf("const menuItems: MenuProps['items'] = [")),
    );
    const expectedLegacyRowMenuLabels = [
      ['insert', 'data_grid.context_menu.copy_as_insert'],
      ['update', 'data_grid.context_menu.copy_as_update'],
      ['delete', 'data_grid.context_menu.copy_as_delete'],
      ['json', 'data_grid.context_menu.copy_as_json'],
      ['csv', 'data_grid.context_menu.copy_as_csv'],
      ['copy', 'data_grid.context_menu.copy_as_markdown'],
      ['export-selected', 'data_grid.context_menu.export_selected'],
    ];

    expectedLegacyRowMenuLabels.forEach(([itemKey, i18nKey]) => {
      expect(legacyRowContextMenuSource).toMatch(new RegExp(
        `key:\\s*['"]${itemKey}['"][\\s\\S]*?label:\\s*t\\(\\s*['"]${i18nKey.replace(/\./g, '\\.')}['"]\\s*\\)`,
      ));
    });

    [
      ['exp-csv', 'CSV'],
      ['exp-xlsx', 'Excel'],
      ['exp-json', 'JSON'],
      ['exp-md', 'Markdown'],
      ['exp-html', 'HTML'],
    ].forEach(([itemKey, rawLabel]) => {
      expect(legacyRowContextMenuSource).toMatch(new RegExp(
        `key:\\s*['"]${itemKey}['"][\\s\\S]*?label:\\s*['"]${rawLabel}['"]`,
      ));
    });
    expect(source).not.toMatch(/<h4>\s*渲染错误\s*<\/h4>/);
    expect(source).not.toMatch(/<p>\s*数据表格渲染时发生错误，可能是数据格式问题。\s*<\/p>/);
    expect(source).not.toMatch(/>\s*重试\s*<\/Button>/);
    expect(source).not.toContain('title="拖动调整列宽，双击按内容自适应"');
    expect(source).not.toContain('title="拖拽以调整列顺序"');
    expect(source).not.toMatch(/label:\s*['"]复制为 INSERT['"]/);
    expect(source).not.toMatch(/label:\s*['"]复制为 UPDATE['"]/);
    expect(source).not.toMatch(/label:\s*['"]复制为 DELETE['"]/);
    expect(source).not.toMatch(/label:\s*['"]复制为 JSON['"]/);
    expect(source).not.toMatch(/label:\s*['"]复制为 CSV['"]/);
    expect(source).not.toMatch(/label:\s*['"]复制为 Markdown['"]/);
    expect(source).not.toMatch(/label:\s*['"]导出选中数据['"]/);
  });

  it('localizes legacy cell context menu labels through translateDataGrid', () => {
    const dataGridSource = readDataGridSource();
    const legacyMenuSource = readFileSync(new URL('./DataGridLegacyCellContextMenu.tsx', import.meta.url), 'utf8');
    const legacyMountStart = dataGridSource.indexOf('<DataGridLegacyCellContextMenu');
    const legacyMountSource = dataGridSource.slice(
      legacyMountStart,
      dataGridSource.indexOf('/>', legacyMountStart),
    );
    const expectedKeys = [
      'data_grid.context_menu.copy_field_name',
      'data_grid.batch_fill.set_null',
      'data_grid.context_menu.edit_row',
      'data_grid.context_menu.copy_row_as_new',
      'data_grid.context_menu.paste_row_as_new',
      'data_grid.context_menu.paste_row_as_new_count',
      'data_grid.context_menu.fill_to_selected_rows',
      'data_grid.context_menu.paste_copied_columns',
      'data_grid.context_menu.copy_row_data',
      'data_grid.context_menu.copy_as_insert',
      'data_grid.context_menu.copy_as_update',
      'data_grid.context_menu.copy_as_delete',
      'data_grid.context_menu.copy_as_json',
      'data_grid.context_menu.copy_as_csv',
      'data_grid.context_menu.copy_as_markdown',
      'data_grid.context_menu.export_as_csv',
      'data_grid.context_menu.export_as_excel',
      'data_grid.context_menu.export_as_json',
      'data_grid.context_menu.export_as_html',
    ];

    expect(legacyMountStart).toBeGreaterThanOrEqual(0);
    expect(legacyMountSource).toContain('translate={translateDataGrid}');
    expect(legacyMenuSource).toContain('translate?: (key: string, params?: Record<string, unknown>) => string');
    expectedKeys.forEach((key) => {
      expect(legacyMenuSource).toContain(`translate('${key}'`);
    });
    expect(legacyMenuSource).toMatch(
      /translate\(\s*'data_grid\.context_menu\.paste_row_as_new_count'\s*,\s*\{\s*count:\s*copiedRowsForPasteLength\s*\}\s*\)/,
    );
    expect(legacyMenuSource).toMatch(
      /translate\(\s*'data_grid\.context_menu\.fill_to_selected_rows'\s*,\s*\{\s*count:\s*selectedRowKeysLength\s*\}\s*\)/,
    );
    [
      '复制字段名称',
      '设置为 NULL',
      '编辑本行',
      '复制本行为新增行',
      '粘贴为新增行',
      '填充到选中行',
      '粘贴已复制列',
      '复制行数据',
      '复制为 INSERT',
      '复制为 UPDATE',
      '复制为 DELETE',
      '复制为 JSON',
      '复制为 CSV',
      '复制为 Markdown',
      '导出为 CSV',
      '导出为 Excel',
      '导出为 JSON',
      '导出为 HTML',
    ].forEach((literal) => {
      expect(legacyMenuSource).not.toContain(literal);
    });
  });

  it('localizes row copy and paste feedback through DataGrid i18n keys', () => {
    const source = readDataGridSource();
    const rowCopyPasteFeedbackKeys = [
      'data_grid.message.select_rows_to_copy',
      'data_grid.message.copied_rows',
      'data_grid.message.copy_rows_first',
      'data_grid.message.no_pasteable_rows',
      'data_grid.message.pasted_rows_as_new',
    ];

    rowCopyPasteFeedbackKeys.forEach((key) => {
      expect(source).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });
    expect(source).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.copied_rows['"]\s*,\s*\{\s*count:\s*copiedRows\.length\s*\}\s*\)/,
    );
    expect(source).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.pasted_rows_as_new['"]\s*,\s*\{\s*count:\s*nextRows\.length\s*\}\s*\)/,
    );

    [
      'zh-CN',
      'zh-TW',
      'en-US',
      'ja-JP',
      'de-DE',
      'ru-RU',
    ].forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      rowCopyPasteFeedbackKeys.forEach((key) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });
    });

    [
      '请先选择要复制的行',
      '已复制 ${copiedRows.length} 行，可粘贴为新增行',
      '请先复制行',
      '没有可粘贴的行',
      '已粘贴 ${nextRows.length} 行为新增行，请检查后提交事务',
    ].forEach((literal) => {
      expect(source).not.toContain(literal);
    });
  });

  it('localizes selected-column copy and paste feedback through DataGrid i18n keys', () => {
    const source = readDataGridSource();
    const columnCopyPasteFeedbackKeys = [
      'data_grid.message.select_same_row_cells_to_copy',
      'data_grid.message.no_copyable_cells',
      'data_grid.message.copy_columns_same_row_only',
      'data_grid.message.no_copyable_columns',
      'data_grid.message.copied_columns',
      'data_grid.message.copy_columns_first',
      'data_grid.message.no_pasteable_editable_fields',
      'data_grid.message.select_target_rows',
      'data_grid.message.target_rows_cannot_only_source',
      'data_grid.message.target_rows_no_update',
      'data_grid.message.pasted_columns_to_rows',
    ];

    columnCopyPasteFeedbackKeys.forEach((key) => {
      expect(source).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });
    expect(source).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.copied_columns['"]\s*,\s*\{\s*count:\s*selectedColumnNames\.length\s*\}\s*\)/,
    );
    expect(source).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.pasted_columns_to_rows['"]\s*,\s*\{\s*rows:\s*patchesByRow\.size\s*,\s*cells:\s*updatedCellCount\s*\}\s*\)/,
    );

    const copyCallbackStart = source.indexOf('const handleCopySelectedColumnsFromRow = useCallback(() => {');
    expect(copyCallbackStart).toBeGreaterThan(-1);
    const pasteCallbackStart = source.indexOf('const handlePasteCopiedColumnsToSelectedRows = useCallback', copyCallbackStart);
    expect(pasteCallbackStart).toBeGreaterThan(copyCallbackStart);
    const batchFillCallbackStart = source.indexOf('const handleBatchFillToSelected = useCallback', pasteCallbackStart);
    expect(batchFillCallbackStart).toBeGreaterThan(pasteCallbackStart);

    const copyCallbackSource = source.slice(copyCallbackStart, pasteCallbackStart);
    const pasteCallbackSource = source.slice(pasteCallbackStart, batchFillCallbackStart);
    const columnCopyPasteCallbackSource = `${copyCallbackSource}\n${pasteCallbackSource}`;
    expect(copyCallbackSource).toMatch(/},\s*\[[\s\S]*translateDataGrid[\s\S]*\]\);/);
    expect(pasteCallbackSource).toMatch(/},\s*\[[\s\S]*translateDataGrid[\s\S]*\]\);/);
    expect(pasteCallbackSource).not.toContain('data_grid.message.no_pasteable_rows');

    [
      'zh-CN',
      'zh-TW',
      'en-US',
      'ja-JP',
      'de-DE',
      'ru-RU',
    ].forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      columnCopyPasteFeedbackKeys.forEach((key) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });
      expect(catalog['data_grid.message.copied_columns']).toContain('{{count}}');
      expect(catalog['data_grid.message.pasted_columns_to_rows']).toContain('{{rows}}');
      expect(catalog['data_grid.message.pasted_columns_to_rows']).toContain('{{cells}}');
    });

    [
      '请先在同一行选中要复制的单元格',
      '未识别到可复制的单元格',
      '复制列值时请只选择同一行的单元格',
      '未识别到可复制的列',
      '已复制 ${selectedColumnNames.length} 列，可粘贴到目标行',
      '请先复制列值',
      '没有可粘贴的可编辑字段',
      '请先选择目标行',
      '目标行不能仅为源行，请选择其他行',
      '目标行无需更新',
      '已粘贴到 ${patchesByRow.size} 行，共 ${updatedCellCount} 个单元格',
    ].forEach((literal) => {
      expect(columnCopyPasteCallbackSource).not.toContain(literal);
    });
  });

  it('localizes commit, preview SQL, and basic copy feedback in the scoped DataGrid windows', () => {
    const source = readDataGridSource();
    const previewCommitCopyStart = source.indexOf('const handlePreviewChanges = useCallback');
    const clipboardRowsStart = source.indexOf('const getClipboardRows = useCallback', previewCommitCopyStart);
    expect(previewCommitCopyStart).toBeGreaterThan(-1);
    expect(clipboardRowsStart).toBeGreaterThan(previewCommitCopyStart);
    const previewCommitCopySource = source.slice(previewCommitCopyStart, clipboardRowsStart);

    [
      'data_grid.message.change_set_build_failed',
      'data_grid.message.change_set_build_failed_detail',
      'data_grid.message.preview_sql_failed',
      'data_grid.message.preview_sql_failed_detail',
      'data_grid.message.commit_failed',
      'data_grid.message.transaction_committed',
      'data_grid.message.no_changes_to_commit',
      'data_grid.message.copied_to_clipboard',
      'data_grid.message.no_field_name',
      'data_grid.message.no_copyable_columns',
      'data_grid.message.keep_one_visible_column',
      'data_grid.message.result_set_no_copyable_content',
    ].forEach((key) => {
      expect(previewCommitCopySource).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });

    expect(previewCommitCopySource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.change_set_build_failed_detail['"]\s*,\s*\{\s*detail:\s*changeSetResult\.error\s*\}\s*\)/,
    );
    expect(previewCommitCopySource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.preview_sql_failed_detail['"]\s*,\s*\{\s*detail:\s*res\.message\s*\}\s*\)/,
    );
    expect(previewCommitCopySource).toMatch(
      /const\s+rawErrorMessage\s*=\s*e\?\.message\s*\|\|\s*String\(e\);[\s\S]*translateDataGrid\(\s*['"]data_grid\.message\.preview_sql_failed_detail['"]\s*,\s*\{\s*detail:\s*rawErrorMessage\s*\}\s*\)/,
    );
    expect(previewCommitCopySource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.commit_failed['"]\s*,\s*\{\s*detail:\s*res\.message\s*\}\s*\)/,
    );

    [
      '无法构建变更集',
      '生成预览 SQL 失败',
      '生成预览 SQL 失败：',
      '没有可提交的变更',
      '事务提交成功',
      '提交失败: ',
      '已复制到剪贴板',
      '未识别到字段名称',
      '未识别到可复制的列',
      '至少保留一个可见字段',
      '当前结果集没有可复制内容',
    ].forEach((literal) => {
      expect(previewCommitCopySource).not.toContain(literal);
    });
  });

  it('localizes Preview SQL Modal chrome while preserving raw SQL text and operation labels', () => {
    const source = readDataGridSource();
    const previewModalStart = source.indexOf('{/* Preview SQL Modal */}');
    const importPreviewStart = source.indexOf('{/* Import Preview Modal */}', previewModalStart);
    expect(previewModalStart).toBeGreaterThan(-1);
    expect(importPreviewStart).toBeGreaterThan(previewModalStart);
    const previewModalSource = source.slice(previewModalStart, importPreviewStart);

    [
      'data_grid.preview_sql.title',
      'data_grid.preview_sql.copied',
      'data_grid.preview_sql.no_changes',
      'data_grid.preview_sql.summary',
    ].forEach((key) => {
      expect(previewModalSource).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });

    expect(previewModalSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.preview_sql\.summary['"]\s*,\s*\{\s*deletes:\s*previewSqlData\.deletes\.length,\s*updates:\s*previewSqlData\.updates\.length,\s*inserts:\s*previewSqlData\.inserts\.length\s*\}\s*\)/,
    );
    expect(previewModalSource.match(/navigator\.clipboard\.writeText\(sql\)/g)).toHaveLength(3);
    expect(previewModalSource.match(/\{sql\}<\/pre>/g)).toHaveLength(3);
    expect(previewModalSource).toContain('DELETE ({previewSqlData.deletes.length})');
    expect(previewModalSource).toContain('UPDATE ({previewSqlData.updates.length})');
    expect(previewModalSource).toContain('INSERT ({previewSqlData.inserts.length})');

    [
      'title="变更预览"',
      "message.success('已复制')",
      '>无变更</div>',
      '共 {previewSqlData.deletes.length} 条 DELETE',
    ].forEach((literal) => {
      expect(previewModalSource).not.toContain(literal);
    });
  });

  it('localizes query-result, selected-cell, copy-SQL, and current-row copy feedback', () => {
    const source = readDataGridSource();
    const copyFeedbackStart = source.indexOf('const getClipboardRows = useCallback');
    const copyFeedbackEnd = source.indexOf('const buildConnConfig = useCallback', copyFeedbackStart);
    expect(copyFeedbackStart).toBeGreaterThan(-1);
    expect(copyFeedbackEnd).toBeGreaterThan(copyFeedbackStart);
    const copyFeedbackSource = source.slice(copyFeedbackStart, copyFeedbackEnd);

    [
      'data_grid.message.result_set_no_copyable_content',
      'data_grid.message.drag_select_cells_to_copy',
      'data_grid.message.no_copyable_cells',
      'data_grid.message.selection_no_copyable_content',
      'data_grid.message.copy_sql_not_supported',
      'data_grid.copy_sql.error.missing_safe_where',
      'data_grid.copy_sql.error.missing_table_name',
      'data_grid.copy_sql.error.no_copyable_fields',
      'data_grid.message.current_row_no_copyable_content',
    ].forEach((key) => {
      expect(copyFeedbackSource).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });

    expect(copyFeedbackSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.copy_sql\.error\.missing_table_name['"]\s*,\s*error\.params\s*\)/,
    );

    [
      '当前结果集没有可复制内容',
      '请先拖选要复制的单元格',
      '未识别到可复制的单元格',
      '当前选区没有可复制内容',
      '当前数据源不支持复制 SQL，请使用 JSON/CSV/Markdown 复制。',
      '当前行没有可复制内容',
    ].forEach((literal) => {
      expect(copyFeedbackSource).not.toContain(literal);
    });
  });

  it('localizes batch fill feedback through DataGrid i18n keys', () => {
    const source = readDataGridSource();
    const batchFillCellsKeys = [
      'data_grid.message.select_cells_to_fill',
      'data_grid.message.selected_cells_no_update',
      'data_grid.message.filled_cells',
    ];
    const batchFillToSelectedKeys = [
      'data_grid.message.current_field_not_editable',
      'data_grid.message.select_rows_to_fill',
      'data_grid.message.no_other_rows_to_fill',
      'data_grid.message.filled_rows',
    ];
    const batchFillFeedbackKeys = [
      ...batchFillCellsKeys,
      ...batchFillToSelectedKeys,
    ];

    const batchFillCellsStart = source.indexOf('const handleBatchFillCells = useCallback(() => {');
    expect(batchFillCellsStart).toBeGreaterThan(-1);
    const batchFillCellsEnd = source.indexOf('  // 事件委托', batchFillCellsStart);
    expect(batchFillCellsEnd).toBeGreaterThan(batchFillCellsStart);
    const batchFillCellsSource = source.slice(batchFillCellsStart, batchFillCellsEnd);

    const batchFillToSelectedStart = source.indexOf('const handleBatchFillToSelected = useCallback((sourceRecord: Item, dataIndex: string) => {');
    expect(batchFillToSelectedStart).toBeGreaterThan(-1);
    const batchFillToSelectedEnd = source.indexOf('  const displayData = useMemo', batchFillToSelectedStart);
    expect(batchFillToSelectedEnd).toBeGreaterThan(batchFillToSelectedStart);
    const batchFillToSelectedSource = source.slice(batchFillToSelectedStart, batchFillToSelectedEnd);

    batchFillCellsKeys.forEach((key) => {
      expect(batchFillCellsSource).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });
    batchFillToSelectedKeys.forEach((key) => {
      expect(batchFillToSelectedSource).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    });
    expect(batchFillCellsSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.filled_cells['"]\s*,\s*\{\s*count:\s*updatedCount\s*\}\s*\)/,
    );
    expect(batchFillToSelectedSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.filled_rows['"]\s*,\s*\{\s*count:\s*updatedCount\s*\}\s*\)/,
    );
    expect(batchFillCellsSource).toMatch(/},\s*\[[\s\S]*translateDataGrid[\s\S]*\]\);/);
    expect(batchFillToSelectedSource).toMatch(/},\s*\[[\s\S]*translateDataGrid[\s\S]*\]\);/);

    [
      'zh-CN',
      'zh-TW',
      'en-US',
      'ja-JP',
      'de-DE',
      'ru-RU',
    ].forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      batchFillFeedbackKeys.forEach((key) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });
      expect(catalog['data_grid.message.filled_cells']).toContain('{{count}}');
      expect(catalog['data_grid.message.filled_rows']).toContain('{{count}}');
    });

    const batchFillCallbackSource = `${batchFillCellsSource}\n${batchFillToSelectedSource}`;
    [
      '请先选择要填充的单元格',
      '选中的单元格无需更新',
      '已填充 ${updatedCount} 个单元格',
      '当前字段不可编辑',
      '请先选择要填充的行',
      '没有其他选中的行可以填充',
      '已填充 ${updatedCount} 行',
    ].forEach((literal) => {
      expect(batchFillCallbackSource).not.toContain(literal);
    });
  });

  it('localizes editor and JSON feedback through DataGrid i18n keys', () => {
    const source = readDataGridSource();
    const sliceCallback = (startMarker: string, endMarker: string) => {
      const start = source.indexOf(startMarker);
      expect(start).toBeGreaterThan(-1);
      const end = source.indexOf(endMarker, start);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const expectTranslateCall = (callbackSource: string, key: string) => {
      expect(callbackSource).toMatch(new RegExp(`translateDataGrid\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]`));
    };
    const expectTranslateDependency = (callbackSource: string) => {
      expect(callbackSource).toMatch(/},\s*\[[\s\S]*translateDataGrid[\s\S]*\]\);/);
    };

    const handleDataPanelSaveSource = sliceCallback(
      'const handleDataPanelSave = useCallback(() => {',
      'const handleCellSetNull = useCallback(() => {',
    );
    const handleCellSetNullSource = sliceCallback(
      'const handleCellSetNull = useCallback(() => {',
      'const handleCellEditorSave = useCallback(() => {',
    );
    const handleCellEditorSaveSource = sliceCallback(
      'const handleCellEditorSave = useCallback(() => {',
      'const handleFormatJsonInEditor = useCallback(() => {',
    );
    const cellEditorPermissionEffectSource = sliceCallback(
      'useEffect(() => {\n      if (!cellEditorOpen) return;',
      'const virtualEditingSessionSequenceRef = useRef(0);',
    );
    const openRowEditorByKeySource = sliceCallback(
      'const openRowEditorByKey = useCallback((keyStr?: string) => {',
      'const openCurrentViewRowEditor = useCallback(() => {',
    );
    const openCurrentViewRowEditorSource = sliceCallback(
      'const openCurrentViewRowEditor = useCallback(() => {',
      'const handleOpenJsonEditor = useCallback(() => {',
    );
    const applyJsonEditorSource = sliceCallback(
      'const applyJsonEditor = useCallback(() => {',
      'const openRowEditorFieldEditor = useCallback((dataIndex: string) => {',
    );
    const openRowEditorFieldEditorSource = sliceCallback(
      'const openRowEditorFieldEditor = useCallback((dataIndex: string) => {',
      'const applyRowEditor = useCallback(() => {',
    );

    [
      [handleDataPanelSaveSource, [
        'data_grid.message.current_field_not_editable',
        'data_grid.message.no_data_changes',
        'data_grid.message.saved',
      ]],
      [handleCellSetNullSource, ['data_grid.message.current_field_not_editable']],
      [cellEditorPermissionEffectSource, ['data_grid.message.current_field_not_editable']],
      [openRowEditorByKeySource, [
        'data_grid.message.locate_record_to_edit',
        'data_grid.message.target_row_not_found',
      ]],
      [openCurrentViewRowEditorSource, ['data_grid.message.current_record_not_editable']],
      [applyJsonEditorSource, [
        'data_grid.message.json_parse_failed',
        'data_grid.message.json_view_must_be_array',
        'data_grid.message.json_record_count_mismatch',
        'data_grid.message.json_record_not_object',
        'data_grid.message.json_record_missing_row_key',
        'data_grid.message.json_applied',
      ]],
      [openRowEditorFieldEditorSource, ['data_grid.message.current_field_not_editable']],
    ].forEach(([callbackSource, keys]) => {
      (keys as string[]).forEach((key) => expectTranslateCall(callbackSource as string, key));
      expectTranslateDependency(callbackSource as string);
    });
    expect(handleCellEditorSaveSource).toContain('const runtime = cellEditorRuntimeRef.current;');
    expect(handleCellEditorSaveSource).toContain('!runtime.canModifyData');
    expect(handleCellEditorSaveSource).toContain('runtime.effectiveEditLocator');
    expect(handleCellEditorSaveSource).toContain('handleCellSaveRef.current(nextRow);');

    expect(applyJsonEditorSource).toMatch(
      /const\s+rawErrorMessage\s*=\s*e\?\.message\s*\|\|\s*String\(e\);[\s\S]*translateDataGrid\(\s*['"]data_grid\.message\.json_parse_failed['"]\s*,\s*\{\s*detail:\s*rawErrorMessage\s*\}\s*\)/,
    );
    expect(applyJsonEditorSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.json_record_count_mismatch['"]\s*,\s*\{\s*current:\s*mergedDisplayData\.length\s*,\s*json:\s*parsed\.length\s*\}\s*\)/,
    );
    expect(applyJsonEditorSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.json_record_not_object['"]\s*,\s*\{\s*index:\s*idx\s*\+\s*1\s*\}\s*\)/,
    );
    expect(applyJsonEditorSource).toMatch(
      /translateDataGrid\(\s*['"]data_grid\.message\.json_record_missing_row_key['"]\s*,\s*\{\s*index:\s*idx\s*\+\s*1\s*\}\s*\)/,
    );

    const targetCallbackSource = [
      handleDataPanelSaveSource,
      handleCellSetNullSource,
      handleCellEditorSaveSource,
      openRowEditorByKeySource,
      openCurrentViewRowEditorSource,
      applyJsonEditorSource,
      openRowEditorFieldEditorSource,
    ].join('\n');
    [
      '当前字段不可编辑',
      '数据未变更',
      '已保存',
      '请先定位到要编辑的记录',
      '未找到目标行，请刷新后重试',
      '当前记录不可编辑',
      'JSON 解析失败：',
      'JSON 视图必须是数组格式（每项对应一条记录）',
      '记录条数不一致：当前 ${mergedDisplayData.length} 条，JSON 中 ${parsed.length} 条。请勿在此模式增删记录。',
      '第 ${idx + 1} 条记录不是对象，无法应用',
      '第 ${idx + 1} 条记录缺少行标识，无法应用',
      'JSON 修改已应用到当前结果集，可继续“提交事务”',
    ].forEach((literal) => {
      expect(targetCallbackSource).not.toContain(literal);
    });
  });

  it('refreshes DataGrid localized chrome when the language preference changes', () => {
    mockStoreState.languagePreference = 'system';
    const previousUiVersion = mockStoreState.uiVersion;
    mockStoreState.uiVersion = 'legacy';
    const renderLocalizedGrid = (systemLanguages: readonly string[]) => renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        readOnly
        pagination={{
          current: 1,
          pageSize: 100,
          total: 1,
        }}
        onPageChange={() => {}}
      />,
      { systemLanguages },
    );

    try {
      const zhMarkup = renderLocalizedGrid(['zh-CN']);
      expect(zhMarkup).toContain('placeholder="跳到字段列..."');
      expect(zhMarkup).not.toContain('placeholder="Jump to column..."');

      const enMarkup = renderLocalizedGrid(['en-US']);
      expect(enMarkup).toContain('placeholder="Jump to column..."');
    } finally {
      mockStoreState.uiVersion = previousUiVersion;
    }

    const source = readDataGridSource();

    expect(source).toMatch(/import\s+\{\s*getCurrentLanguage,\s*t\s*\}\s+from\s+['"]\.\.\/i18n['"]/);
    expect(source).toMatch(/import\s+\{\s*useOptionalI18n\s*\}\s+from\s+['"]\.\.\/i18n\/provider['"]/);
    expect(source).toMatch(/const\s+useDataGridI18nLanguage\s*=\s*\(\s*\)\s*=>\s*{[\s\S]*?const\s+i18n\s*=\s*useOptionalI18n\(\s*\);[\s\S]*?return\s+i18n\?\.language\s*\?\?\s*getCurrentLanguage\(\s*\);[\s\S]*?};/);
    expect(source).toMatch(/const\s+language\s*=\s*useDataGridI18nLanguage\(\s*\);/);
    expect(source).not.toMatch(/const\s+\{\s*language\s*\}\s*=\s*useI18n\(\s*\);/);
    expect(source).toMatch(/t\(key,\s*params,\s*language\)/);
    expect(source).not.toMatch(/t\(key,\s*params,\s*languagePreference\)/);
    expect(source).toContain("'data-i18n-language': language");
    expect(source).toMatch(/}\s*,\s*\[[^\]]*language[^\]]*\]\);/);
    expect(source).toMatch(/const\s+DataGridWithErrorBoundary:\s*React\.FC<DataGridProps>\s*=\s*\(props\)\s*=>\s*{/);
    expect(source).toMatch(/<DataGridErrorBoundary\s+i18nLanguage={language}>/);
    expect(source).not.toMatch(/<DataGridErrorBoundary\s+key={language}/);
  });

  it('keeps the v2 footer fields action labeled as field info for views', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="user_view"
        objectType="view"
        readOnly
        pagination={{
          current: 1,
          pageSize: 100,
          total: 1,
        }}
        onPageChange={() => {}}
      />,
    );

    expect(markup).toContain('字段信息');
    expect(markup).not.toContain(zhObjectDesignLabel);
  });

  it('falls back to the current i18n language when rendered outside I18nProvider', () => {
    const previousUiVersion = mockStoreState.uiVersion;
    const previousLanguage = getCurrentLanguage();
    mockStoreState.uiVersion = 'legacy';
    setCurrentLanguage('en-US');

    try {
      const markup = renderToStaticMarkup(
        <DataGrid
          data={[
            {
              __gonavi_row_key__: 'row-1',
              id: 1,
              name: 'alpha',
            },
          ]}
          columnNames={['id', 'name']}
          loading={false}
          tableName="users"
          readOnly
        />,
      );

      expect(markup).toContain('placeholder="Jump to column..."');
      expect(markup).not.toContain('placeholder="跳到字段列..."');
    } finally {
      setCurrentLanguage(previousLanguage);
      mockStoreState.uiVersion = previousUiVersion;
    }
  });

  it('localizes legacy and v2 pagination summaries through DataGrid i18n', () => {
    mockStoreState.languagePreference = 'system';
    const previousUiVersion = mockStoreState.uiVersion;
    const renderLocalizedGrid = (uiVersion: 'legacy' | 'v2', pagination: React.ComponentProps<typeof DataGrid>['pagination']) => {
      mockStoreState.uiVersion = uiVersion;
      return renderDataGridWithI18n(
        <DataGrid
          data={[
            {
              __gonavi_row_key__: 'row-1',
              id: 1,
              name: 'alpha',
            },
          ]}
          columnNames={['id', 'name']}
          loading={false}
          tableName="users"
          readOnly
          pagination={pagination}
          onPageChange={() => {}}
        />,
        { systemLanguages: ['en-US'] },
      );
    };

    try {
      const legacyMarkup = renderLocalizedGrid('legacy', {
        current: 1,
        pageSize: 100,
        total: 1,
      });
      expect(legacyMarkup).toContain('Current 1 rows / 1 rows total');
      expect(legacyMarkup).not.toContain('当前 1 条');

      const v2Markup = renderLocalizedGrid('v2', {
        current: 1,
        pageSize: 100,
        total: 1,
        totalKnown: false,
        totalCountLoading: true,
      });
      expect(v2Markup).toContain('Current 1 rows / counting total...');
      expect(v2Markup).not.toContain('正在统计');
    } finally {
      mockStoreState.uiVersion = previousUiVersion;
    }
  });

  it('keeps v2 pagination page text out of the summary because the page chip owns it', () => {
    mockStoreState.languagePreference = 'system';
    const previousUiVersion = mockStoreState.uiVersion;
    mockStoreState.uiVersion = 'v2';

    try {
      const markup = renderDataGridWithI18n(
        <DataGrid
          data={[
            {
              __gonavi_row_key__: 'row-1',
              id: 1,
              name: 'alpha',
            },
          ]}
          columnNames={['id', 'name']}
          loading={false}
          tableName="users"
          readOnly
          pagination={{
            current: 1,
            pageSize: 100,
            total: 1,
          }}
          onPageChange={() => {}}
        />,
        { systemLanguages: ['en-US'] },
      );

      expect(markup).toContain('Current 1 rows / 1 rows total');
      expect(markup).toContain('data-grid-v2-page-chip="true"');
      expect(markup).toContain('<strong>1</strong><span>/</span><span>1</span>');
      expect(markup).not.toContain('Page 1 / 1');
    } finally {
      mockStoreState.uiVersion = previousUiVersion;
    }
  });

  it('keeps the v2 pagination total-count action readable instead of icon-button width', () => {
    const css = readV2ThemeCss();
    const markup = renderToStaticMarkup(
      <DataGridPaginationBar
        isV2Ui
        pagination={{
          current: 1,
          pageSize: 500,
          total: 500,
          totalKnown: false,
        }}
        paginationV2SummaryText="当前 500 条 / 未统计总数"
        paginationSummaryText="当前 500 条 / 未统计总数"
        paginationControlTotal={500}
        paginationTotalPages={1}
        paginationPageText="第 1 页"
        paginationPageSizeOptions={['500']}
        showKnownPageCount={false}
        manualTotalCountAvailable
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        onV2PageStep={() => {}}
        onToggleTotalCount={() => {}}
      />,
    );

    expect(markup).toContain('data-grid-pagination-total-count="true"');
    expect(markup).toContain('统计总数');
    expect(css).toMatch(/\[data-grid-pagination-total-count="true"\]\.ant-btn \{[\s\S]*?width: auto !important;[\s\S]*?min-width: max-content !important;[\s\S]*?white-space: nowrap;/);
    expect(css).toMatch(/\[data-grid-pagination-total-count="true"\]\.ant-btn \.ant-btn-icon \{[\s\S]*?margin-inline-end: 3px !important;/);
  });

  it('passes the real total-count handler from DataGridShell to the pagination bar', () => {
    const shellSource = readDataGridShellSource();

    expect(shellSource).toMatch(/<DataGridPaginationBar[\s\S]*?manualTotalCountAvailable=\{[^}]*onRequestTotalCount[^}]*\}[\s\S]*?totalCountLoading=\{pagination\?\.totalCountLoading\}[\s\S]*?onToggleTotalCount=\{handleToggleTotalCount\}/);
  });

  it('keeps V2 current-page find hidden until its floating table overlay is opened', () => {
    const source = readDataGridShellSource();
    const secondaryActionsSource = readDataGridSecondaryActionsSource();
    const css = readV2ThemeCss();

    expect(source).toContain("const floatingPageFindContent = isV2Ui && pageFindOpen && viewMode === 'table'");
    expect(source).toContain("const legacyPageFindContent = !isV2Ui && viewMode === 'table'");
    expect(source).toContain('data-grid-page-find-overlay="true"');
    expect(source).toContain('pageFindContent={legacyPageFindContent}');
    const v2BranchStart = secondaryActionsSource.indexOf('if (isV2Ui)');
    const legacyBranchStart = secondaryActionsSource.lastIndexOf('  return (');
    expect(v2BranchStart).toBeGreaterThanOrEqual(0);
    expect(legacyBranchStart).toBeGreaterThan(v2BranchStart);
    expect(secondaryActionsSource.slice(v2BranchStart, legacyBranchStart)).not.toContain('{pageFindContent}');
    expect(css).toMatch(/\.gn-v2-data-grid-page-find-overlay\s*\{[^}]*position:\s*absolute;[^}]*top:\s*8px;[^}]*right:\s*8px;[^}]*z-index:\s*40;[^}]*background:[^;]+;[^}]*box-shadow:/s);
    expect(css).toMatch(/\.gn-v2-data-grid-page-find-overlay\s*\{[^}]*width:\s*min\(360px,\s*calc\(100% - 16px\)\);/s);
    expect(css).toMatch(/\.gn-v2-data-grid-page-find\s*\{[^}]*width:\s*100%;[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.gn-v2-data-grid-page-find \.ant-input-affix-wrapper\s*\{[^}]*flex:\s*1 1 160px;[^}]*width:\s*auto !important;[^}]*max-width:\s*none !important;/s);
    expect(css).not.toMatch(/\.gn-v2-data-grid-page-find\s*\{[^}]*max-width:\s*214px\s*!important;/s);
    expect(css).not.toMatch(/\.gn-v2-data-grid-page-find [^{]*\.gn-v2-data-grid-page-find-input[^{]*\{[^}]*width:\s*160px\s*!important;/s);
    expect(css).not.toContain('.gn-v2-data-grid-page-find-row');
  });

  it('routes Ctrl/Cmd+F to the active DataGrid without stealing SQL editor find', () => {
    const dataGridSource = readDataGridSource();
    const queryEditorSource = readQueryEditorSource();

    expect(dataGridSource).toContain("activeShortcutPlatform === 'mac' ? 'Meta+F' : 'Ctrl+F'");
    expect(dataGridSource).toContain('isShortcutMatch(event, pageFindShortcutCombo)');
    expect(dataGridSource).toContain("window.addEventListener('keydown', handlePageFindShortcut, true)");
    expect(dataGridSource).toContain('event.stopImmediatePropagation()');
    expect(queryEditorSource).toContain("targetElement?.closest('.data-grid-root')");
    expect(queryEditorSource).toContain('dataGridHasFocus');
  });

  it('keeps legacy secondary actions aligned on a shared search-row baseline', () => {
    const source = readFileSync(new URL('./DataGridSecondaryActions.tsx', import.meta.url), 'utf8');
    const columnQuickFindSource = readFileSync(new URL('./DataGridColumnQuickFind.tsx', import.meta.url), 'utf8');
    const pageFindSource = readFileSync(new URL('./DataGridPageFind.tsx', import.meta.url), 'utf8');
    const dataGridSource = readDataGridSource();
    const paginationSource = readFileSync(new URL('./DataGridPaginationBar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-grid-legacy-secondary-actions="true"');
    expect(source).toContain('data-grid-legacy-secondary-row="primary"');
    expect(source).toContain('data-grid-legacy-secondary-row="search"');
    expect(source).toContain('data-grid-legacy-result-view-switcher="true"');
    expect(source).toContain('data-grid-legacy-column-quick-find="true"');
    expect(source).toContain('data-grid-legacy-page-find="true"');
    expect(source).toContain('data-grid-legacy-pagination="true"');
    expect(source).toContain("justifyContent: 'flex-start'");
    expect(source).toContain('minHeight: 32');
    expect(source).toContain("style={{ display: 'flex', minWidth: 0, marginLeft: 'auto' }}");
    expect(source).toContain("flex: '0 1 240px'");
    expect(source).toContain("flex: '0 1 auto'");
    expect(columnQuickFindSource).not.toContain('定位字段列');
    expect(columnQuickFindSource).toContain("flexWrap: 'nowrap'");
    expect(columnQuickFindSource).toContain("width: 168");
    expect(columnQuickFindSource).toContain('height: 32');
    expect(columnQuickFindSource).toContain('const legacyDropdownOpen =');
    expect(columnQuickFindSource).toContain('open={isV2Ui ? undefined : legacyDropdownOpen}');
    expect(columnQuickFindSource).toContain('onSubmit: (value?: string) => void;');
    expect(columnQuickFindSource).toContain('onSubmit(nextValue);');
    expect(columnQuickFindSource).toContain('onPressEnter={() => onSubmit(value)}');
    expect(columnQuickFindSource).not.toContain('data-grid-column-quick-find-submit=');
    expect(columnQuickFindSource).not.toContain(" '跳转'");
    expect(pageFindSource).toContain("gap: 8");
    expect(pageFindSource).toContain("flexWrap: 'nowrap'");
    expect(pageFindSource).toContain('height: 32');
    expect(pageFindSource).not.toContain("flexDirection: 'column'");
    expect(pageFindSource).not.toContain(" '上一个'");
    expect(pageFindSource).not.toContain(" '下一个'");
    expect(pageFindSource).toContain("paddingInline: 8");
    expect(pageFindSource).toContain("whiteSpace: 'nowrap'");
    expect(pageFindSource).toContain("onCancel: () => void;");
    expect(pageFindSource).toContain("if (event.key === 'Escape')");
    expect(pageFindSource).toContain('onCancel();');
    expect(pageFindSource).toContain("textAlign: 'left'");
    expect(dataGridSource).toContain('const deferredPageFindText = useDeferredValue(pageFindText);');
    expect(dataGridSource).toMatch(/normalizeDataGridFindQuery\(pageFindText\)[\s\S]*?normalizeDataGridFindQuery\(deferredPageFindText\)[\s\S]*?: ''/);
    expect(dataGridSource).toContain('collectDataGridFindResult(');
    expect(dataGridSource).not.toContain('summarizeDataGridFindMatches(');
    expect(dataGridSource).toContain("if (event.key === 'Escape')");
    expect(dataGridSource).toContain('if (activeSelection.size === 0) {');
    expect(dataGridSource).toContain('closeCellEditMode();');
    expect(dataGridSource).toContain('resetCellSelection();');
    expect(dataGridSource).toContain('activeElement?.closest(nativeShortcutGuard) || eventTarget?.closest(nativeShortcutGuard)');
    expect(paginationSource).toContain("padding: 0");
    expect(paginationSource).toContain("justifyContent: 'flex-start'");
  });

  it('avoids duplicating legacy pagination page text beside the pager', () => {
    const markup = renderToStaticMarkup(
      <DataGridPaginationBar
        isV2Ui={false}
        pagination={{
          current: 1,
          pageSize: 100,
          total: 24,
        }}
        paginationV2SummaryText="24 行"
        paginationSummaryText="当前 24 条 / 共 24 条"
        paginationControlTotal={24}
        paginationTotalPages={1}
        paginationPageText="第 1 / 1 页"
        paginationPageSizeOptions={['100', '200']}
        showKnownPageCount
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        onV2PageStep={() => {}}
      />,
    );

    expect(markup).toContain('class="ant-pagination');
    expect(markup).not.toContain('第 1 / 1 页');
  });

  it('keeps detached DataGrid chrome text behind translateDataGrid', () => {
    const dataGridSource = readDataGridSource();
    const toolbarFrameSource = readFileSync(new URL('./DataGridToolbarFrame.tsx', import.meta.url), 'utf8');
    const pageFindSource = readFileSync(new URL('./DataGridPageFind.tsx', import.meta.url), 'utf8');
    const resultViewSource = readFileSync(new URL('./DataGridResultViewSwitcher.tsx', import.meta.url), 'utf8');
    const paginationSource = readFileSync(new URL('./DataGridPaginationBar.tsx', import.meta.url), 'utf8');
    const secondaryActionsSource = readFileSync(new URL('./DataGridSecondaryActions.tsx', import.meta.url), 'utf8');
    const recordViewsSource = readFileSync(new URL('./DataGridRecordViews.tsx', import.meta.url), 'utf8');
    const previewPanelSource = readFileSync(new URL('./DataGridPreviewPanel.tsx', import.meta.url), 'utf8');
    const modalsSource = readFileSync(new URL('./DataGridModals.tsx', import.meta.url), 'utf8');
    const ddlWorkspaceSource = readFileSync(new URL('./DataGridV2DdlWorkspace.tsx', import.meta.url), 'utf8');
    const detachedChromeSource = [
      pageFindSource,
      resultViewSource,
      paginationSource,
      secondaryActionsSource,
      recordViewsSource,
      previewPanelSource,
      modalsSource,
      ddlWorkspaceSource,
    ].join('\n');

    expect(dataGridSource).toMatch(/<DataGridToolbarFrame[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridPageFind[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridResultViewSwitcher[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridPaginationBar[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridSecondaryActions[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridJsonView[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridTextView[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridPreviewPanel[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridModals[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridV2FieldsView[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridV2ErView[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridV2DdlSideWorkspace[\s\S]*?translate={translateDataGrid}/);
    expect(dataGridSource).toMatch(/<DataGridV2DdlView[\s\S]*?translate={translateDataGrid}/);
    expect(detachedChromeSource).toContain("translate('data_grid.page_find.tooltip')");
    expect(detachedChromeSource).toContain("translate('data_grid.page_find.placeholder')");
    expect(detachedChromeSource).toContain("translate('data_grid.page_find.previous')");
    expect(detachedChromeSource).toContain("translate('data_grid.page_find.next')");
    expect(detachedChromeSource).toContain("translate('data_grid.page_find.summary'");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.result_set')");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.page_size_aria')");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.page_size_option'");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.first_page')");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.last_page')");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.jump_label')");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.jump_aria')");
    expect(detachedChromeSource).toContain("translate('data_grid.pagination.jump_action')");
    expect(detachedChromeSource).toContain("translate('data_grid.view.result_view')");
    expect(detachedChromeSource).toContain("translate('data_grid.view.table')");
    expect(detachedChromeSource).toContain("translate('data_grid.view.text')");
    expect(detachedChromeSource).toContain("translate('data_grid.secondary.data_preview')");
    expect(detachedChromeSource).toContain("translate('data_grid.column_settings.field_info')");
    expect(detachedChromeSource).toContain("translate('data_grid.secondary.view_ddl')");
    expect(detachedChromeSource).toContain("translate('data_grid.secondary.er_diagram')");
    expect(detachedChromeSource).toContain("translate('data_grid.secondary.column_display')");
    expect(detachedChromeSource).toContain("translate('data_grid.secondary.jump_column')");
    expect(secondaryActionsSource).not.toContain("translate('data_grid.secondary.row_count'");
    expect(secondaryActionsSource).not.toContain("translate('data_grid.secondary.pending_changes'");
    expect(secondaryActionsSource).not.toContain("translate('data_grid.secondary.live')");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.empty')");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.json_record_count'");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.edit_json')");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.previous')");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.next')");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.record_position'");
    expect(detachedChromeSource).toContain("translate('data_grid.record_view.edit_current')");
    expect(detachedChromeSource).toContain("translate('data_grid.preview_panel.no_cell_title')");
    expect(detachedChromeSource).toContain("translate('data_grid.preview_panel.no_cell_description')");
    expect(detachedChromeSource).toContain("translate('data_grid.row_editor.title')");
    expect(detachedChromeSource).toContain("translate('data_grid.row_editor.popup_edit')");
    expect(detachedChromeSource).toContain("translate('data_grid.cell_editor.title')");
    expect(detachedChromeSource).toContain("translate('data_grid.cell_editor.title_with_column'");
    expect(detachedChromeSource).toContain("translate('data_grid.cell_viewer.title_with_column'");
    expect(detachedChromeSource).toContain("translate('data_grid.batch_fill.title'");
    expect(detachedChromeSource).toContain("translate('data_grid.batch_fill.set_null')");
    expect(detachedChromeSource).toContain("translate('data_grid.batch_fill.value_placeholder')");
    expect(detachedChromeSource).toContain("translate('data_grid.json_editor.title')");
    expect(detachedChromeSource).toContain("translate('data_grid.json_editor.description')");
    expect(detachedChromeSource).toContain("translate('data_grid.json_editor.format')");
    expect(detachedChromeSource).toContain("translate('data_grid.json_editor.apply_changes')");
    expect(detachedChromeSource).toContain("translate('data_grid.ddl.layout_bottom')");
    expect(detachedChromeSource).toContain("translate('data_grid.ddl.layout_side')");
    expect(detachedChromeSource).toContain("translate('data_grid.ddl.reload')");
    expect(detachedChromeSource).toContain("translate('data_grid.ddl.copy')");
    expect(detachedChromeSource).toContain("translate('data_grid.ddl.loading')");
    expect(detachedChromeSource).toContain("translate('data_grid.ddl.sidebar_aria')");
    expect(detachedChromeSource).toContain("translate('common.cancel')");
    expect(detachedChromeSource).toContain("translate('common.close')");
    expect(detachedChromeSource).toContain("translate('common.save')");
    expect(detachedChromeSource).toContain("translate('data_grid.action.apply')");
    expect(toolbarFrameSource).toContain('translate?: (key: string, params?: Record<string, string | number>) => string');
    [
      'data_grid.table_fallback.query_result',
      'data_grid.toolbar.refresh',
      'data_grid.toolbar.filter',
      'data_grid.toolbar.add_row',
      'data_grid.toolbar.undo_delete',
      'data_grid.toolbar.delete_selected',
      'data_grid.toolbar.selected_count',
      'data_grid.toolbar.cell_editor',
      'data_grid.toolbar.copy_selection',
      'data_grid.toolbar.copy_selection_columns',
      'data_grid.toolbar.batch_fill',
      'data_grid.toolbar.paste_to_selected_rows',
      'data_grid.toolbar.copied_columns_count',
      'data_grid.toolbar.commit_label',
      'data_grid.toolbar.commit',
      'data_grid.toolbar.preview_sql_generate',
      'data_grid.toolbar.preview_sql',
      'data_grid.toolbar.rollback',
      'data_grid.toolbar.import',
      'data_grid.toolbar.export',
      'data_grid.toolbar.copy',
      'data_grid.toolbar.ai_insight',
      'data_grid.toolbar.ai_insight_short',
      'data_grid.toolbar.ai_insight_tooltip',
      'data_grid.toolbar.cancel_count',
      'data_grid.toolbar.cancel_count_tooltip',
      'data_grid.toolbar.count_total',
      'data_grid.toolbar.count_total_tooltip',
      'data_grid.filter.mongodb_query_placeholder',
      'data_grid.filter.quick_where_placeholder',
      'data_grid.filter.apply_where',
      'data_grid.filter.clear',
      'data_grid.filter.enabled',
      'data_grid.filter.first_condition',
      'data_grid.filter.search_field_placeholder',
      'data_grid.filter.custom_where_placeholder',
      'data_grid.filter.list_values_placeholder',
      'data_grid.filter.start_value_placeholder',
      'data_grid.filter.end_value_placeholder',
      'data_grid.filter.no_value_placeholder',
      'data_grid.filter.sort_label',
      'data_grid.filter.then_label',
      'data_grid.filter.select_sort_field_placeholder',
      'data_grid.filter.sort_asc',
      'data_grid.filter.sort_desc',
      'data_grid.filter.add_condition',
      'data_grid.filter.add_sort',
      'data_grid.filter.enable_all',
      'data_grid.filter.disable_all',
      'data_grid.filter.apply',
    ].forEach((key) => {
      expect(toolbarFrameSource).toContain(`translate('${key}`);
    });
    [
      /translate\('data_grid\.toolbar\.selected_count', \{ count: deleteTargetRowCount \}\)/,
      /translate\('data_grid\.toolbar\.copy_selection', \{ count: selectedCellsSize \}\)/,
      /translate\('data_grid\.toolbar\.copy_selection_columns', \{ count: selectedCellsSize \}\)/,
      /translate\('data_grid\.toolbar\.batch_fill', \{ count: selectedCellsSize \}\)/,
      /translate\('data_grid\.toolbar\.paste_to_selected_rows', \{ count: selectedRowKeysLength \}\)/,
      /translate\('data_grid\.toolbar\.copied_columns_count', \{ count: copiedCellPatchColumnCount \}\)/,
      /translate\('data_grid\.toolbar\.commit', \{ count: pendingChangeCount \}\)/,
    ].forEach((pattern) => {
      expect(toolbarFrameSource).toMatch(pattern);
    });
    [
      '查询结果',
      '刷新',
      '筛选',
      '添加行',
      '撤销删除',
      '删除选中',
      '单元格编辑器',
      '复制选区',
      '复制选区列值',
      '批量填充',
      '粘贴到选中行',
      '提交事务',
      '生成预览 SQL',
      '预览SQL',
      '回滚',
      '导入',
      '导出',
      '一键借助 AI 智能分析当前查询页数据',
      'AI 洞察',
      'AI 数据洞察',
      '取消本次精确总数统计（不会影响当前浏览）',
      '按当前筛选统计精确总数',
      '取消统计',
      '统计总数',
      '应用 WHERE',
      '清空',
      '启用',
      '首条',
      '搜索字段名',
      '输入自定义 WHERE 表达式',
      '多个值用逗号或换行分隔',
      '开始值',
      '结束值',
      '无需输入值',
      '排序',
      '然后',
      '选择排序字段',
      '升序',
      '降序',
      '添加条件',
      '添加排序',
      '全启用',
      '全停用',
      '>应用<',
      '>复制<',
    ].forEach((literal) => {
      expect(toolbarFrameSource).not.toContain(literal);
    });
    expect(toolbarFrameSource).toContain('WHERE');
    expect(toolbarFrameSource).toContain('tableName');
    expect(toolbarFrameSource).toContain('dbName');
    (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const).forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      );
      expect(catalog['data_grid.filter.quick_where_placeholder']).toContain('WHERE');
      expect(catalog['data_grid.filter.quick_where_placeholder']).toContain("status = 1 AND name LIKE 'A%'");
      expect(catalog['data_grid.filter.mongodb_query_placeholder']).toContain('MongoDB');
      expect(catalog['data_grid.filter.mongodb_query_placeholder']).toContain('JSON');
      expect(catalog['data_grid.filter.mongodb_query_placeholder']).toContain('{"status":"A"}');
      expect(catalog['data_grid.toolbar.preview_sql']).toContain('SQL');
      expect(catalog['data_grid.toolbar.preview_sql_generate']).toContain('SQL');
    });
    expect(dataGridSource).toContain("translateDataGrid('data_grid.json_editor.invalid_format', { error:");
    expect(dataGridSource).not.toContain('JSON 格式无效：');

    const handleCopyDdlSourceStart = dataGridSource.indexOf('const handleCopyDdl = useCallback(() => {');
    const handleCopyDdlSource = dataGridSource.slice(
      handleCopyDdlSourceStart,
      dataGridSource.indexOf('const handleCopySelectedCellsToClipboard', handleCopyDdlSourceStart),
    );
    [
      'data_grid.message.no_ddl_to_copy',
      'data_grid.message.ddl_copied',
      'data_grid.message.ddl_copy_failed',
    ].forEach((key) => {
      expect(handleCopyDdlSource).toContain(`translateDataGrid('${key}')`);
    });
    [
      '暂无可复制的 DDL',
      'DDL 已复制到剪贴板',
      '复制 DDL 失败',
    ].forEach((literal) => {
      expect(handleCopyDdlSource).not.toContain(literal);
    });
    expect(dataGridSource.match(/message\.info\(translateDataGrid\('data_grid\.message\.no_copyable_rows'\)\)/g) ?? []).toHaveLength(3);
    expect(dataGridSource).not.toContain("message.info('未识别到可复制的行')");
    expect(dataGridSource).toContain("translateDataGrid('data_grid.message.cell_edit_mode_entered')");
    expect(dataGridSource).toContain("translateDataGrid('data_grid.message.cell_edit_mode_exited')");
    expect(dataGridSource).not.toContain("'已进入单元格编辑模式，可拖拽选择多个单元格'");
    expect(dataGridSource).not.toContain("'已退出单元格编辑模式'");

    const ddlWorkspaceInlineLiterals = [
      '底部',
      '侧栏',
      '重新加载',
      '复制 DDL',
      '正在加载 DDL...',
      '表 DDL 侧栏',
    ];
    ddlWorkspaceInlineLiterals.forEach((literal) => {
      expect(ddlWorkspaceSource).not.toContain(literal);
    });

    const ddlWorkspaceTranslateCalls: Array<{ key: string; params?: Record<string, unknown> }> = [];
    const translate = (key: string, params?: Record<string, unknown>) => {
      ddlWorkspaceTranslateCalls.push({ key, params });
      return `[${key}]`;
    };
    const rawTableName = 'catalog.system_raw_error';
    const rawDdl = 'CREATE TABLE catalog.system_raw_error (sql_text text, checksum text, github_release text, http_status int);';

    const bottomDdlMarkup = renderToStaticMarkup(
      <DataGridV2DdlView
        layout="bottom"
        tableName={rawTableName}
        ddlViewLayout="bottom"
        ddlLoading={false}
        ddlText={rawDdl}
        darkMode={false}
        onDdlViewLayoutChange={() => {}}
        onReload={() => {}}
        onCopy={() => {}}
        translate={translate}
      />,
    );
    const sideDdlMarkup = renderToStaticMarkup(
      <DataGridV2DdlSideWorkspace
        tableContent={<div data-table-content="true">rows</div>}
        tableName={rawTableName}
        ddlViewLayout="side"
        ddlLoading
        ddlText={rawDdl}
        darkMode={false}
        onDdlViewLayoutChange={() => {}}
        onReload={() => {}}
        onCopy={() => {}}
        ddlSidebarWidth={420}
        ddlSidebarResizePreviewX={null}
        onResizeStart={() => {}}
        translate={translate}
      />,
    );

    expect(bottomDdlMarkup).toContain('[data_grid.ddl.layout_bottom]');
    expect(bottomDdlMarkup).toContain('[data_grid.ddl.layout_side]');
    expect(bottomDdlMarkup).toContain('[data_grid.ddl.reload]');
    expect(bottomDdlMarkup).toContain('[data_grid.ddl.copy]');
    expect(bottomDdlMarkup).toContain(rawTableName);
    expect(bottomDdlMarkup).toContain(rawDdl);
    expect(sideDdlMarkup).toContain('aria-label="[data_grid.ddl.sidebar_aria]"');
    expect(sideDdlMarkup).toContain('gn-v2-data-grid-ddl-title');
    expect(sideDdlMarkup).toContain('gn-v2-data-grid-ddl-actions');
    expect(sideDdlMarkup).toContain('[common.close]');
    expect(sideDdlMarkup).toContain('[data_grid.ddl.loading]');
    const v2ThemeCss = readV2ThemeCss();
    expect(v2ThemeCss).toMatch(/\.gn-v2-data-grid-ddl-view\.is-side\s+\.gn-v2-data-grid-ddl-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(v2ThemeCss).toMatch(/\.gn-v2-data-grid-ddl-view\.is-side\s+\.gn-v2-data-grid-ddl-title\s*\{[^}]*overflow:\s*hidden;/s);
    expect(ddlWorkspaceTranslateCalls.map((call) => call.key)).toEqual([
      'data_grid.ddl.layout_bottom',
      'data_grid.ddl.layout_side',
      'data_grid.ddl.reload',
      'data_grid.ddl.copy',
      'data_grid.ddl.sidebar_aria',
      'data_grid.ddl.layout_bottom',
      'data_grid.ddl.layout_side',
      'data_grid.ddl.reload',
      'data_grid.ddl.copy',
      'common.close',
      'data_grid.ddl.loading',
    ]);
    expect(ddlWorkspaceTranslateCalls.every((call) => call.params === undefined)).toBe(true);

    expect(modalsSource).not.toMatch(/<Button key="format"[^>]*>\s*格式化 JSON\s*<\/Button>/);
    expect(modalsSource).not.toContain('编辑行');
    expect(modalsSource).not.toContain('编辑单元格');
    expect(modalsSource).not.toContain('title="弹窗编辑"');
    expect(modalsSource).not.toMatch(/<Button key="cancel" onClick=\{onCloseCellEditor\}>\s*取消\s*<\/Button>/);
    expect(modalsSource).not.toMatch(/<Button key="ok" type="primary" onClick=\{onSaveCellEditor\}>\s*保存\s*<\/Button>/);
    expect(modalsSource).not.toMatch(/<Button key="cancel" onClick=\{onCloseJsonEditor\}>\s*取消\s*<\/Button>/);
    expect(modalsSource).not.toMatch(/<Button key="ok" type="primary" onClick=\{onApplyJsonEditor\}>\s*应用修改\s*<\/Button>/);
    expect(modalsSource).not.toContain('批量填充');
    expect(modalsSource).not.toContain('设置为 NULL');
    expect(modalsSource).not.toContain('placeholder="输入要填充的值"');
    expect(modalsSource).not.toContain('复制 DDL');
    expect(modalsSource).not.toMatch(/<Button key="close" type="primary" onClick=\{onCloseDdlModal\}>\s*关闭\s*<\/Button>/);
    expect(modalsSource).not.toContain("'正在加载 DDL...'");

    [
      '仅查找当前页已加载数据，不改变 WHERE 条件',
      '当前页查找...',
      '匹配 ',
      '结果视图',
      '表格',
      '文本',
      '数据预览',
      '字段信息',
      '字段显示',
      '跳列',
      '未提交',
      '跳页',
      '跳转页码',
      '>跳<',
      '每页条数',
      '结果集',
      '当前结果集无数据',
      '当前结果集 ',
      ' 条记录',
      '编辑 JSON',
      '上一条',
      '下一条',
      '记录 ',
      '编辑当前记录',
      '点击单元格查看数据',
      '编辑行',
      '编辑 JSON 结果集',
      '说明：此处按当前结果集顺序编辑',
      '格式化 JSON',
      '应用修改',
      '批量填充',
      '设置为 NULL',
      '输入要填充的值',
      '复制 DDL',
      '正在加载 DDL...',
      '>保存<',
      '点击表格中的单元格以预览完整数据',
    ].forEach((literal) => {
      expect(detachedChromeSource).not.toContain(literal);
    });
  });

  it('localizes V2 metadata fields and ER view chrome while preserving raw metadata values', () => {
    const translate = (key: string, params?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'data_grid.table_fallback.query_result': 'Query fallback',
        'data_grid.metadata_view.fields_badge': 'Meta fields',
        'data_grid.metadata_view.er_table_badge': 'Entity table',
        'data_grid.metadata_view.er_field_badge': 'Entity field',
        'data_grid.metadata_view.field_count': `${params?.count} localized fields`,
        'data_grid.metadata_view.column_name': 'Localized name',
        'data_grid.metadata_view.column_type': 'Localized type',
        'data_grid.metadata_view.default_value': 'Localized default',
        'data_grid.metadata_view.comment': 'Localized comment',
      };
      return labels[key] ?? `missing:${key}`;
    };

    const fieldsMarkup = renderToStaticMarkup(
      <DataGridV2FieldsView
        translate={translate}
        tableName="raw_users"
        displayOutputColumnNames={['raw_id', 'raw_name']}
        pkColumns={['raw_id']}
        columnMetaMap={{
          raw_id: { type: 'bigint', comment: 'raw primary key' },
          raw_name: { type: 'varchar(64)', comment: 'raw display name' },
        }}
        columnMetaMapByLowerName={{}}
      />,
    );

    expect(fieldsMarkup).toContain('Meta fields');
    expect(fieldsMarkup).toContain('2 localized fields');
    expect(fieldsMarkup).toContain('Localized name');
    expect(fieldsMarkup).toContain('Localized type');
    expect(fieldsMarkup).toContain('Localized default');
    expect(fieldsMarkup).toContain('Localized comment');
    expect(fieldsMarkup).toContain('raw_users');
    expect(fieldsMarkup).toContain('raw_id');
    expect(fieldsMarkup).toContain('varchar(64)');
    expect(fieldsMarkup).toContain('raw display name');
    expect(fieldsMarkup).toContain('PK');
    expect(fieldsMarkup).not.toContain('FIELDS');
    expect(fieldsMarkup).not.toContain('名称');
    expect(fieldsMarkup).not.toContain('默认值');

    const erMarkup = renderToStaticMarkup(
      <DataGridV2ErView
        translate={translate}
        displayOutputColumnNames={['raw_name']}
        columnMetaMap={{ raw_name: { type: 'varchar(64)', comment: 'raw display name' } }}
        columnMetaMapByLowerName={{}}
      />,
    );

    expect(erMarkup).toContain('Entity table');
    expect(erMarkup).toContain('Entity field');
    expect(erMarkup).toContain('Query fallback');
    expect(erMarkup).toContain('1 localized fields');
    expect(erMarkup).toContain('raw_name');
    expect(erMarkup).toContain('varchar(64)');
    expect(erMarkup).not.toContain('TABLE');
    expect(erMarkup).not.toContain('FIELD');
    expect(erMarkup).not.toContain('1 fields');
  });

  it('keeps V2 metadata view i18n keys in every locale catalog and removes fixed source literals', () => {
    const metadataSource = readFileSync(new URL('./DataGridV2MetadataViews.tsx', import.meta.url), 'utf8');
    const expectedKeys = [
      'data_grid.table_fallback.query_result',
      'data_grid.metadata_view.fields_badge',
      'data_grid.metadata_view.er_table_badge',
      'data_grid.metadata_view.er_field_badge',
      'data_grid.metadata_view.field_count',
      'data_grid.metadata_view.column_name',
      'data_grid.metadata_view.column_type',
      'data_grid.metadata_view.default_value',
      'data_grid.metadata_view.comment',
    ];

    expectedKeys.forEach((key) => {
      expect(metadataSource).toContain(`'${key}'`);
    });
    [
      '查询结果',
      '个字段',
      '名称',
      '类型',
      '默认值',
      '注释',
    ].forEach((literal) => {
      expect(metadataSource).not.toContain(literal);
    });
    expect(metadataSource).not.toMatch(/>\s*FIELDS\s*</);
    expect(metadataSource).not.toMatch(/>\s*TABLE\s*</);
    expect(metadataSource).not.toMatch(/>\s*FIELD\s*</);
    expect(metadataSource).not.toMatch(/>\s*\{displayOutputColumnNames\.length\}\s*fields\s*</);

    [
      'zh-CN',
      'zh-TW',
      'en-US',
      'ja-JP',
      'de-DE',
      'ru-RU',
    ].forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      expectedKeys.forEach((key) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });
      expect(catalog['data_grid.metadata_view.field_count']).toContain('{{count}}');
    });
  });

  it('localizes DataGrid filter option labels through the filter hook translator', () => {
    const dataGridSource = readDataGridSource();
    const filterHookSource = readFileSync(new URL('./useDataGridFilters.tsx', import.meta.url), 'utf8');
    const filterOpOptionsStart = filterHookSource.indexOf('const filterOpOptions = React.useMemo');
    const filterLogicOptionsStart = filterHookSource.indexOf('const filterLogicOptions = React.useMemo');
    const hookCallStart = dataGridSource.indexOf('} = useDataGridFilters({');
    const hookCallSource = dataGridSource.slice(
      hookCallStart,
      dataGridSource.indexOf('});', hookCallStart) + 3,
    );
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    expect(filterOpOptionsStart).toBeGreaterThan(-1);
    expect(filterLogicOptionsStart).toBeGreaterThan(filterOpOptionsStart);
    expect(hookCallStart).toBeGreaterThan(-1);
    expect(filterHookSource).toContain('translate?: (key: string, params?: Record<string, string | number>) => string;');
    expect(hookCallSource).toContain('translate: translateDataGrid');

    const filterOpOptionsSource = filterHookSource.slice(filterOpOptionsStart, filterLogicOptionsStart);
    const filterLogicOptionsSource = filterHookSource.slice(
      filterLogicOptionsStart,
      filterHookSource.indexOf('const isNoValueOp', filterLogicOptionsStart),
    );
    const rawOperatorLabels = ['=', '!=', '<', '<=', '>', '>='];
    rawOperatorLabels.forEach((operator) => {
      const operatorPattern = escapeRegExp(operator);
      expect(filterOpOptionsSource).toMatch(new RegExp(
        `\\{\\s*value:\\s*['"]${operatorPattern}['"],\\s*label:\\s*['"]${operatorPattern}['"]\\s*\\}`,
      ));
    });

    const translatedOperatorKeys: Array<[string, string]> = [
      ['CONTAINS', 'data_grid.filter.op.contains'],
      ['NOT_CONTAINS', 'data_grid.filter.op.not_contains'],
      ['STARTS_WITH', 'data_grid.filter.op.starts_with'],
      ['NOT_STARTS_WITH', 'data_grid.filter.op.not_starts_with'],
      ['ENDS_WITH', 'data_grid.filter.op.ends_with'],
      ['NOT_ENDS_WITH', 'data_grid.filter.op.not_ends_with'],
      ['IS_NULL', 'data_grid.filter.op.is_null'],
      ['IS_NOT_NULL', 'data_grid.filter.op.is_not_null'],
      ['IS_EMPTY', 'data_grid.filter.op.is_empty'],
      ['IS_NOT_EMPTY', 'data_grid.filter.op.is_not_empty'],
      ['BETWEEN', 'data_grid.filter.op.between'],
      ['NOT_BETWEEN', 'data_grid.filter.op.not_between'],
      ['IN', 'data_grid.filter.op.in_list'],
      ['NOT_IN', 'data_grid.filter.op.not_in_list'],
      ['CUSTOM', 'data_grid.filter.op.custom'],
    ];
    translatedOperatorKeys.forEach(([value, key]) => {
      expect(filterOpOptionsSource).toMatch(new RegExp(
        `\\{\\s*value:\\s*['"]${value}['"],\\s*label:\\s*translate\\(\\s*['"]${key.replace(/\./g, '\\.')}['"]\\s*\\)\\s*\\}`,
      ));
    });
    expect(filterLogicOptionsSource).toMatch(
      /\{\s*value:\s*['"]AND['"],\s*label:\s*translate\(\s*['"]data_grid\.filter\.logic\.and['"]\s*\)\s*\}/,
    );
    expect(filterLogicOptionsSource).toMatch(
      /\{\s*value:\s*['"]OR['"],\s*label:\s*translate\(\s*['"]data_grid\.filter\.logic\.or['"]\s*\)\s*\}/,
    );

    [
      '包含',
      '不包含',
      '开始以',
      '不是开始于',
      '结束以',
      '不是结束于',
      '是 null',
      '不是 null',
      '是空的',
      '不是空的',
      '介于',
      '不介于',
      '在列表',
      '不在列表',
      '[自定义]',
      '且 (AND)',
      '或 (OR)',
    ].forEach((literal) => {
      expect(`${filterOpOptionsSource}\n${filterLogicOptionsSource}`).not.toContain(literal);
    });

    (['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const).forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;
      translatedOperatorKeys.forEach(([, key]) => {
        expect(catalog[key]).toEqual(expect.any(String));
        expect(catalog[key].length).toBeGreaterThan(0);
      });
      expect(catalog['data_grid.filter.logic.and']).toContain('AND');
      expect(catalog['data_grid.filter.logic.or']).toContain('OR');
    });
  });

  it('renders detached DataGrid chrome with translated labels instead of i18n keys', () => {
    const translate = (key: string, params?: Record<string, unknown>): string => {
      const values: Record<string, string> = {
        'data_grid.page_find.tooltip': 'Find only this page',
        'data_grid.page_find.placeholder': 'Find current page',
        'data_grid.page_find.previous': 'Previous find match',
        'data_grid.page_find.next': 'Next find match',
        'data_grid.page_find.summary': `${params?.occurrences} hits / ${params?.cells} cells`,
        'data_grid.pagination.result_set': 'Result set label',
        'data_grid.pagination.page_size_aria': 'Rows per page label',
        'data_grid.pagination.page_size_option': `${params?.count} rows per page`,
        'data_grid.pagination.first_page': 'First page label',
        'data_grid.pagination.last_page': 'Last page label',
        'data_grid.pagination.jump_label': 'Jump label',
        'data_grid.pagination.jump_aria': 'Jump page aria',
        'data_grid.pagination.jump_action': 'Go action',
        'data_grid.view.result_view': 'Result view label',
        'data_grid.view.table': 'Table label',
        'data_grid.view.text': 'Text label',
        'data_grid.secondary.data_preview': 'Data preview label',
        'data_grid.column_settings.field_info': 'Field info label',
        'data_grid.secondary.view_ddl': 'View DDL label',
        'data_grid.secondary.er_diagram': 'ER diagram label',
        'data_grid.secondary.column_display': 'Column display label',
        'data_grid.secondary.jump_column': 'Jump column label',
        'data_grid.record_view.empty': 'No rows label',
        'data_grid.record_view.json_record_count': `${params?.count} JSON rows label`,
        'data_grid.record_view.edit_json': 'Edit JSON label',
        'data_grid.record_view.previous': 'Previous label',
        'data_grid.record_view.next': 'Next label',
        'data_grid.record_view.record_position': `Record label ${params?.current} of ${params?.total}`,
        'data_grid.record_view.edit_current': 'Edit current label',
        'data_grid.column.type_tooltip': `TYPE ${params?.type}`,
        'data_grid.column.comment_tooltip': `COMMENT ${params?.comment}`,
        'data_grid.preview_panel.no_cell_title': 'Select cell title',
        'data_grid.preview_panel.no_cell_description': 'Select cell description',
        'data_grid.json_editor.format': 'Format JSON label',
        'common.close': 'Close find',
        'common.save': 'Save label',
      };
      return values[key] ?? key;
    };

    const pageFindMarkup = renderToStaticMarkup(
      <DataGridPageFind
        isV2Ui
        darkMode={false}
        pageFindText="al"
        normalizedPageFindText="al"
        hasMatches
        activePageFindPosition={1}
        matchCount={3}
        occurrenceCount={4}
        matchedCellCount={2}
        translate={translate}
        onPageFindTextChange={() => {}}
        onCancel={() => {}}
        onNavigatePrevious={() => {}}
        onNavigateNext={() => {}}
      />,
    );
    expect(pageFindMarkup).toContain('placeholder="Find current page"');
    expect(pageFindMarkup).toContain('1 / 3');
    expect(pageFindMarkup).toContain('4 hits / 2 cells');
    expect(pageFindMarkup).toContain('aria-label="Previous find match"');
    expect(pageFindMarkup).toContain('aria-label="Next find match"');
    expect(pageFindMarkup).toContain('aria-label="Close find"');
    expect(pageFindMarkup).not.toContain('data_grid.page_find');

    const resultViewMarkup = renderToStaticMarkup(
      <DataGridResultViewSwitcher
        isV2Ui={false}
        darkMode={false}
        viewMode="table"
        translate={translate}
        onViewModeChange={() => {}}
      />,
    );
    expect(resultViewMarkup).toContain('Result view label');
    expect(resultViewMarkup).toContain('Table label');
    expect(resultViewMarkup).toContain('JSON');
    expect(resultViewMarkup).toContain('Text label');
    expect(resultViewMarkup).not.toContain('data_grid.view');

    const paginationMarkup = renderToStaticMarkup(
      <DataGridPaginationBar
        isV2Ui={false}
        pagination={{
          current: 1,
          pageSize: 100,
          total: 24,
        }}
        paginationV2SummaryText="24 rows"
        paginationSummaryText="24 rows"
        paginationControlTotal={24}
        paginationTotalPages={2}
        paginationPageText="Page 1"
        paginationPageSizeOptions={['100', '200']}
        showKnownPageCount
        translate={translate}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        onV2PageStep={() => {}}
      />,
    );
    expect(paginationMarkup).toContain('Result set label');
    expect(paginationMarkup).toContain('First page label');
    expect(paginationMarkup).toContain('Last page label');
    expect(paginationMarkup).toContain('Jump label');
    expect(paginationMarkup).toContain('Jump page aria');
    expect(paginationMarkup).toContain('Go action');
    expect(paginationMarkup).toContain('100 rows per page');
    expect(paginationMarkup).not.toContain('data_grid.pagination');

    const secondaryMarkup = renderToStaticMarkup(
      <DataGridSecondaryActions
        isV2Ui
        canViewDdl
        canOpenObjectDesigner={false}
        viewMode="table"
        ddlLoading={false}
        showColumnComment={false}
        showColumnType={false}
        resultViewSwitcher={<span>view switcher</span>}
        columnInfoSettingContent={<span>column settings</span>}
        columnQuickFindContent={<span>quick find</span>}
        pageFindContent={<span>page find</span>}
        paginationContent={<span>pagination</span>}
        translate={translate}
        onViewModeChange={() => {}}
        dataPanelOpen={false}
        isTableSurfaceActive
        onToggleDataPanel={() => {}}
        onOpenTableDdl={() => {}}
      />,
    );
    expect(secondaryMarkup).toContain('Data preview label');
    expect(secondaryMarkup).toContain('Field info label');
    expect(secondaryMarkup).toContain('View DDL label');
    expect(secondaryMarkup).toContain('ER diagram label');
    expect(secondaryMarkup).toContain('Column display label');
    expect(secondaryMarkup).toContain('Jump column label');
    expect(secondaryMarkup).not.toContain('page find');
    expect(secondaryMarkup).not.toContain('gn-v2-data-grid-status-center');
    expect(secondaryMarkup).not.toContain('data_grid.secondary');

    const jsonRecordMarkup = renderToStaticMarkup(
      <DataGridJsonView
        darkMode={false}
        rowCount={5}
        canModifyData
        jsonViewText="[]"
        translate={translate}
        onOpenJsonEditor={() => {}}
      />,
    );
    expect(jsonRecordMarkup).toContain('5 JSON rows label');
    expect(jsonRecordMarkup).toContain('Edit JSON label');
    expect(jsonRecordMarkup).not.toContain('data_grid.record_view');

    const textRecordMarkup = renderToStaticMarkup(
      <DataGridTextView
        darkMode={false}
        rowCount={2}
        textRecordIndex={0}
        canModifyData
        currentTextRow={{ raw_sql: 'GitHub release HTTP 500 checksum abc123' }}
        displayOutputColumnNames={['raw_sql']}
        columnMetaMap={{ raw_sql: { type: 'varchar(128)', comment: 'SQL text payload' } }}
        columnMetaMapByLowerName={{}}
        showColumnType
        showColumnComment
        translate={translate}
        onPrev={() => {}}
        onNext={() => {}}
        onEditCurrent={() => {}}
        formatTextViewValue={(value) => String(value)}
      />,
    );
    expect(textRecordMarkup).toContain('Previous label');
    expect(textRecordMarkup).toContain('Next label');
    expect(textRecordMarkup).toContain('Record label 1 of 2');
    expect(textRecordMarkup).toContain('Edit current label');
    expect(textRecordMarkup).toContain('raw_sql');
    expect(textRecordMarkup).toContain('TYPE varchar(128)');
    expect(textRecordMarkup).toContain('COMMENT SQL text payload');
    expect(textRecordMarkup).toContain('GitHub release HTTP 500 checksum abc123');
    expect(textRecordMarkup).not.toContain('data_grid.record_view');

    const hiddenTextRecordMarkup = renderToStaticMarkup(
      <DataGridTextView
        darkMode={false}
        rowCount={1}
        textRecordIndex={0}
        canModifyData={false}
        currentTextRow={{ raw_sql: 'select 1' }}
        displayOutputColumnNames={['raw_sql']}
        columnMetaMap={{ raw_sql: { type: 'varchar(128)', comment: 'SQL text payload' } }}
        columnMetaMapByLowerName={{}}
        showColumnType={false}
        showColumnComment={false}
        translate={translate}
        onPrev={() => {}}
        onNext={() => {}}
        onEditCurrent={() => {}}
        formatTextViewValue={(value) => String(value)}
      />,
    );
    expect(hiddenTextRecordMarkup).not.toContain('TYPE varchar(128)');
    expect(hiddenTextRecordMarkup).not.toContain('COMMENT SQL text payload');

    const previewWithCellMarkup = renderToStaticMarkup(
      <DataGridPreviewPanel
        visible
        isTableSurfaceActive
        darkMode={false}
        focusedCellInfo={{ dataIndex: 'raw_sql' }}
        dataPanelIsJson
        focusedCellWritable
        dataPanelValue='{"raw":true}'
        columnMetaMap={{ raw_sql: { type: 'varchar(64)' } }}
        columnMetaMapByLowerName={{}}
        translate={translate}
        onFormatJson={() => {}}
        onSave={() => {}}
        onValueChange={() => {}}
        onDirtyChange={() => {}}
        isDirtyComparedToOriginal={() => false}
      />,
    );
    expect(previewWithCellMarkup).toContain('raw_sql');
    expect(previewWithCellMarkup).toContain('varchar(64)');
    expect(previewWithCellMarkup).toContain('Format JSON label');
    expect(previewWithCellMarkup).toContain('Save label');
    expect(previewWithCellMarkup).not.toContain('data_grid.preview_panel');

    const emptyPreviewMarkup = renderToStaticMarkup(
      <DataGridPreviewPanel
        visible
        isTableSurfaceActive
        darkMode={false}
        focusedCellInfo={null}
        dataPanelIsJson={false}
        focusedCellWritable={false}
        dataPanelValue=""
        columnMetaMap={{}}
        columnMetaMapByLowerName={{}}
        translate={translate}
        onFormatJson={() => {}}
        onSave={() => {}}
        onValueChange={() => {}}
        onDirtyChange={() => {}}
        isDirtyComparedToOriginal={() => false}
      />,
    );
    expect(emptyPreviewMarkup).toContain('Select cell title');
    expect(emptyPreviewMarkup).toContain('Select cell description');
    expect(emptyPreviewMarkup).not.toContain('data_grid.preview_panel');
  });

  it('keeps unknown-total pagination sequential while still allowing direct page jumps', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        dbName="main"
        connectionId="conn-1"
        readOnly
        pagination={{
          current: 3,
          pageSize: 100,
          total: 400,
          totalKnown: false,
        }}
        onPageChange={() => {}}
      />,
    );

    expect(markup).toContain('第 3 页');
    expect(markup).not.toContain('<strong>3</strong><span>/</span><span>4</span>');
    expect(markup).toContain('data-grid-pagination-jump="true"');
    expect(markup).toContain('跳页');
  });

  it('keeps legacy unknown-total pagination sequential while still allowing direct page jumps', () => {
    const previousUiVersion = mockStoreState.uiVersion;
    mockStoreState.uiVersion = 'legacy';

    try {
      const markup = renderDataGridWithI18n(
        <DataGrid
          data={[
            {
              __gonavi_row_key__: 'row-1',
              id: 1,
              name: 'alpha',
            },
          ]}
          columnNames={['id', 'name']}
          loading={false}
          tableName="users"
          dbName="main"
          connectionId="conn-1"
          readOnly
          pagination={{
            current: 3,
            pageSize: 100,
            total: 400,
            totalKnown: false,
          }}
          onPageChange={() => {}}
        />,
      );

      expect(markup).toContain('第 3 页');
      expect(markup).toContain('data-grid-pagination-sequential="true"');
      expect(markup).not.toContain('class="ant-pagination');
      expect(markup).toContain('data-grid-pagination-jump="true"');
      expect(markup).toContain('跳页');
    } finally {
      mockStoreState.uiVersion = previousUiVersion;
    }
  });

  it('renders the v2 DataGrid toolbar using the redesigned topbar hooks', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        dbName="main"
        connectionId="conn-1"
        editLocator={{
          strategy: 'primary-key',
          columns: ['id'],
          valueColumns: ['id'],
          readOnly: false,
        }}
        onReload={() => {}}
        showFilter
        onToggleFilter={() => {}}
        pagination={{
          current: 1,
          pageSize: 100,
          total: 1,
        }}
        onPageChange={() => {}}
      />,
    );

    expect(markup).toContain('gn-v2-data-grid');
    expect(markup).toContain('gn-v2-data-grid-toolbar-frame');
    expect(markup).toContain('gn-v2-data-grid-toolbar-title');
    expect(markup).toContain('gn-v2-toolbar-divider');
    expect(markup).toContain('gn-v2-commit-button');
    expect(markup).toContain('gn-v2-ai-insight-button');
    expect(markup).toContain('gn-v2-data-grid-toolbar-action');
    expect(markup).toContain('gn-v2-smart-filter-panel');
    expect(markup).toContain('gn-v2-data-grid-table-shell');
    expect(markup).toContain('gn-v2-data-grid-table-wrap');
    expect(markup).toContain('· main');
    expect(markup).toContain('提交事务');
    expect(markup).toContain('手动提交');
    expect(markup).toContain('AI 洞察');

    const getButtonBody = (label: string) => {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = markup.match(new RegExp(`<button(?=[^>]*aria-label="${escapedLabel}")[^>]*>([\\s\\S]*?)<\\/button>`));
      expect(match, `missing toolbar button: ${label}`).not.toBeNull();
      return match?.[1] ?? '';
    };

    [
      '刷新',
      '筛选',
      '新增行',
      '删除选中',
      '单元格编辑',
      '提交事务',
      '手动提交',
      '导入',
      '导出',
      'AI 洞察',
    ].forEach((label) => {
      expect(getButtonBody(label)).not.toContain(label);
    });
    [
      '数据预览',
      zhObjectDesignLabel,
      '查看 DDL',
      'ER 图',
      '日志',
      '字段显示',
    ].forEach((label) => {
      expect(getButtonBody(label)).not.toContain(label);
    });
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');

    const resultViewMarkup = renderToStaticMarkup(
      <DataGridResultViewSwitcher
        isV2Ui
        darkMode={false}
        viewMode="table"
        translate={(key) => zhCnCatalog[key] ?? key}
        onViewModeChange={() => {}}
      />,
    );
    expect(resultViewMarkup).toContain('aria-label="结果视图"');
    expect(resultViewMarkup).not.toContain('>结果视图<');
    expect(resultViewMarkup).toContain('class="gn-v2-data-grid-visually-hidden">表格</span>');
    expect(resultViewMarkup).toContain('class="gn-v2-data-grid-visually-hidden">JSON</span>');
    expect(resultViewMarkup).toContain('class="gn-v2-data-grid-visually-hidden">文本</span>');
    expect(readDataGridSecondaryActionsSource()).toContain('<Tooltip key={item.key} title={item.label}>');
    expect(readDataGridSecondaryActionsSource()).toContain(
      '<Tooltip title={columnDisplayLabel} open={columnDisplayOpen ? false : undefined}>',
    );
    expect(
      readFileSync(new URL('./DataGridResultViewSwitcher.tsx', import.meta.url), 'utf8'),
    ).toContain('<Tooltip title={option.label}>');

    const css = readV2ThemeCss();
    const iconActionCss = css.slice(
      css.indexOf('body[data-ui-version="v2"] .gn-v2-data-grid .gn-v2-data-grid-toolbar-action {'),
      css.indexOf('body[data-ui-version="v2"] .gn-v2-data-grid-toolbar-title {'),
    );
    expect(iconActionCss).toContain('width: 28px !important;');
    expect(iconActionCss).toContain('min-width: 28px !important;');
    expect(iconActionCss).toContain('padding-inline: 0 !important;');
    expect(css).toContain(
      'body[data-ui-version="v2"] .gn-v2-data-grid-statusbar .gn-v2-data-grid-toolbar-action.ant-btn {',
    );
  });

  it('renders a non-data row number column when enabled', () => {
    const previousLanguage = getCurrentLanguage();
    setCurrentLanguage('zh-CN');

    try {
      const markup = renderToStaticMarkup(
        <DataGrid
          data={[
            {
              __gonavi_row_key__: 'row-1',
              id: 1,
              name: 'alpha',
            },
          ]}
          columnNames={['id', 'name']}
          loading={false}
          tableName="events"
          dbName="main"
          connectionId="conn-1"
          readOnly
          showRowNumberColumn
          pagination={{
            current: 2,
            pageSize: 50,
            total: 51,
          }}
          onPageChange={() => {}}
        />,
      );

      expect(markup).toContain('aria-label="行号"');
      expect(markup).toContain('<span aria-label="行号">#</span>');
      expect(markup).not.toContain('>行号<');
      expect(markup).toContain('data-grid-row-number-title="true"');
      expect(markup).toContain('data-grid-column-title-single-line="true"');
      expect(markup).toContain('justify-content:center');
      expect(markup).toContain('align-items:center');
      expect(markup).toContain('min-height:var(--gonavi-header-min-height, 40px)');
      expect(markup).toContain('text-align:center');
      expect(markup).toContain('padding-inline:2');
      expect(markup).toContain('vertical-align:middle');
      expect(markup).toContain('data-grid-row-number="true"');
      expect(markup).toContain('width:36');
      // ant Table fixed 列会渲染 fix 相关 class
      expect(markup.includes('ant-table-cell-fix') || markup.includes('fixed')).toBe(true);
      expect(markup).toContain('51');
    } finally {
      setCurrentLanguage(previousLanguage);
    }
  });

  it('follows appearance.showDataTableRowNumber when prop is omitted', () => {
    const previousLanguage = getCurrentLanguage();
    setCurrentLanguage('zh-CN');

    try {
      const withDefault = renderToStaticMarkup(
        <DataGrid
          data={[{ __gonavi_row_key__: 'row-1', id: 1 }]}
          columnNames={['id']}
          loading={false}
          tableName="events"
          dbName="main"
          connectionId="conn-1"
          readOnly
        />,
      );
      expect(withDefault).toContain('data-grid-row-number="true"');

      const hidden = renderToStaticMarkup(
        <DataGrid
          data={[{ __gonavi_row_key__: 'row-1', id: 1 }]}
          columnNames={['id']}
          loading={false}
          tableName="events"
          dbName="main"
          connectionId="conn-1"
          readOnly
          showRowNumberColumn={false}
        />,
      );
      expect(hidden).not.toContain('data-grid-row-number="true"');
    } finally {
      setCurrentLanguage(previousLanguage);
    }
  });

  it('keeps pending cell markers when refreshing the grid', () => {
    const source = readDataGridSource();

    expect(source).toMatch(/const handleRefreshGrid = useCallback\(\(\) => \{[\s\S]*setSelectedRowKeys\(\[\]\);[\s\S]*if \(onReload\) onReload\(\);[\s\S]*\}, \[[\s\S]*onReload[\s\S]*\]\);/);
    expect(source).not.toMatch(/const handleRefreshGrid = useCallback\(\(\) => \{[\s\S]*setAddedRows\(\[\]\);[\s\S]*if \(onReload\) onReload\(\);[\s\S]*\}\,/);
    expect(source).not.toMatch(/const handleRefreshGrid = useCallback\(\(\) => \{[\s\S]*setModifiedRows\(\{\}\);[\s\S]*if \(onReload\) onReload\(\);[\s\S]*\}\,/);
    expect(source).not.toMatch(/const handleRefreshGrid = useCallback\(\(\) => \{[\s\S]*setDeletedRowKeys\(new Set\(\)\);[\s\S]*if \(onReload\) onReload\(\);[\s\S]*\}\,/);
  });

  it('routes temporal inline editors through the current connection config', () => {
    const source = readDataGridSource();

    expect(source).toContain('const pickerType = getTemporalPickerType(columnType, dbType, connectionConfig);');
    expect(source).toContain('const pickerType = getTemporalPickerType(columnType, dbType, currentConnConfig);');
    expect(source).toContain('cellProps.connectionConfig = currentConnConfig;');
    expect(source).toContain('format={getTemporalPickerFormat(pickerType)}');
  });

  it('renders a cell-level undo action in the v2 context menu for modified cells', () => {
    const markup = renderToStaticMarkup(
      <V2CellContextMenuView
        fieldName="status"
        tableName="orders"
        rowLabel="row 1"
        canModifyData
        canUndoCellChange
      />,
    );

    expect(markup).toContain(enUndoCellChangeLabel);
  });

  it('preserves fractional seconds when rendering datetime values', () => {
    expect(formatCellDisplayText('2026-05-10T09:12:33.456+08:00')).toBe('2026-05-10 09:12:33.456');
  });

  it('collapses OceanBase Oracle DATE midnight values to date-only text', () => {
    const oceanBaseOracleConfig = {
      type: 'oceanbase',
      oceanBaseProtocol: 'oracle',
    } as any;

    expect(formatCellDisplayText('2026-06-16T00:00:00Z', 'DATE', oceanBaseOracleConfig)).toBe('2026-06-16');
    expect(formatCellDisplayText('2026-06-16 00:00:00', 'DATE', oceanBaseOracleConfig)).toBe('2026-06-16');
    expect(formatCellDisplayText('2026-06-16T13:14:15Z', 'DATE', oceanBaseOracleConfig)).toBe('2026-06-16 13:14:15');
    expect(formatCellDisplayText('2026-06-16T00:00:00Z', 'DATE', { type: 'oracle' } as any)).toBe('2026-06-16 00:00:00');
  });

  it('renders bit column hex values as decimal flags', () => {
    expect(formatCellDisplayText('0x00', 'bit(1)')).toBe('0');
    expect(formatCellDisplayText('0x01', 'bit(1)')).toBe('1');
    expect(formatCellDisplayText('0x02', 'bit varying(8)')).toBe('2');
    expect(formatCellDisplayText('0x01', 'bytea')).toBe('0x01');
  });

  it('resolves the field name copied from the cell context menu', () => {
    expect(resolveContextMenuFieldName('created_at', '创建时间')).toBe('created_at');
    expect(resolveContextMenuFieldName('', 'fallback_name')).toBe('fallback_name');
  });

  it('uses contains as the default filter operator for string-like columns', () => {
    expect(resolveDefaultGridFilterOperator('varchar(255)')).toBe('CONTAINS');
    expect(resolveDefaultGridFilterOperator('character varying(64)')).toBe('CONTAINS');
    expect(resolveDefaultGridFilterOperator('nvarchar(max)')).toBe('CONTAINS');
    expect(resolveDefaultGridFilterOperator('Nullable(LowCardinality(String))')).toBe('CONTAINS');
    expect(resolveDefaultGridFilterOperator('text')).toBe('CONTAINS');

    expect(resolveDefaultGridFilterOperator('int')).toBe('=');
    expect(resolveDefaultGridFilterOperator('decimal(10,2)')).toBe('=');
    expect(resolveDefaultGridFilterOperator('datetime')).toBe('=');
  });

  it('updates only untouched default filter operators when the column changes', () => {
    expect(resolveNextGridFilterOperatorForColumnChange({
      currentOperator: '=',
      previousColumnType: 'int',
      nextColumnType: 'varchar(64)',
    })).toBe('CONTAINS');

    expect(resolveNextGridFilterOperatorForColumnChange({
      currentOperator: 'CONTAINS',
      previousColumnType: 'varchar(64)',
      nextColumnType: 'bigint',
    })).toBe('=');

    expect(resolveNextGridFilterOperatorForColumnChange({
      currentOperator: 'STARTS_WITH',
      previousColumnType: 'varchar(64)',
      nextColumnType: 'bigint',
    })).toBe('STARTS_WITH');
  });

  it('keeps full field names in filter field select options', () => {
    const [option] = buildGridFieldSelectOptions(['mes_manufacture_order_really_long_column_name']);

    expect(option).toEqual({
      value: 'mes_manufacture_order_really_long_column_name',
      label: 'mes_manufacture_order_really_long_column_name',
      title: 'mes_manufacture_order_really_long_column_name',
    });
  });

  it('renders a DDL action whenever a physical table context is available', () => {
    const tableMarkup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        dbName="main"
        connectionId="conn-1"
      />,
    );

    expect(tableMarkup).toContain('data-grid-ddl-action="true"');
    expect(tableMarkup).toContain('查看 DDL');
    expect(tableMarkup).toContain(zhObjectDesignLabel);
    expect(tableMarkup).not.toContain('data-grid-locate-sidebar-action="true"');

    const schemaTableMarkup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="public.users"
        dbName=""
        connectionId="conn-1"
      />,
    );

    expect(schemaTableMarkup).toContain('data-grid-ddl-action="true"');
    expect(schemaTableMarkup).toContain('查看 DDL');
    expect(schemaTableMarkup).toContain(zhObjectDesignLabel);
    expect(schemaTableMarkup).not.toContain('data-grid-page-find="true"');

    const queryMarkup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        dbName="main"
        ddlDbName="main"
        ddlTableName="users"
        connectionId="conn-1"
        exportScope="queryResult"
      />,
    );

    expect(queryMarkup).toContain('data-grid-ddl-action="true"');
    expect(queryMarkup).toContain('查看 DDL');
    expect(queryMarkup).toContain('字段信息');
    expect(queryMarkup).not.toContain(zhObjectDesignLabel);

    const ambiguousQueryMarkup = renderDataGridWithI18n(
      <DataGrid
        data={[{ __gonavi_row_key__: 'row-1', id: 1 }]}
        columnNames={['id']}
        loading={false}
        tableName="users"
        dbName="main"
        connectionId="conn-1"
        exportScope="queryResult"
      />,
    );

    expect(ambiguousQueryMarkup).not.toContain('data-grid-ddl-action="true"');

    const derivedQueryMarkup = renderDataGridWithI18n(
      <DataGrid
        data={[{ __gonavi_row_key__: 'row-1', total: 2 }]}
        columnNames={['total']}
        loading={false}
        dbName="main"
        connectionId="conn-1"
        exportScope="queryResult"
      />,
    );

    expect(derivedQueryMarkup).not.toContain('data-grid-ddl-action="true"');
  });

  it('keeps row copy and paste as context menu actions instead of toolbar buttons', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        pkColumns={['id']}
      />,
    );

    expect(markup).not.toContain('data-grid-copy-row-action="true"');
    expect(markup).not.toContain('data-grid-paste-row-action="true"');
  });

  it('renders a clickable copy action for aggregate query results', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            'COUNT(*)': 12,
          },
        ]}
        columnNames={['COUNT(*)']}
        loading={false}
        exportScope="queryResult"
      />,
    );

    expect(markup).toContain('data-grid-query-copy-action="true"');
    expect(markup).not.toMatch(/data-grid-query-copy-action="true"[^>]*disabled/);
    expect(markup).toContain('复制');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup.match(/data-grid-query-copy-action="true"/g)?.length).toBe(1);
  });

  it('keeps range selection and Ctrl/Cmd+C available for read-only aggregate results', () => {
    const batchActionsSource = readFileSync(new URL('./useDataGridBatchActions.ts', import.meta.url), 'utf8');
    const v2ActionsSource = readFileSync(new URL('./useDataGridV2Actions.ts', import.meta.url), 'utf8');
    const toolbarSource = readFileSync(new URL('./DataGridToolbarFrame.tsx', import.meta.url), 'utf8');

    expect(batchActionsSource).toContain('if (!isActive || !isTableSurfaceActive) return;');
    expect(batchActionsSource).not.toContain('if (!canModifyData || !isTableSurfaceActive) return;');
    expect(batchActionsSource).toContain('canSelectGridCellForClipboard({');
    expect(batchActionsSource).toContain('if (canModifyData && !cellEditModeRef.current)');
    expect(batchActionsSource).toContain('markCellSelectionDeleteEligible(canModifyData);');
    expect(v2ActionsSource).toContain('if (!isActive || !isTableSurfaceActive || (!cellEditMode && selectedCells.size === 0)) return;');
    expect(v2ActionsSource).toContain("String(event.key || '').toLowerCase() === 'c'");
    expect(v2ActionsSource).toContain('if (document.getSelection?.()?.toString()) return;');
    expect(toolbarSource).toContain('!canModifyData && selectedCellsSize > 0');
    expect(toolbarSource).toContain('data-grid-copy-selection-action="true"');
  });

  it('keeps export and import chrome behind translateDataGrid while preserving raw details', () => {
    const source = readDataGridSource();
    const exportDialogSource = readFileSync(new URL('./DataExportDialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain("type DataGridExportScope = 'selected' | 'page' | 'all' | 'filteredAll';");
    expect(source).toContain('const handleOpenExportDialog = useCallback(async () => {');
    expect(source).toContain('await runExportWithProgress({');
    expect(source).toContain("translateDataGrid('file.backend.dialog.export_query_result')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.selected_rows')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.selected_rows_count'");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.selected_rows_description')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.current_page'");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.current_page_description')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.all_results_requery')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.all_results_cached'");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.all_results_requery_description')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.all_results_cached_description')");
    expect(source).not.toContain("title: '导出查询结果'");
    expect(source).not.toContain("title: `导出 ${defaultName || '查询结果'}`");
    expect(source).not.toContain("? '全部结果（重新查询）'");
    expect(source).not.toContain(": `全部结果（当前缓存 ${mergedDisplayData.length} 条）`");
    expect(source).not.toContain("label: selectedCount > 0 ? `选中行 (${selectedCount} 条)` : '选中行'");
    expect(source).not.toContain("description: '仅导出当前结果集中已勾选的行。'");
    expect(source).not.toContain("label: `当前页 (${queryResultCurrentPageRows.length} 条)`");
    expect(source).not.toContain("description: '直接按当前结果页缓存导出。'");
    expect(source).not.toContain("? '后台会重新执行 SQL，避免只导出当前页或当前缓存。'");
    expect(source).not.toContain(": '当前查询缺少可重放 SQL 时，将导出当前缓存的全部结果。'");
    expect(source).toContain("translateDataGrid('file.backend.dialog.export_table'");
    expect(source).toContain("translateDataGrid('file.backend.dialog.export_data')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.current_page'");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.current_page_requery_description')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.current_page_unavailable_description')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.filtered_results_all')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.filtered_results_all_requery_description')");
    expect(source).toContain("translateDataGrid('data_grid.export.scope.filtered_results_all_unavailable_description')");
    expect(source).toContain("translateDataGrid('data_export.workbench.scope.all.label')");
    expect(source).toContain("translateDataGrid('data_export.workbench.scope.all.description')");
    expect(source).not.toContain("title: `导出 ${tableName || '数据'}`");
    expect(source).not.toContain("label: `当前页 (${displayData.length} 条)`");
    expect(source).not.toContain("? '后台按当前分页条件重新查询后导出当前页。'");
    expect(source).not.toContain(": '当前页依赖前端临时状态，建议直接使用快捷导出。'");
    expect(source).not.toContain("label: '筛选结果（全部）'");
    expect(source).not.toContain("? '按当前筛选条件重新查询数据库并导出全部筛选结果。'");
    expect(source).not.toContain(": '当前数据源或当前状态暂不支持在工作台重放筛选导出。'");
    expect(source).not.toContain("label: '全表数据'");
    expect(source).not.toContain("description: '后台重新查询整张表并导出全部数据。'");
    expect(source).toContain("const fallbackAllSql = String(resultSql || '').trim();");
    expect(source).toContain("const backendExportSql = exportAllSql || fallbackAllSql;");
    expect(source).toContain("if (backendExportSql && connectionId) {");
    expect(source).toContain("label: allRowsLabel");
    expect(exportDialogSource).toContain('data-export-config-modal="true"');
    expect(exportDialogSource).toContain("import { t } from '../i18n';");
    expect(exportDialogSource).toContain("label={t('data_export.dialog.field.format')}");
    expect(exportDialogSource).toContain("label={t('data_export.dialog.field.xlsx_max_rows')}");
    expect(exportDialogSource).toContain("t('data_export.dialog.field.xlsx_max_rows_help'");
    expect(source).toContain('const queryResultCurrentPageRows = useMemo(() => {');
    expect(source).toContain('const resolveContextMenuPosition = useCallback((x: number, y: number, estimatedWidth: number, estimatedHeight: number) => {');
    expect(source).toContain('const rect = element.getBoundingClientRect();');
    expect(source).toContain('ref={cellContextMenuPortalRef}');
    expect(source).not.toContain('const openQueryResultExportScopeModal = useCallback(');
    expect(source).not.toContain('const exportMenu: MenuProps[\'items\'] =');
  });

  it('keeps inline cell editors stretched to the full cell width', () => {
    const source = readDataGridSource();

    expect(source).toContain('const INLINE_EDIT_FORM_ITEM_STYLE: React.CSSProperties = { margin: 0, width: \'100%\', minWidth: 0 };');
    expect(source).toContain('className="data-grid-inline-editor-form-item"');
    expect(source).toContain('className="data-grid-inline-editor-input"');
    expect(source).toContain('style={{ width: \'100%\', ...inputCellPadding }}');
    expect(source).toContain('.${gridId} .data-grid-inline-editor-form-item .ant-form-item-control-input-content');
    expect(source).toContain('.${gridId} .data-grid-inline-editor-input');
  });

  it('disables browser autocapitalization for inline cell editors', () => {
    const source = readDataGridSource();

    const editorInputCount = source.match(/\{\.\.\.noAutoCapInputProps\}[\s\S]{0,180}className="data-grid-inline-editor-input"/g)?.length || 0;

    expect(source).toContain("import { applyNoAutoCapAttributesWithin, noAutoCapInputProps } from '../utils/inputAutoCap';");
    expect(editorInputCount).toBe(2);
  });

  it('renders a quick WHERE condition editor when table filters are visible', () => {
    const markup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        showFilter
        quickWhereCondition="name like 'a%'"
        onApplyQuickWhereCondition={() => {}}
      />,
    );

    expect(markup).toContain('data-grid-quick-where="true"');
    expect(markup).toContain('data-grid-quick-where-input="true"');
    expect(markup).toContain('WHERE');
    const englishMarkup = renderDataGridWithI18n(
      <DataGrid
        data={[
          {
            __gonavi_row_key__: 'row-1',
            id: 1,
            name: 'alpha',
          },
        ]}
        columnNames={['id', 'name']}
        loading={false}
        tableName="users"
        showFilter
        quickWhereCondition="name like 'a%'"
        onApplyQuickWhereCondition={() => {}}
      />,
      { preference: 'en-US' },
    );

    expect(englishMarkup).toContain('Enter the condition after WHERE');
    expect(englishMarkup).not.toContain('输入 WHERE 后面的条件');
  });

  it('keeps quick WHERE input clipboard editing isolated from grid shortcuts', () => {
    const source = readDataGridSource();
    const toolbarSource = readFileSync(new URL('./DataGridToolbarFrame.tsx', import.meta.url), 'utf8');
    const filterHookSource = readFileSync(new URL('./useDataGridFilters.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();

    expect(filterHookSource).toContain('const handleQuickWherePaste = React.useCallback');
    expect(filterHookSource).toContain("event.clipboardData.getData('text/plain')");
    expect(filterHookSource).toContain('const currentValue = input.value ?? quickWhereDraft;');
    expect(filterHookSource).toContain('event.stopPropagation();');
    expect(toolbarSource).toContain('data-grid-quick-where-input="true"');
    expect(toolbarSource).toContain('{...noAutoCapInputProps}');
    expect(toolbarSource).toContain('onCopy={onQuickWhereCopy}');
    expect(toolbarSource).toContain('onCut={onQuickWhereCut}');
    expect(toolbarSource).toContain('onPaste={onQuickWherePaste}');
    expect(source).toContain("['c', 'v', 'x'].includes");
    expect(css).toContain('[data-grid-quick-where-input="true"]');
    expect(css).toContain('font-size: var(--gn-font-size, 14px) !important;');
    expect(css).toContain('user-select: text !important;');
  });

  it('wires data-view column header filters through the existing filter state', () => {
    const source = readDataGridSource();
    const dataViewerSource = readDataViewerSource();
    const filterHookSource = readFileSync(new URL('./useDataGridFilters.tsx', import.meta.url), 'utf8');
    const columnTitleSource = readFileSync(new URL('./DataGridColumnTitle.tsx', import.meta.url), 'utf8');

    expect(filterHookSource).toContain('export type GridColumnFilterDraft');
    expect(filterHookSource).toContain('const applyColumnFilter = React.useCallback');
    expect(filterHookSource).toContain('onApplyFilter(nextConditions)');
    expect(source).toContain("const columnHeaderFilterEnabled = !!onApplyFilter || exportScope === 'queryResult';");
    expect(source).toContain("filterOpOptions.filter((option) => option.value !== 'CUSTOM')");
    expect(source).toContain("eventTarget?.closest?.('[data-grid-column-filter-trigger=\"true\"]')");
    expect(source).toContain("eventTarget?.closest?.('[data-grid-column-filter-popover=\"true\"]')");
    expect(source).toContain("eventTarget?.closest?.('.ant-select-dropdown')");
    expect(source).toContain('onApply: (draft) => applyColumnHeaderFilter(normalizedName, draft)');
    expect(source).toContain('onClear: () => clearColumnFilter(normalizedName)');
    expect(dataViewerSource).toContain('skipNextAutoFetchRef.current = false;');
    expect(dataViewerSource).toContain('setFilterConditions(normalizeViewerFilterConditions(conditions));');
    expect(columnTitleSource).toContain('data-grid-column-filter-trigger="true"');
    expect(columnTitleSource).toContain('const submitColumnFilter = (event?: React.SyntheticEvent<HTMLElement>) => {');
    expect(columnTitleSource).toContain('onClick={submitColumnFilter}');
    expect(columnTitleSource).toContain('onPressEnter={submitColumnFilter}');
    expect(columnTitleSource).toContain('getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}');
    expect(columnTitleSource).toContain('data-grid-column-filter-active={columnFilter.active ?');
    expect(columnTitleSource).toContain('data-grid-column-filter-popover="true"');
  });

  it('keeps DataGrid scroll synchronization throttled to animation frames', () => {
    const source = readDataGridSource();
    const secondaryActionsSource = readFileSync(new URL('./DataGridSecondaryActions.tsx', import.meta.url), 'utf8');
    const columnTitleSource = readFileSync(new URL('./DataGridColumnTitle.tsx', import.meta.url), 'utf8');
    const columnQuickFindSource = readFileSync(new URL('./DataGridColumnQuickFind.tsx', import.meta.url), 'utf8');
    const paginationBarSource = readFileSync(new URL('./DataGridPaginationBar.tsx', import.meta.url), 'utf8');
    const css = readV2ThemeCss();

    expect(source).toContain('virtualHorizontalElementsRef');
    expect(source).toContain('const handleSubmitColumnQuickFind = useCallback((submittedValue?: string) => {');
    expect(source).toContain('const effectiveQuery = String(submittedValue ?? columnQuickFindText);');
    expect(source).toContain('resolveDataGridColumnQuickFindTarget(displayColumnNames, query)');
    expect(source).toContain('onCancel={handleClosePageFind}');
    expect(source).toContain('enumerable: true');
    expect(source).toContain('resolveDataGridColumnQuickFindScrollLeft({');
    const pageFindFocusSource = source.slice(
      source.indexOf('const focusPageFindMatch = useCallback'),
      source.indexOf('const handleNavigatePageFind = useCallback'),
    );
    expect(pageFindFocusSource.indexOf("'[data-column-name]'"))
      .toBeLessThan(pageFindFocusSource.indexOf('if (applyVisibleFocus()) return;'));
    expect(pageFindFocusSource).toContain("headerTarget.closest('.ant-table-cell-fix-left, .ant-table-cell-fix-right')");
    expect(source).toContain('const applied = applyVirtualHorizontalOffset(tableContainer, nextScrollLeft);');
    expect(source).toContain('syncExternalScrollFromTargets();');
    expect(source).toContain("const columnQuickFindContent = isTableSurfaceActive ? (");
    expect(secondaryActionsSource).toContain('data-grid-column-quick-find-action="true"');
    expect(source).toContain('type VirtualTableScrollReference = TableReference & {');
    expect(source).toContain('const tableRef = useRef<VirtualTableScrollReference | null>(null);');
    expect(source).toContain('resolveDataGridHorizontalWheelDelta({');
    expect(source).toContain('const virtualHorizontalAlignmentRafRef = useRef<number | null>(null);');
    expect(source).toContain('const pendingExternalScrollLeftRef = useRef<number | null>(null);');
    expect(source).toContain('const externalScrollSequenceRef = useRef(0);');
    expect(source).toContain('const externalScrollbarDraggingRef = useRef(false);');
    expect(source).toContain('const EXTERNAL_HORIZONTAL_SCROLL_IDLE_SETTLE_MS = 80;');
    expect(source).toContain('const externalIdleCommitSchedulerRef = useRef<DataGridIdleCommitScheduler<number> | null>(null);');
    expect(source).toContain('const virtualHorizontalPostCommitGuardRef = useRef<DataGridVisualFrameGuard<number> | null>(null);');
    expect(source).toContain('const externalScrollInteractionUntilRef = useRef(0);');
    expect(source).toContain('createDataGridIdleCommitScheduler<number>({');
    expect(source).toContain('createDataGridVisualFrameGuard<number>({');
    expect(source).toContain('const isExternalScrollbarInteractionActive = useCallback(() => (');
    expect(source).toContain('const refreshExternalScrollbarInteraction = useCallback(() => {');
    expect(source).toContain('const scheduleVirtualHorizontalWheel = useCallback');
    expect(source).toContain('pendingTableHorizontalDeltaRef.current += delta;');
    expect(source).toContain('tableHorizontalWheelRafRef.current = requestAnimationFrame');
    expect(source).toContain('const scheduleVirtualHorizontalAlignment = useCallback((preferredLeft?: number) => {');
    expect(source).toContain('virtualHorizontalElementsRef.current = { tableContainer: null, holderEl: null, innerEl: null, headerEl: null };');
    expect(source).toContain('applyVirtualHorizontalOffset(tableContainer, nextLeft, { forceInternalScroll: true });');
    expect(source).toContain('}, [horizontalScrollVisible, scheduleVirtualHorizontalAlignment, tableRenderData, tableScrollX, virtualEditingCellForRender]);');
    expect(source).toContain('tableInstance.scrollTo({ left: clampedOffset });');
    expect(source).not.toContain('tableInstance.scrollTo({ left: clampedOffset, top: holderEl.scrollTop });');
    expect(source).toContain("tableContainer.addEventListener('scroll', stopPreviewHeaderScroll, true);");
    expect(source).toContain("innerEl.style.setProperty('--gn-datagrid-h-scroll', scrollVar);");
    expect(source).toContain('virtualHorizontalPostCommitGuardRef.current?.update(clampedOffset);');
    expect(source).not.toContain("tableContainer.style.setProperty('--gn-datagrid-h-scroll', scrollVar);");
    expect(source).not.toContain("holderEl.style.setProperty('--gn-datagrid-h-scroll', scrollVar);");
    expect(source).toContain('const requestedExternalScrollLeft = pendingExternalScrollLeftRef.current ?? latestExternalScroll.scrollLeft;');
    expect(source).toContain('if (isExternalScrollbarInteractionActive()) {');
    expect(source).toContain('const visual = syncVirtualHorizontalVisualOffset(tableContainer, requestedExternalScrollLeft);');
    expect(source).toContain('lastTableScrollLeftRef.current = visual.clampedOffset;');
    expect(source).toContain('applyVirtualHorizontalOffset(tableContainer, resolvedScrollLeft, { forceInternalScroll: true });');
    expect(source).not.toContain('deferPostScrollVisualReassert');
    expect(source).not.toContain('const synced = syncVirtualHorizontalVisualOffset(tableContainer, externalScroll.scrollLeft);');
    expect(source).toContain('const handleExternalHorizontalScrollPointerDown = useCallback');
    expect(source).toContain('const handleExternalHorizontalScrollPointerRelease = useCallback');
    expect(source).toContain('const finishExternalScrollbarDrag = useCallback');
    expect(source).toContain('const handleExternalHorizontalScrollLostPointerCapture = useCallback');
    const interactionActiveSource = source.slice(
      source.indexOf('const isExternalScrollbarInteractionActive = useCallback'),
      source.indexOf('const clearExternalScrollbarInteraction = useCallback'),
    );
    expect(interactionActiveSource).toContain('externalScrollbarDraggingRef.current');
    expect(interactionActiveSource).toContain('Date.now() < externalScrollInteractionUntilRef.current');
    const finishExternalScrollbarDragSource = source.slice(
      source.indexOf('const finishExternalScrollbarDrag = useCallback'),
      source.indexOf('const handleExternalHorizontalScrollPointerRelease = useCallback'),
    );
    expect(finishExternalScrollbarDragSource).toContain('if (isExternalScrollbarInteractionActive()) {');
    expect(finishExternalScrollbarDragSource).toContain('externalIdleCommitSchedulerRef.current?.flush()');
    expect(finishExternalScrollbarDragSource).not.toContain('clearExternalScrollbarInteraction();');
    expect(source).toContain('onPointerDown={handleExternalHorizontalScrollPointerDown}');
    expect(source).toContain('onPointerUp={handleExternalHorizontalScrollPointerRelease}');
    expect(source).toContain('onPointerCancel={handleExternalHorizontalScrollPointerRelease}');
    expect(source).toContain('onLostPointerCapture={handleExternalHorizontalScrollLostPointerCapture}');
    expect(source).toContain('if (externalSyncRafRef.current !== null)');
    expect(source).toContain('externalSyncRafRef.current = requestAnimationFrame');
    expect(source).toContain('const scheduleSyncExternalScrollFromTargets = useCallback');
    expect(source).toContain('tableTargetSyncRafRef.current = requestAnimationFrame');
    expect(source).toContain("boundHorizontalTargets = externalScroll ? [] : pickHorizontalScrollTargets(tableContainer);");
    expect(source).toContain('const useInlineEditableBodyCell = enableInlineEditableCell && !enableVirtual;');
    expect(source).toContain('if (useInlineEditableBodyCell) {');
    expect(source).toContain('}, areEditableCellPropsEqual);');
    expect(source).toContain('const [virtualEditingCell, setVirtualEditingCell] = useState<VirtualEditingCellState | null>(null);');
    expect(source).toContain('const openVirtualInlineEditor = useCallback((record: Item, dataIndex: string, title: React.ReactNode) => {');
    expect(source).toContain('if (isVirtualInlineEditingCell && virtualEditable && virtualEditingCellForRender) {');
    expect(source).toContain('const DATA_GRID_VIRTUAL_EDIT_RENDER_VERSION = Symbol(\'DATA_GRID_VIRTUAL_EDIT_RENDER_VERSION\');');
    expect(source).toContain('const attachDataGridVirtualEditRenderVersion = <T extends Item>(');
    expect(source).toContain('hasDataGridVirtualEditRenderVersionChanged(record, prevRecord)');
    expect(source).not.toContain('if (enableVirtual && enableInlineEditableCell) {\n                  return (\n                      <EditableCell');
    expect(source).toContain("content-visibility: ${useVirtualHolderPaintHints ? 'auto' : 'visible'};");
    expect(source).toContain("content-visibility: ${useVirtualEditableVisibilityHints ? 'auto' : 'visible'};");
    expect(source).toContain("contain-intrinsic-size: ${useVirtualEditableVisibilityHints ? '24px 160px' : 'auto'};");
    expect(source).toContain("const useVirtualHolderPaintHints = !isMacLike && !isV2Ui;");
    expect(source).toContain("const useVirtualCellContentContain = false;");
    expect(source).toContain("const useVirtualEditableVisibilityHints = !isMacLike && !isV2Ui;");
    expect(source).toContain("contain: ${useVirtualRowCellContain ? 'layout paint style' : 'none'};");
    expect(source).toContain('.${gridId} .data-grid-toolbar-scroll::-webkit-scrollbar-thumb:hover');
    expect(source).toContain('.${gridId} .ant-table-body::-webkit-scrollbar-thumb:hover');
    expect(source).toContain('.${gridId} .rc-virtual-list-holder::-webkit-scrollbar-thumb:hover');
    expect(source).toContain('.${gridId} .data-grid-external-horizontal-scroll::-webkit-scrollbar-thumb:hover');
    expect(source).toContain('background-clip: border-box;');
    expect(source).toContain('horizontalScrollbarThumbHoverBg');
    expect(source).toContain('const handleSharedCellContextMenu = useCallback');
    expect(source).toContain('const shouldUsePlainVirtualContent = isV2Ui && !modifiedStyle;');
    expect(source).toContain('if (shouldUsePlainVirtualContent) {');
    expect(source).toContain('return originalRenderContent;');
    expect(source).toContain('const virtualListItemHeightFixed = !!(');
    expect(source).toContain('listItemHeightFixed: virtualListItemHeightFixed');
    expect(source).toContain('const virtualListItemColumnVirtual = isV2Ui && enableVirtual && !virtualEditingCellForRender;');
    expect(source).toContain('listItemColumnVirtual: virtualListItemColumnVirtual');
    expect(source).toContain('if (scrollSnapshotRafRef.current !== null) return;');
    expect(source).toContain('scrollSnapshotRafRef.current = requestAnimationFrame');
    expect(source).toContain('didRestoreScrollRef.current = false;');
    expect(source).toContain('useEffect(() => {');
    expect(source).toContain('}, [connectionId, dbName, tableName, data]);');
    expect(source).toContain('const applied = applyVirtualHorizontalOffset(tableContainer, nextLeft);');
    expect(source).toContain('resolvedLeft = readVirtualHorizontalOffset(tableContainer);');
    expect(source).toContain('lastReportedScrollRef.current = { top: nextTop, left: resolvedLeft };');
    expect(source).toContain("const dataGridBackdropFilter = isV2Ui || isMacLike ? 'none' : (opacity < 0.999 ? 'blur(14px)' : 'none');");
    expect(source).toContain('rowHoverable={!enableVirtual}');
    expect(columnTitleSource).toContain("data-grid-column-highlighted={highlighted ? 'true' : undefined}");
    expect(columnTitleSource).toContain('data-column-name={normalizedName}');
    expect(columnQuickFindSource).toContain('AutoComplete');
    expect(columnQuickFindSource).toContain("placeholder={translate('data_grid.column_quick_find.placeholder')}");
    expect(secondaryActionsSource).not.toContain('gn-v2-data-grid-status-center');
    expect(secondaryActionsSource).not.toContain('gn-v2-data-grid-live');
    expect(css).toContain('width: 66px !important;');
    expect(css).toContain('container-name: gn-v2-data-grid-statusbar;');
    expect(css).toContain('body[data-ui-version="v2"] .gn-v2-data-grid-statusbar::-webkit-scrollbar');
    expect(css).toContain('scrollbar-width: thin;');
    expect(css).toContain('min-width: max-content;');
    expect(css).toContain('flex: 0 0 auto;');
    expect(css).not.toContain('gn-v2-data-grid-status-center');
    expect(css).not.toContain('gn-v2-data-grid-live');
    expect(css).toContain('body[data-ui-version="v2"] .gn-v2-data-grid-pagination-wrap::-webkit-scrollbar');
    expect(css).toContain('@container gn-v2-data-grid-statusbar (max-width: 960px)');
    expect(css).toContain('@container gn-v2-data-grid-statusbar (max-width: 760px)');
    expect(css).toContain('.data-grid-pagination-size-select.ant-select-focused .ant-select-selector');
    expect(css).toContain('overflow-x: auto;');
    expect(paginationBarSource).toContain("label: translate('data_grid.pagination.page_size_option', { count: value })");
    expect(paginationBarSource).not.toContain("label: `${value}/页`");
    expect(paginationBarSource).toContain('const maxJumpPage = showKnownPageCount ? Math.max(1, paginationTotalPages) : null;');
    expect(paginationBarSource).toContain('max={maxJumpPage ?? undefined}');
    expect(paginationBarSource).toContain('onPressEnter={submitJumpPage}');
    expect(paginationBarSource).toContain('data-grid-pagination-jump="true"');
    expect(css).toContain('.data-grid-pagination-jump-input.ant-input-number-focused');
    expect(css).toContain('background: transparent !important;');
  });

  it('keeps the DataGrid performance harness aligned with legacy and v2 comparison controls', () => {
    const harnessSource = readFileSync(new URL('../dev/PerfDataGridHarness.tsx', import.meta.url), 'utf8');
    expect(harnessSource).toContain("options={[");
    expect(harnessSource).toContain("t('dev.perf_data_grid.ui_version.legacy')");
    expect(harnessSource).toContain("t('dev.perf_data_grid.ui_version.v2')");
    expect(harnessSource).toContain("t('dev.perf_data_grid.density.comfortable')");
    expect(harnessSource).toContain("t('dev.perf_data_grid.density.standard')");
    expect(harnessSource).toContain("t('dev.perf_data_grid.density.compact')");
    [
      'DataGrid 性能复现页',
      '旧版 UI',
      '新版 UI',
      '行数',
      '列数',
      '标准',
      '紧凑',
      '极紧凑',
      '触发布局重算',
      '这个页面只用于开发态滚动性能采样',
      '直接在表格区域做纵向、横向、Shift+滚轮滚动采样',
    ].forEach((rawSnippet) => {
      expect(harnessSource).not.toContain(rawSnippet);
    });
    expect(harnessSource).toContain("document.body.setAttribute('data-ui-version', uiVersion);");
    expect(harnessSource).toContain("if (value === null || value === undefined || value === '') {");
    expect(harnessSource).toContain("const currentState = useStore.getState();");
  });
});
