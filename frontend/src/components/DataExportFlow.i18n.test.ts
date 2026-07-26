import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentFiles = [
  './DataExportDialog.tsx',
  './ExportProgressModal.tsx',
  './TableExportWorkbench.tsx',
  './useExportProgressRunner.ts',
  '../utils/tableExportTab.ts',
] as const;

const localeFiles = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'de-DE',
  'ru-RU',
] as const;

const sources = componentFiles.map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'));
const combinedSource = sources.join('\n');
const userFacingSource = combinedSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/'已取消'/g, '');
const catalogs = Object.fromEntries(localeFiles.map((locale) => [
  locale,
  JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>,
])) as Record<typeof localeFiles[number], Record<string, string>>;

const extractKeys = (source: string): string[] => (
  Array.from(new Set(source.match(/data_export(?:\.[a-z0-9_]+)+/g) || [])).sort()
);

const placeholdersOf = (value: string): string[] => (
  Array.from(value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), (match) => match[1]).sort()
);

describe('data export i18n', () => {
  it('routes dialog, progress modal, and workbench copy through translation keys instead of inline Han literals', () => {
    expect(sources[0]).toContain("t('data_export.dialog.field.format')");
    expect(sources[1]).toContain("t('data_export.progress.title.error')");
    expect(sources[2]).toContain("t('data_export.workbench.title')");
    expect(sources[3]).toContain("t('data_export.progress.title.done')");
    expect(sources[3]).toContain("t('data_export.progress.title.error')");
    expect(sources[4]).toContain("t('data_export.workbench.scope.all.label')");
    expect(sources[4]).toContain("t('data_export.workbench.scope.all.description')");
    expect(sources[4]).toContain("t('data_export.progress.value.target_fallback')");
    expect(sources[4]).toContain("t('data_export.workbench.task.export_target'");
    expect(userFacingSource).not.toMatch(/\p{Script=Han}/u);
  });

  it('keeps all extracted data_export keys present in every supported locale with matching placeholders', () => {
    const keys = extractKeys(combinedSource);
    const baseline = catalogs['zh-CN'];

    expect(keys.length).toBeGreaterThan(0);

    keys.forEach((key) => {
      expect(baseline, `zh-CN:${key}`).toHaveProperty(key);
      const expectedPlaceholders = placeholdersOf(baseline[key]);
      localeFiles.forEach((locale) => {
        expect(catalogs[locale], `${locale}:${key}`).toHaveProperty(key);
        expect(placeholdersOf(catalogs[locale][key]), `${locale}:${key}`).toEqual(expectedPlaceholders);
      });
    });
  });
});
