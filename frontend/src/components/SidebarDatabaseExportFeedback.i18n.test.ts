import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarBatchExport.ts', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.message.exporting_database_schema',
  'sidebar.message.exporting_database_backup',
  'sidebar.message.export_success',
  'sidebar.message.export_failed',
] as const;

const extractHandleExportDatabaseBlock = (): string => {
  const start = source.indexOf('const handleExportDatabaseSQL = async');
  const end = source.indexOf('const handleExportSchemaSQL = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar database export feedback i18n', () => {
  it('opens database SQL exports in the workbench for review', () => {
    const block = extractHandleExportDatabaseBlock();

    expect(block).not.toContain('showSQLExportOptionsDialog()');
    expect(block).toContain('addTab(buildDatabaseExportWorkbenchTab({');
    expect(block).toContain("contentMode: includeData ? 'backup' : 'schema'");
    expect(block).toContain('includeDropIfExists: false');
    expect(block).toContain("launchKey: createTableExportKey('database')");
    expect(block).not.toContain('requestKey:');
    expect(block).not.toContain('ExportDatabaseSQLWithOptions(');
    expect(block).not.toContain('message.loading(');
  });

  it('keeps database export feedback keys available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['sidebar.message.exporting_database_schema'])).toEqual(['database']);
      expect(placeholders(catalog['sidebar.message.exporting_database_backup'])).toEqual(['database']);
      expect(placeholders(catalog['sidebar.message.export_success'])).toEqual([]);
      expect(placeholders(catalog['sidebar.message.export_failed'])).toEqual(['error']);
    });
  });
});
