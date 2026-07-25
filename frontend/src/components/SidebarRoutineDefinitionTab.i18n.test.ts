import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
const objectActionsSource = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const source = `${sidebarSource}\n${objectActionsSource}`;
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar routine definition tab i18n', () => {
  it('localizes routine definition tab titles', () => {
    expect(source).not.toContain('title: `${typeLabel}: ${routineName}`');
    expect(sidebarSource.match(/title: t\('sidebar\.tab\.routine_definition'/g) || []).toHaveLength(2);
    expect(source.match(/t\(routineType === 'PROCEDURE' \? 'sidebar\.object\.procedure' : 'sidebar\.object\.function'\)/g) || []).toHaveLength(4);
  });

  it('keeps routine definition tab catalog placeholders aligned', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.tab.routine_definition'], `${locale}:routine definition type`).toContain('{{type}}');
      expect(catalog['sidebar.tab.routine_definition'], `${locale}:routine definition name`).toContain('{{name}}');
      expect(catalog['sidebar.object.function'], `${locale}:function`).toBeTruthy();
      expect(catalog['sidebar.object.procedure'], `${locale}:procedure`).toBeTruthy();
    });
  });
});
