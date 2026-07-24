import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const extractHandleExportBlock = (): string => {
  const start = source.indexOf('const handleExport = async');
  const end = source.indexOf('const handleCopyTableAsInsert', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)]
  .map((match) => match[1])
  .sort();

describe('Sidebar table export feedback i18n', () => {
  it('opens SQL exports in the workbench while retaining progress export for other formats', () => {
    const block = extractHandleExportBlock();

    expect(block).not.toContain('ExportTable(');
    expect(block).toContain("if (options.format === 'sql')");
    expect(block).toContain("await openTableSQLExportWorkbench(node, 'backup')");
    expect(block).toContain('runExportWithProgress({');
    expect(block).toContain('ExportTableWithOptions(');
    expect(block).toContain('...options');
    expect(block).toContain('jobId');
    expect(block).toContain('totalRowsHint');
    expect(block).toContain('totalRowsKnown');
  });

  it('launches table backups and INSERT exports with distinct background modes', () => {
    expect(source).toContain("const openTableSQLExportWorkbench = async (node: any, mode: 'backup' | 'dataOnly')");
    expect(source).toContain("mode === 'backup'");
    expect(source).toContain('showSQLExportOptionsDialog()');
    expect(source).toContain('addTab(buildBatchTableExportWorkbenchTab({');
    expect(source).toContain('initialObjectNames: [tableName]');
    expect(source).toContain('contentMode: mode');
    expect(source).toContain('includeDropIfExists: exportOptions.includeDropIfExists');
    expect(source).toContain("await openTableSQLExportWorkbench(node, 'dataOnly')");
  });

  it('keeps the export workbench entry key available across locales', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.v2_table_menu.open_export_workbench'], `${locale}:sidebar.v2_table_menu.open_export_workbench`).toBeTruthy();
      expect(placeholders(catalog['sidebar.v2_table_menu.open_export_workbench'])).toEqual([]);
    });
  });
});
