import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const key = 'sidebar.menu.view_object_definition';

describe('Sidebar view definition menu i18n', () => {
  it('localizes routine and event view definition menu labels', () => {
    expect(source).not.toContain("label: '查看定义'");
    expect(source.match(/label: t\('sidebar\.menu\.view_object_definition'\)/g) || []).toHaveLength(4);
  });

  it('keeps the generic view definition key available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog[key], `${locale}:${key}`).toBeTruthy();
    });
  });
});
