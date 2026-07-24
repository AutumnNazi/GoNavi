import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarObjectActionsSource = readFileSync(
  new URL('../sidebar/useSidebarObjectActions.tsx', import.meta.url),
  'utf8',
);
const tableOverviewSource = readFileSync(
  new URL('../TableOverview.tsx', import.meta.url),
  'utf8',
);
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

const sliceBetween = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe('countdown danger confirmation wiring', () => {
  it('protects every table and database right-click DROP entry point', () => {
    const sidebarDeleteDatabase = sliceBetween(
      sidebarObjectActionsSource,
      'const handleDeleteDatabase =',
      'const handleRenameTable =',
    );
    const sidebarDeleteTable = sliceBetween(
      sidebarObjectActionsSource,
      'const handleDeleteTable =',
      'const handleTableDataDangerAction =',
    );
    const overviewDeleteTable = sliceBetween(
      tableOverviewSource,
      'const handleDeleteTable =',
      'const handleTableDataDangerAction =',
    );

    [sidebarDeleteDatabase, sidebarDeleteTable, overviewDeleteTable].forEach((source) => {
      expect(source).toContain('showCountdownDangerConfirm({');
      expect(source).not.toContain('Modal.confirm({');
    });
  });

  it('keeps countdown text and placeholders available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(
        new URL(`../../../../shared/i18n/${locale}.json`, import.meta.url),
        'utf8',
      )) as Record<string, string>;

      expect(catalog['common.destructive_confirm.action_countdown'], `${locale}:action`).toContain('{{action}}');
      expect(catalog['common.destructive_confirm.action_countdown'], `${locale}:seconds`).toContain('{{seconds}}');
      expect(catalog['common.destructive_confirm.countdown'], `${locale}:countdown`).toContain('{{seconds}}');
      expect(catalog['common.destructive_confirm.ready'], `${locale}:ready`).toBeTruthy();
    });
  });
});
