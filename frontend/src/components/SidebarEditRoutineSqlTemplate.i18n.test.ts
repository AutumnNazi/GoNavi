import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar edit routine SQL template i18n', () => {
  it('localizes generated edit routine SQL comments without translating DDL', () => {
    expect(source).not.toContain('-- 编辑${typeLabel} ${routineName}');
    expect(source).toContain("t('sidebar.sql_template.edit_routine'");
    expect(source).toContain('CREATE OR REPLACE ${lines}');
    expect(source).toContain('\\n${ddl}');
    expect(source).toContain('\\n${def}');
  });

  it('keeps edit routine SQL template placeholders aligned', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.sql_template.edit_routine'], `${locale}:edit routine sql type`).toContain('{{type}}');
      expect(catalog['sidebar.sql_template.edit_routine'], `${locale}:edit routine sql name`).toContain('{{name}}');
    });
  });
});
