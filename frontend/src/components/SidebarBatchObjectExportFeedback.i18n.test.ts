import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workbenchSource = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('./useExportProgressRunner.ts', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'data_export.message.already_running',
  'data_export.message.export_success',
  'data_export.message.export_failed',
  'data_export.progress.stage.waiting_file_selection',
  'data_export.progress.title.done',
  'data_export.progress.title.error',
] as const;

const extractHandleBatchExportBlock = (): string => {
  const start = workbenchSource.indexOf('const handleStartBatchTablesExport = async');
  const end = workbenchSource.indexOf('const handleStartBatchDatabasesExport = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workbenchSource.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar batch object export feedback i18n', () => {
  it('routes workbench selections and export mode through the retained progress runner', () => {
    const block = extractHandleBatchExportBlock();

    expect(block).toContain('selectedObjectNames.length === 0');
    expect(block).toContain("batchTableMode !== 'dataOnly'");
    expect(block).toContain("batchTableMode !== 'schema'");
    expect(block).toContain('await runExportWithProgress({');
    expect(block).toContain('ExportTablesSQLWithOptions(');
    expect(block).toContain('selectedObjectNames,');
    expect(block).toContain('includeDropIfExists: includeSchema && includeDropIfExists');
    expect(runnerSource).toContain("message.warning(t('data_export.message.already_running'))");
    expect(runnerSource).toContain("message.success(t('data_export.message.export_success'))");
    expect(runnerSource).toContain("message.error(t('data_export.message.export_failed', { error: result.message }))");
    expect(runnerSource).toContain("message.error(t('data_export.message.export_failed', { error: errorMessage }))");
  });

  it('keeps batch object export feedback keys available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['data_export.message.already_running'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_success'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_failed'])).toEqual(['error']);
      expect(placeholders(catalog['data_export.progress.stage.waiting_file_selection'])).toEqual([]);
      expect(placeholders(catalog['data_export.progress.title.done'])).toEqual([]);
      expect(placeholders(catalog['data_export.progress.title.error'])).toEqual([]);
    });
  });
});
