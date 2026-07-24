import { readFileSync } from 'node:fs';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TableDesignerSqlPreview, { resolveSqlChangeHighlights } from './TableDesignerSqlPreview';

const tableDesignerColumnI18nKeys = [
  'table_designer.column.name',
  'table_designer.column.type',
  'table_designer.column.primary_key',
  'table_designer.column.auto_increment',
  'table_designer.column.not_null',
  'table_designer.column.default',
  'table_designer.column.comment',
  'table_designer.column.actions',
  'table_designer.tooltip.edit_column_options',
] as const;

const tableDesignerColumnOptionI18nKeys = [
  'table_designer.column.charset',
  'table_designer.column.collation',
  'table_designer.column.enable_default',
  'table_designer.modal.column_options_title',
  'table_designer.modal.column_options_title_named',
  'table_designer.placeholder.column_default',
] as const;

const tableDesignerSqlPreviewChangeKeys = [
  'table_designer.sql_preview.change.add',
  'table_designer.sql_preview.change.comment',
  'table_designer.sql_preview.change.constraint',
  'table_designer.sql_preview.change.create',
  'table_designer.sql_preview.change.create_index',
  'table_designer.sql_preview.change.drop',
  'table_designer.sql_preview.change.modify',
  'table_designer.sql_preview.change.rename',
] as const;

const sharedI18nDir = new URL('../../../shared/i18n/', import.meta.url);
const sharedI18nLocaleFiles = [
  'de-DE.json',
  'en-US.json',
  'ja-JP.json',
  'ru-RU.json',
  'zh-CN.json',
  'zh-TW.json',
] as const;

const sliceBetween = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

const mockMonaco = {
  Range: class {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;

    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number,
    ) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  },
  editor: {
    defineTheme: vi.fn(),
  },
};

const mockEditor = {
  deltaDecorations: vi.fn(() => ['decoration-1']),
  getModel: vi.fn(() => ({
    getLineCount: () => 5,
    getLineMaxColumn: (lineNumber: number) => (lineNumber === 1 ? 22 : 80),
  })),
};

vi.mock('@monaco-editor/react', () => ({
  default: ({
    beforeMount,
    defaultLanguage,
    language,
    onMount,
    options,
    theme,
    value,
  }: {
    beforeMount?: (monaco: any) => void;
    defaultLanguage?: string;
    language?: string;
    onMount?: (editor: any, monaco: any) => void;
    options?: Record<string, any>;
    theme?: string;
    value?: string;
  }) => {
    beforeMount?.(mockMonaco);
    onMount?.(mockEditor, mockMonaco);
    return (
      <div
        data-default-language={defaultLanguage}
        data-language={language}
        data-monaco-editor-mock="true"
        data-options={JSON.stringify(options)}
        data-theme={theme}
      >
        {value}
      </div>
    );
  },
}));

describe('TableDesignerSqlPreview', () => {
  beforeEach(() => {
    mockEditor.deltaDecorations.mockClear();
    mockMonaco.editor.defineTheme.mockClear();
  });

  it('keeps TableDesigner initial column labels in i18n catalogs', () => {
    const source = readFileSync(new URL('./TableDesigner.tsx', import.meta.url), 'utf8');
    const initialColumnsDefinition = sliceBetween(
      source,
      '// Initial Columns Definition',
      'setTableColumns(initialCols);',
    );

    for (const localeFile of sharedI18nLocaleFiles) {
      const catalog = JSON.parse(readFileSync(new URL(localeFile, sharedI18nDir), 'utf8')) as Record<string, string>;
      for (const key of tableDesignerColumnI18nKeys) {
        expect(catalog[key], `${localeFile} ${key}`).toBeTruthy();
      }
    }

    for (const key of tableDesignerColumnI18nKeys) {
      expect(initialColumnsDefinition).toContain(`t('${key}'`);
    }
    expect(initialColumnsDefinition).toContain('i18nLanguage');

    for (const literal of [
      "'名'",
      "'类型'",
      "'主键'",
      "'自增'",
      "'不是 Null'",
      "'不是 NULL'",
      "'默认'",
      "'注释'",
      "'操作'",
      '"弹框编辑注释"',
      "'弹框编辑注释'",
    ]) {
      expect(initialColumnsDefinition).not.toContain(literal);
    }
  });

  it('keeps TableDesigner column option labels in i18n catalogs', () => {
    for (const localeFile of sharedI18nLocaleFiles) {
      const catalog = JSON.parse(readFileSync(new URL(localeFile, sharedI18nDir), 'utf8')) as Record<string, string>;
      for (const key of tableDesignerColumnOptionI18nKeys) {
        expect(catalog[key], `${localeFile} ${key}`).toBeTruthy();
      }
    }
  });

  it('does not ship corrupted table designer i18n catalog strings', () => {
    const badLocalizedValuePattern = /\?{2,}|\uFFFD|f\?r|verf\?gbar|Schl\?ssel|Zuf\?llige|Schreibgesch\?tzt|OLAP \?|\{\{count\}\} \?/;
    const badValues: string[] = [];

    for (const localeFile of sharedI18nLocaleFiles) {
      const catalog = JSON.parse(readFileSync(new URL(localeFile, sharedI18nDir), 'utf8')) as Record<string, unknown>;

      for (const [key, value] of Object.entries(catalog)) {
        if (
          key.startsWith('table_designer.')
          && typeof value === 'string'
          && badLocalizedValuePattern.test(value)
        ) {
          badValues.push(`${localeFile} ${key}=${value}`);
        }
      }
    }

    expect(badValues).toEqual([]);
  });

  it('keeps SQL preview change labels in i18n catalogs without shipping Chinese source labels', () => {
    const source = readFileSync(new URL('./TableDesignerSqlPreview.tsx', import.meta.url), 'utf8');

    for (const localeFile of sharedI18nLocaleFiles) {
      const catalog = JSON.parse(readFileSync(new URL(localeFile, sharedI18nDir), 'utf8')) as Record<string, string>;
      for (const key of tableDesignerSqlPreviewChangeKeys) {
        expect(catalog[key], `${localeFile} ${key}`).toBeTruthy();
      }
    }

    for (const literal of [
      '重命名变更',
      '新增变更',
      '删除变更',
      '字段属性变更',
      '约束变更',
      '备注变更',
      '新建索引',
      '新建表结构',
    ]) {
      expect(source).not.toContain(literal);
    }
  });

  it('keeps generated SQL fallback text independent from UI locale', () => {
    const source = readFileSync(new URL('./TableDesigner.tsx', import.meta.url), 'utf8');

    for (const forbiddenSnippet of [
      "t('table_designer.trigger.template.body_comment'",
      "t('table_designer.trigger.template.enter_create'",
      "t('table_designer.trigger.definition_unavailable'",
    ]) {
      expect(source).not.toContain(forbiddenSnippet);
    }

    for (const forbiddenSqlFallbackPattern of [
      /return\s+result\.sql\s*\|\|[^\n]*t\('table_designer\.message\.index_create_sql_placeholder'/,
      /return\s+result\.sql\s*\|\|[^\n]*t\('table_designer\.message\.index_create_sql_unavailable'/,
    ]) {
      expect(source).not.toMatch(forbiddenSqlFallbackPattern);
    }
  });

  it('keeps TableDesigner load failures localized without translating raw details', () => {
    const source = readFileSync(new URL('./TableDesigner.tsx', import.meta.url), 'utf8');

    expect(source).toContain("t('table_designer.message.connection_not_found'");
    expect(source).toContain("t('table_designer.message.load_columns_failed', { detail: colsRes.message }");
    expect(source).not.toContain('message.error("Connection not found")');
    expect(source).not.toContain('message.error("Failed to load columns: " + colsRes.message)');
  });

  it('renders SQL changes in a read-only Monaco SQL editor with explicit syntax highlight theme', () => {
    const markup = renderToStaticMarkup(
      <TableDesignerSqlPreview
        sql={'ALTER TABLE "users"\nRENAME COLUMN "name" TO "display_name";'}
        darkMode={false}
      />,
    );

    expect(markup).toContain('data-table-designer-sql-preview="true"');
    expect(markup).toContain('data-monaco-editor-mock="true"');
    expect(markup).toContain('data-default-language="sql"');
    expect(markup).toContain('data-language="sql"');
    expect(markup).toContain('data-theme="gonavi-sql-preview-light"');
    expect(markup).toContain('&quot;readOnly&quot;:true');
    expect(markup).toContain('&quot;lineNumbers&quot;:&quot;on&quot;');
    expect(markup).not.toContain('&quot;glyphMargin&quot;:true');
    expect(markup).toContain('ALTER TABLE');
    expect(markup).toContain('RENAME COLUMN');

    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledWith(
      'gonavi-sql-preview-light',
      expect.objectContaining({
        base: 'vs',
        inherit: true,
        rules: expect.arrayContaining([
          expect.objectContaining({ token: 'keyword', foreground: expect.any(String) }),
          expect.objectContaining({ token: 'string', foreground: expect.any(String) }),
          expect.objectContaining({ token: 'comment', foreground: expect.any(String) }),
        ]),
      }),
    );
  });

  it('detects only SQL change operation lines instead of highlighting the whole SQL block', () => {
    const translate = (key: string) => `translated:${key}`;
    const highlights = resolveSqlChangeHighlights([
      'ALTER TABLE "users"',
      'ADD COLUMN "age" int NULL;',
      'ALTER TABLE "users"',
      'RENAME COLUMN "name" TO "display_name";',
      '-- DuckDB 不支持通过 COMMENT ON COLUMN 持久化字段备注',
    ].join('\n'), translate);

    expect(highlights).toEqual([
      expect.objectContaining({
        kind: 'add',
        lineNumber: 2,
        label: 'translated:table_designer.sql_preview.change.add',
      }),
      expect.objectContaining({
        kind: 'rename',
        lineNumber: 4,
        label: 'translated:table_designer.sql_preview.change.rename',
      }),
    ]);
  });

  it('detects CREATE INDEX preview lines as create changes', () => {
    const translate = (key: string) => `translated:${key}`;
    const highlights = resolveSqlChangeHighlights(
      'CREATE UNIQUE NONCLUSTERED INDEX [IX_Users_Email] ON [dbo].[Users] ([email]);',
      translate,
    );

    expect(highlights).toEqual([
      expect.objectContaining({
        kind: 'create',
        lineNumber: 1,
        label: 'translated:table_designer.sql_preview.change.create_index',
      }),
    ]);
  });

  it('adds Monaco decorations to changed SQL lines only', () => {
    renderToStaticMarkup(
      <TableDesignerSqlPreview
        sql={[
          'ALTER TABLE "users"',
          'ADD COLUMN "age" int NULL;',
          'ALTER TABLE "users"',
          'DROP COLUMN "legacy_name";',
        ].join('\n')}
      />,
    );

    expect(mockEditor.deltaDecorations).toHaveBeenCalledWith(
      [],
      expect.arrayContaining([
        expect.objectContaining({
          range: expect.objectContaining({ startLineNumber: 2, endLineNumber: 2 }),
          options: expect.objectContaining({
            className: expect.stringContaining('gonavi-sql-preview-change-line-add'),
            isWholeLine: true,
            linesDecorationsClassName: expect.stringContaining('gonavi-sql-preview-change-marker-add'),
          }),
        }),
        expect.objectContaining({
          range: expect.objectContaining({ startLineNumber: 4, endLineNumber: 4 }),
          options: expect.objectContaining({
            className: expect.stringContaining('gonavi-sql-preview-change-line-drop'),
            isWholeLine: true,
            linesDecorationsClassName: expect.stringContaining('gonavi-sql-preview-change-marker-drop'),
          }),
        }),
      ]),
    );
    const firstDecorationCall = mockEditor.deltaDecorations.mock.calls[0] as unknown as [unknown, unknown[]];
    expect(firstDecorationCall[1]).toHaveLength(2);
    expect(firstDecorationCall[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          options: expect.not.objectContaining({
            glyphMarginClassName: expect.any(String),
          }),
        }),
      ]),
    );
  });

  it('uses the dark SQL preview theme when dark mode is enabled', () => {
    const markup = renderToStaticMarkup(
      <TableDesignerSqlPreview sql="CREATE TABLE users (id int);" darkMode />,
    );

    expect(markup).toContain('data-theme="gonavi-sql-preview-dark"');
    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledWith(
      'gonavi-sql-preview-dark',
      expect.objectContaining({
        base: 'vs-dark',
        inherit: true,
      }),
    );
  });
});
