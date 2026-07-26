import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar edit routine tab i18n', () => {
  it('localizes edit routine tab titles without touching routine names', () => {
    expect(source).not.toContain('title: `编辑${typeLabel}: ${routineName}`');
    expect(source).toContain("title: t('sidebar.tab.edit_routine'");
    expect(source).toContain("name: routineName");
  });

  it('keeps edit routine tab catalog placeholders aligned', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.tab.edit_routine'], `${locale}:edit routine type`).toContain('{{type}}');
      expect(catalog['sidebar.tab.edit_routine'], `${locale}:edit routine name`).toContain('{{name}}');
      expect(catalog['sidebar.object.function'], `${locale}:function`).toBeTruthy();
      expect(catalog['sidebar.object.procedure'], `${locale}:procedure`).toBeTruthy();
    });
  });
});
