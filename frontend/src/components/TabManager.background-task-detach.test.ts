import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { isRunningDataImportWorkbenchTab } from './TabManager';

const source = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'];

describe('TabManager background task window guard', () => {
  it('keeps background task workbenches in the main WebView', () => {
    expect(source).toContain("tab.type === 'table-export' || tab.type === 'data-import' || tab.type === 'data-sync'");
    expect(source).toContain('if (tab && isBackgroundTaskWorkbenchTab(tab))');
    expect(source).toContain("message.warning(t('tab_manager.message.background_task_window_unavailable'))");
    expect(source).toContain('disabled: isBackgroundTaskWorkbenchTab(tab)');
  });

  it('keeps the detach guard message available across locales', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;
      expect(catalog['tab_manager.message.background_task_window_unavailable']).toBeTruthy();
    });
  });

  it('blocks closing a data import tab only while its foreground task is running', () => {
    expect(isRunningDataImportWorkbenchTab({
      type: 'data-import',
      dataImportRunning: true,
    })).toBe(true);
    expect(isRunningDataImportWorkbenchTab({
      type: 'data-import',
      dataImportRunning: false,
    })).toBe(false);
    expect(source).toContain("message.warning(t('tab_manager.message.data_import_running_close_blocked'))");
    expect(source).toContain('targetTabs.filter(isRunningDataImportWorkbenchTab)');
    expect(source).toContain('targetTabs.filter((tab) => !isRunningDataImportWorkbenchTab(tab))');
  });

  it('keeps the running-import close guard message available across locales', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(
        readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;
      expect(catalog['tab_manager.message.data_import_running_close_blocked']).toBeTruthy();
    });
  });
});
