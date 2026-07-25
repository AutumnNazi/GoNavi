import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './sidebar/sidebarLegacyNodeMenu.tsx',
  './sidebar/useSidebarObjectActions.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar materialized view create menu i18n', () => {
  it('localizes the materialized view group create action label', () => {
    expect(source).not.toContain("label: '新建物化视图'");
    expect(source).toContain("label: t('sidebar.v2_database_menu.new_materialized_view')");
  });

  it('keeps the materialized view create action catalog entry available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.v2_database_menu.new_materialized_view'], `${locale}:new materialized view`).toBeTruthy();
    });
  });
});
