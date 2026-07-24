import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TableExportWorkbench.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'data_export.message.load_databases_failed',
  'data_export.message.load_objects_failed',
] as const;

const extractBatchObjectLoadBlock = (): string => {
  const start = source.indexOf("if ((!isBatchTablesWorkbench && !isBatchDatabasesWorkbench) || !connectionConfig)");
  const end = source.indexOf('const hostSummary = useMemo', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar batch object load feedback i18n', () => {
  it('keeps localized fallbacks on batch database and object loading failures', () => {
    const block = extractBatchObjectLoadBlock();

    expect(block).toContain('DBGetDatabases(');
    expect(block).toContain('DBGetTables(');
    expect(block).toContain('loadViews(connection, selectedDbName)');
    expect(block).toContain("res.message || t('data_export.message.load_databases_failed')");
    expect(block).toContain("error?.message || t('data_export.message.load_databases_failed')");
    expect(block).toContain("res.message || t('data_export.message.load_objects_failed')");
    expect(block).toContain("error?.message || t('data_export.message.load_objects_failed')");
  });

  it('keeps batch object load feedback keys available with stable placeholders', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
        expect(placeholders(catalog[key])).toEqual([]);
      });
    });
  });
});
