import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './sidebar/sidebarLegacyNodeMenu.tsx',
  './sidebar/useSidebarObjectActions.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'sidebar.v2_table_menu.new_rollup',
] as const;

const catalogs = Object.fromEntries(locales.map(locale => [
  locale,
  JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>,
])) as Record<typeof locales[number], Record<string, string>>;

const placeholdersOf = (value: string): string[] => (
  Array.from(value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), match => match[1]).sort()
);

describe('Sidebar StarRocks Rollup i18n', () => {
  it('localizes Rollup tab title and menu label while keeping SQL raw', () => {
    expect(source).not.toContain("title: '新增 Rollup'");
    expect(source).not.toContain("label: '新增 Rollup'");
    expect(source).toContain("t('sidebar.v2_table_menu.new_rollup'");
    expect(source).toContain("keyword: 'Rollup'");
    expect(source).toContain('ADD ROLLUP rollup_name (column1, column2);');
  });

  it('keeps Rollup label key available in every locale with matching placeholders', () => {
    const zhCnCatalog = catalogs['zh-CN'];
    requiredKeys.forEach(key => {
      expect(zhCnCatalog, `zh-CN:${key}`).toHaveProperty(key);
      const expectedPlaceholders = placeholdersOf(zhCnCatalog[key]);
      locales.forEach(locale => {
        expect(catalogs[locale], `${locale}:${key}`).toHaveProperty(key);
        expect(placeholdersOf(catalogs[locale][key]), `${locale}:${key}`).toEqual(expectedPlaceholders);
      });
    });
  });
});
