import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar edit view SQL template i18n', () => {
  it('localizes generated edit view SQL comments without translating DDL', () => {
    expect(source).not.toContain('-- 编辑视图 ${viewName}');
    expect(source).not.toContain('-- 请修改后执行');
    expect(source).toContain("t('sidebar.sql_template.edit_view'");
    expect(source).toContain("t('sidebar.sql_template.modify_then_execute')");
    expect(source).toContain('CREATE OR REPLACE VIEW ${viewName} AS');
    expect(source).toContain('CREATE VIEW ${viewName} AS');
  });

  it('keeps edit view SQL template catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.sql_template.edit_view'], `${locale}:edit view sql name`).toContain('{{name}}');
      expect(catalog['sidebar.sql_template.modify_then_execute'], `${locale}:modify then execute`).toBeTruthy();
    });
  });
});
