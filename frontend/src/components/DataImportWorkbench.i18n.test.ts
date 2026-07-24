import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'];
const requiredKeys = [
  'sidebar.action.data_import',
  'data_import.workbench.title',
  'data_import.workbench.description',
  'data_import.workbench.section.target',
  'data_import.workbench.label.connection',
  'data_import.workbench.label.database',
  'data_import.workbench.label.table',
  'data_import.workbench.label.file',
  'data_import.workbench.placeholder.select_connection',
  'data_import.workbench.placeholder.loading_databases',
  'data_import.workbench.placeholder.select_database',
  'data_import.workbench.placeholder.select_database_first',
  'data_import.workbench.placeholder.loading_tables',
  'data_import.workbench.placeholder.select_table',
  'data_import.workbench.action.select_file',
  'data_import.workbench.action.change_file',
  'data_import.workbench.helper.file_formats',
  'data_import.workbench.state.awaiting_file_title',
  'data_import.workbench.state.awaiting_file_description',
  'data_import.workbench.message.load_databases_failed',
  'data_import.workbench.message.load_tables_failed',
  'data_import.workbench.message.select_file_failed',
  'data_import.workbench.message.import_done',
  'tab_manager.kind_badge.data_import',
  'tab_manager.hover.kind.data_import',
];

describe('DataImportWorkbench i18n', () => {
  it('keeps the import workbench contract available across locales', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;

      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });
});
