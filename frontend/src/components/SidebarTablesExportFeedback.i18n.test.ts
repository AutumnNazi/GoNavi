import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarBatchExport.ts', import.meta.url), 'utf8');
const workbenchSource = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('./useExportProgressRunner.ts', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.action.batch_tables',
  'data_export.message.already_running',
  'data_export.message.export_success',
  'data_export.message.export_failed',
] as const;

const extractHandleExportTablesBlock = (): string => {
  const start = source.indexOf('const openBatchTableWorkbench = () =>');
  const end = source.indexOf('const openBatchDatabaseWorkbench = () =>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const extractBatchTableExecutionBlock = (): string => {
  const start = workbenchSource.indexOf('const handleStartBatchTablesExport = async');
  const end = workbenchSource.indexOf('const handleStartBatchDatabasesExport = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workbenchSource.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar tables export feedback i18n', () => {
  it('opens the batch workbench immediately and delegates selected tables to its runner', () => {
    const block = extractHandleExportTablesBlock();
    const executionBlock = extractBatchTableExecutionBlock();

    expect(block).toContain('resolveBatchWorkbenchContext(selectedNodesRef.current, connections)');
    expect(block).toContain('addTab(buildBatchTableExportWorkbenchTab({');
    expect(block).toContain('connectionId,');
    expect(block).toContain('dbName: dbName || undefined');
    expect(block).toContain("title: t('sidebar.action.batch_tables')");
    expect(block).not.toContain('requestKey:');
    expect(executionBlock).toContain('selectedObjectNames.length === 0');
    expect(executionBlock).toContain('await runExportWithProgress({');
    expect(executionBlock).toContain('ExportTablesSQLWithOptions(');
    expect(executionBlock).toContain('selectedObjectNames,');
    expect(runnerSource).toContain("message.warning(t('data_export.message.already_running'))");
    expect(runnerSource).toContain("message.success(t('data_export.message.export_success'))");
    expect(runnerSource).toContain("message.error(t('data_export.message.export_failed', { error: result.message }))");
  });

  it('keeps tables export feedback keys available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['sidebar.action.batch_tables'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.already_running'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_success'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_failed'])).toEqual(['error']);
    });
  });
});
