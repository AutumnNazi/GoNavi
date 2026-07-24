import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('./useExportProgressRunner.ts', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'data_export.message.load_databases_failed',
  'data_export.message.already_running',
  'data_export.message.export_success',
  'data_export.message.export_failed',
  'sidebar.modal.confirm_delete_selected_databases.title',
  'sidebar.modal.confirm_delete_selected_databases.content',
  'sidebar.message.deleting_selected_databases',
  'sidebar.message.delete_databases_success',
  'sidebar.message.delete_databases_failed',
] as const;

const extractBatchDatabaseExportBlock = (): string => {
  const start = source.indexOf('const handleStartBatchDatabasesExport = async');
  const end = source.indexOf('const handleStartDirectDatabaseExport = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const extractHandleBatchDbDeleteBlock = (): string => {
  const start = source.indexOf('const handleDeleteSelectedDatabases = async');
  const end = source.indexOf('const handleStartSingleExport = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar batch database export feedback i18n', () => {
  it('loads databases and routes selected targets through the retained progress runner', () => {
    const block = extractBatchDatabaseExportBlock();

    expect(source).toContain('DBGetDatabases(');
    expect(source).toContain("res.message || t('data_export.message.load_databases_failed')");
    expect(source).toContain("error?.message || t('data_export.message.load_databases_failed')");
    expect(block).toContain('selectedDatabaseNames.length === 0');
    expect(block).toContain("batchDatabaseMode === 'backup'");
    expect(block).toContain('await runExportWithProgress({');
    expect(block).toContain('ExportDatabasesSQLWithOptions(');
    expect(block).toContain('selectedDatabaseNames,');
    expect(block).toContain('includeDropIfExists,');
    expect(runnerSource).toContain("message.warning(t('data_export.message.already_running'))");
    expect(runnerSource).toContain("message.success(t('data_export.message.export_success'))");
    expect(runnerSource).toContain("message.error(t('data_export.message.export_failed', { error: result.message }))");
  });

  it('localizes database deletion confirmation, loading, success, and failure wrappers', () => {
    const block = extractHandleBatchDbDeleteBlock();

    expect(block).toContain('DropDatabase');
    expect(block).toContain("t('sidebar.modal.confirm_delete_selected_databases.title')");
    expect(block).toContain("t('sidebar.modal.confirm_delete_selected_databases.content'");
    expect(block).toContain("t('sidebar.message.deleting_selected_databases'");
    expect(block).toContain("t('sidebar.message.delete_databases_success'");
    expect(block).toContain("t('sidebar.message.delete_databases_failed'");
    expect(source).toContain("okText: options.okText || t('sidebar.action.delete')");
    expect(source).toContain('okButtonProps: { danger: true }');
    expect(source).toContain("cancelText: t('sidebar.action.cancel')");
    expect(block).toContain('connection: connection?.name || effectiveConnectionId');
    expect(block).toContain('count: selectedDatabaseNames.length');
    expect(block).toContain('count: succeededNames.length');
    expect(block).toContain('database: failed.database');
    expect(block).toContain('error: failed.error');
  });

  it('keeps batch database export feedback keys available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['data_export.message.load_databases_failed'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.already_running'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_success'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_failed'])).toEqual(['error']);
      expect(placeholders(catalog['sidebar.modal.confirm_delete_selected_databases.title'])).toEqual([]);
      expect(placeholders(catalog['sidebar.modal.confirm_delete_selected_databases.content'])).toEqual(['connection', 'count']);
      expect(placeholders(catalog['sidebar.message.deleting_selected_databases'])).toEqual(['count']);
      expect(placeholders(catalog['sidebar.message.delete_databases_success'])).toEqual(['count']);
      expect(placeholders(catalog['sidebar.message.delete_databases_failed'])).toEqual(['database', 'error']);
    });
  });
});
