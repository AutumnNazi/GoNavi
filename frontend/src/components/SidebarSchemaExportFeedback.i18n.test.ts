import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarBatchExport.ts', import.meta.url), 'utf8');
const workbenchSource = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('./useExportProgressRunner.ts', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.message.schema_export_target_missing',
  'data_export.message.already_running',
  'data_export.message.export_success',
  'data_export.message.export_failed',
] as const;

const extractHandleExportSchemaBlock = (): string => {
  const start = source.indexOf('const handleExportSchemaSQL = async');
  const end = source.indexOf('const openBatchTableWorkbench = () =>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const extractDirectSchemaExportBlock = (): string => {
  const start = workbenchSource.indexOf('const handleStartDirectSchemaExport = async');
  const end = workbenchSource.indexOf('const handleStartExport = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workbenchSource.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar schema export feedback i18n', () => {
  it('validates the target and routes schema SQL export into the background workbench', () => {
    const block = extractHandleExportSchemaBlock();
    const executionBlock = extractDirectSchemaExportBlock();

    expect(block).toContain("t('sidebar.message.schema_export_target_missing')");
    expect(block).toContain('showSQLExportOptionsDialog()');
    expect(block).toContain('addTab(buildSchemaExportWorkbenchTab({');
    expect(block).toContain('schemaName,');
    expect(block).toContain("contentMode: includeData ? 'backup' : 'schema'");
    expect(block).toContain('includeDropIfExists: exportOptions.includeDropIfExists');
    expect(block).toContain("requestKey: createTableExportRequestKey('schema')");
    expect(block).not.toContain('ExportSchemaSQLWithOptions(');
    expect(block).not.toContain('message.loading(');
    expect(executionBlock).toContain('await runExportWithProgress({');
    expect(executionBlock).toContain('ExportSchemaSQLWithOptions(');
    expect(executionBlock).toContain('buildRpcConnectionConfig(connectionConfig, { database: effectiveDbName })');
    expect(executionBlock).toContain('includeData,');
    expect(executionBlock).toContain('includeDropIfExists,');
    expect(runnerSource).toContain("message.warning(t('data_export.message.already_running'))");
    expect(runnerSource).toContain("message.success(t('data_export.message.export_success'))");
    expect(runnerSource).toContain("message.error(t('data_export.message.export_failed', { error: result.message }))");
  });

  it('keeps schema export feedback keys available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
      expect(placeholders(catalog['sidebar.message.schema_export_target_missing'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.already_running'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_success'])).toEqual([]);
      expect(placeholders(catalog['data_export.message.export_failed'])).toEqual(['error']);
    });
  });
});
