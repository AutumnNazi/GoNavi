import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
const batchHookSource = readFileSync(new URL('./sidebar/useSidebarBatchExport.ts', import.meta.url), 'utf8');
const batchTabSource = readFileSync(new URL('../utils/tableExportTab.ts', import.meta.url), 'utf8');
const batchWorkbenchSource = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

const requiredKeys = [
  'sidebar.action.batch_tables',
  'sidebar.action.batch_databases',
  'sidebar.action.clear_tables',
  'sidebar.action.delete_tables',
  'sidebar.action.delete_database_count',
  'sidebar.action.export_schema',
  'sidebar.action.export_data_only',
  'sidebar.action.backup_schema_data',
  'sidebar.action.select_all',
  'sidebar.action.clear_selection',
  'sidebar.action.invert_selection',
  'sidebar.action.export_database_schema_count',
  'sidebar.action.backup_database_count',
  'sidebar.field.select_connection',
  'sidebar.field.select_database',
  'sidebar.placeholder.select_connection',
  'sidebar.placeholder.select_connection_first',
  'sidebar.placeholder.filter_table_view',
  'sidebar.filter.all_objects',
  'sidebar.filter.tables_only',
  'sidebar.filter.views_only',
  'sidebar.filter.scope_filtered',
  'sidebar.filter.scope_all',
  'sidebar.modal.batch_tables.title',
  'sidebar.modal.batch_tables.description',
  'sidebar.modal.batch_tables.selection_hint',
  'sidebar.modal.batch_databases.title',
  'sidebar.modal.batch_databases.description',
  'sidebar.modal.batch_databases.selection_hint',
  'sidebar.batch.filtered_count',
  'sidebar.batch.selected_objects',
  'sidebar.batch.selected_databases',
  'sidebar.batch.group.tables',
  'sidebar.batch.group.views',
  'sidebar.batch.no_matching_objects',
  'sidebar.tab.batch_export_objects',
  'sidebar.tab.batch_export_objects_database',
  'sidebar.tab.batch_export_databases',
] as const;

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar batch actions i18n', () => {
  it('localizes batch table and database action copy', () => {
    [
      '批量操作表',
      '批量操作库',
      '按对象批量导出结构、数据或完整备份。',
      '按数据库批量导出结构，或生成结构加数据的备份。',
    ].forEach((rawSnippet) => {
      expect(sidebarSource).not.toContain(rawSnippet);
    });

    [
      '`批量导出 ${dbName} 对象`',
      "'批量导出对象'",
      "title: '批量导出库'",
    ].forEach((rawSnippet) => {
      expect(batchHookSource).not.toContain(rawSnippet);
    });

    [
      "title: String(input.title || '批量导出对象').trim() || '批量导出对象'",
      "title: String(input.title || '批量导出库').trim() || '批量导出库'",
    ].forEach((rawSnippet) => {
      expect(batchTabSource).not.toContain(rawSnippet);
    });

    [
      'sidebar.action.batch_tables',
      'sidebar.action.batch_databases',
    ].forEach((key) => {
      expect(sidebarSource, key).toContain(`t('${key}'`);
    });

    [
      'sidebar.action.batch_tables',
      'sidebar.action.batch_databases',
    ].forEach((key) => {
      expect(batchHookSource, key).toContain(`t('${key}'`);
    });
    expect(batchHookSource).toContain('openBatchTableWorkbench');
    expect(batchHookSource).toContain('openBatchDatabaseWorkbench');
    expect(batchHookSource).not.toContain('requestKey: createTableExportRequestKey(\'batch');

    [
      'sidebar.action.clear_tables',
      'sidebar.action.delete_tables',
      'sidebar.action.delete_database_count',
      'sidebar.modal.confirm_clear_selected_tables.title',
      'sidebar.modal.confirm_delete_selected_tables.title',
      'sidebar.modal.confirm_delete_selected_databases.title',
    ].forEach((key) => {
      expect(batchWorkbenchSource, key).toContain(`t('${key}'`);
    });

    [
      'sidebar.tab.batch_export_objects',
      'sidebar.tab.batch_export_databases',
    ].forEach((key) => {
      expect(batchTabSource, key).toContain(`t('${key}'`);
    });
  });

  it('keeps batch action catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['sidebar.action.delete_database_count'])).toEqual(['count']);
      expect(placeholders(catalog['sidebar.action.delete_tables'])).toEqual([]);
      expect(placeholders(catalog['sidebar.tab.batch_export_objects'])).toEqual([]);
      expect(placeholders(catalog['sidebar.tab.batch_export_objects_database'])).toEqual(['database']);
      expect(placeholders(catalog['sidebar.tab.batch_export_databases'])).toEqual([]);
    });
  });
});
