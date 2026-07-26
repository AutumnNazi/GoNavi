import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar materialized view menu labels i18n', () => {
  it('localizes materialized view context menu labels', () => {
    expect(source).not.toContain("label: '浏览物化视图数据'");
    expect(source).not.toContain("label: '查看物化视图定义'");
    expect(source).toContain("label: t('sidebar.menu.browse_materialized_view_data')");
    expect(source).toContain("label: t('sidebar.menu.materialized_view_definition')");
  });

  it('keeps materialized view context menu catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.menu.browse_materialized_view_data'], `${locale}:browse materialized view data`).toBeTruthy();
      expect(catalog['sidebar.menu.materialized_view_definition'], `${locale}:materialized view definition`).toBeTruthy();
    });
  });
});
