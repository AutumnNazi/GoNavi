import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './sidebar/useSidebarObjectActions.tsx',
  './sidebar/sidebarLegacyNodeMenu.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar create routine i18n', () => {
  it('localizes create routine tab title and menu labels', () => {
    expect(source).not.toContain("title: isProc ? '新建存储过程' : '新建函数'");
    expect(source).not.toContain("label: '新建函数'");
    expect(source).not.toContain("label: '新建存储过程'");
    expect(source.match(/sidebar\.tab\.create_function/g) || []).toHaveLength(2);
    expect(source.match(/sidebar\.tab\.create_procedure/g) || []).toHaveLength(2);
  });

  it('keeps create routine catalog entries available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.tab.create_function'], `${locale}:create function`).toBeTruthy();
      expect(catalog['sidebar.tab.create_procedure'], `${locale}:create procedure`).toBeTruthy();
    });
  });
});
