import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './sidebar/useSidebarObjectActions.tsx',
  './sidebar/sidebarLegacyNodeMenu.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar view create and edit i18n', () => {
  it('localizes view create and edit tab titles and menu labels', () => {
    expect(source).not.toContain('title: `编辑视图: ${viewName}`');
    expect(source).not.toContain('title: `新建视图`');
    expect(source).not.toContain("label: '新建视图'");
    expect(source).not.toContain("label: '编辑视图'");
    expect(source).toContain("title: t('sidebar.tab.edit_view'");
    expect(source).toContain("title: t('sidebar.tab.create_view')");
    expect(source).toContain("label: t('sidebar.menu.create_view')");
    expect(source).toContain("label: t('sidebar.menu.edit_view')");
  });

  it('keeps view create and edit catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.tab.edit_view'], `${locale}:edit view tab`).toContain('{{name}}');
      expect(catalog['sidebar.tab.create_view'], `${locale}:create view tab`).toBeTruthy();
      expect(catalog['sidebar.menu.create_view'], `${locale}:create view menu`).toBeTruthy();
      expect(catalog['sidebar.menu.edit_view'], `${locale}:edit view menu`).toBeTruthy();
    });
  });
});
