import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = [
  './sidebar/sidebarLegacyNodeMenu.tsx',
  './sidebar/useSidebarObjectActions.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar delete routine menu i18n', () => {
  it('localizes the routine delete menu label and routine type', () => {
    expect(source).not.toContain('label: `删除${typeLabel}`');
    expect(source).toContain("label: t('sidebar.menu.delete_routine'");
    expect(source).toContain("t(routineType === 'PROCEDURE' ? 'sidebar.object.procedure' : 'sidebar.object.function')");
  });

  it('keeps delete routine catalog text usable in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.menu.delete_routine'], `${locale}:delete_routine`).toContain('{{type}}');
      expect(catalog['sidebar.object.function'], `${locale}:function`).toBeTruthy();
      expect(catalog['sidebar.object.procedure'], `${locale}:procedure`).toBeTruthy();
    });

    const zhCN = JSON.parse(readFileSync(new URL('../../../shared/i18n/zh-CN.json', import.meta.url), 'utf8')) as Record<string, string>;
    const zhTW = JSON.parse(readFileSync(new URL('../../../shared/i18n/zh-TW.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(zhCN['sidebar.menu.delete_routine']).toBe('删除{{type}}');
    expect(zhTW['sidebar.menu.delete_routine']).toBe('刪除{{type}}');
  });
});
